package builder

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Store owns all sessions + the reaper goroutine.
type Store struct {
	mu       sync.RWMutex
	items    map[string]*Session
	ports    map[int]string
	baseDir  string
	llm      llmConfig
	maxLive  int
	idleTTL  time.Duration
	stopGC   chan struct{}
}

func NewStore() *Store {
	base := getenvOr("BUILDER_WORKSPACES", "/home/william/lab.phronesis/phronesis_lab/workspaces")
	st := &Store{
		items:   map[string]*Session{},
		ports:   map[int]string{},
		baseDir: base,
		llm:     llmFromEnv(),
		maxLive: 3,
		idleTTL: 45 * time.Minute,
		stopGC:  make(chan struct{}),
	}
	_ = os.MkdirAll(base, 0o755)
	go st.reaper()
	return st
}

func (st *Store) allocPort() (int, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for p := 4500; p < 4600; p++ {
		if _, taken := st.ports[p]; taken {
			continue
		}
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err != nil {
			continue
		}
		_ = ln.Close()
		st.ports[p] = "reserved"
		return p, nil
	}
	return 0, fmt.Errorf("no free preview ports")
}

func (st *Store) freePort(p int) {
	st.mu.Lock()
	delete(st.ports, p)
	st.mu.Unlock()
}

func (st *Store) Get(id string) *Session {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.items[id]
}

func (st *Store) Create(user, email, name string) (*Session, error) {
	id := newID()
	port, err := st.allocPort()
	if err != nil {
		return nil, err
	}
	s := &Session{
		ID: id, UserID: user, Email: email, Name: name,
		Dir:       filepath.Join(st.baseDir, id),
		CtrName:   "lab-builder-" + id,
		HostPort:  port,
		Preview:   fmt.Sprintf("http://localhost:%d", port),
		CreatedAt: time.Now(),
		LastAct:   time.Now(),
		status:    "ready",
		history:   nil,
	}
	st.mu.Lock()
	st.items[id] = s
	st.ports[port] = id
	st.mu.Unlock()
	return s, nil
}

// reaper stops containers of idle sessions (workspace dirs survive; the next
// turn re-seeds the container on demand via containerRunning check).
func (st *Store) reaper() {
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-st.stopGC:
			return
		case <-t.C:
			st.mu.RLock()
			list := make([]*Session, 0, len(st.items))
			for _, s := range st.items {
				list = append(list, s)
			}
			st.mu.RUnlock()
			for _, s := range list {
				s.mu.Lock()
				idle := time.Since(s.LastAct)
				stat := s.status
				s.mu.Unlock()
				if stat == "running" || idle < st_idle() {
					continue
				}
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				if containerRunning(ctx, s) {
					log.Printf("builder: reaping idle sandbox %s (idle %v)", s.ID, idle.Round(time.Second))
					stopSandbox(ctx, s)
				}
				cancel()
			}
		}
	}
}

func st_idle() time.Duration { return 45 * time.Minute }

// liveCount counts running containers for the cap guard.
func (st *Store) liveCount(ctx context.Context) int {
	st.mu.RLock()
	defer st.mu.RUnlock()
	n := 0
	for _, s := range st.items {
		if containerRunning(ctx, s) {
			n++
		}
	}
	return n
}

// EnsureSandbox boots the session container if needed (called on first turn).
func (st *Store) EnsureSandbox(ctx context.Context, s *Session) error {
	if containerRunning(ctx, s) {
		return nil
	}
	if st.liveCount(ctx) >= st.maxLive {
		return fmt.Errorf("sandbox capacity reached (%d live); close another session", st.maxLive)
	}
	return startSandbox(ctx, s)
}

// RunTurn serializes turns per session (one goroutine at a time).
type turnLocks struct {
	mu sync.Mutex
	m  map[string]*sync.Mutex
}

var turns = turnLocks{m: map[string]*sync.Mutex{}}

func (t *turnLocks) get(id string) *sync.Mutex {
	t.mu.Lock()
	defer t.mu.Unlock()
	l, ok := t.m[id]
	if !ok {
		l = &sync.Mutex{}
		t.m[id] = l
	}
	return l
}

func (st *Store) QueueTurn(s *Session, prompt string) {
	lock := turns.get(s.ID)
	go func() {
		lock.Lock()
		defer lock.Unlock()
		ctx := context.Background()
		if err := st.EnsureSandbox(ctx, s); err != nil {
			s.emitError("sandbox: " + err.Error())
			s.setStatus("error")
			time.AfterFunc(time.Second, func() { s.setStatus("ready") })
			return
		}
		runTurn(ctx, s, st.llm, prompt)
		s.touch()
	}()
}
