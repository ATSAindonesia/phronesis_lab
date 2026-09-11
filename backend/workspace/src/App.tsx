import React, { useState } from 'react';
import { Check, Lock, Mail, User, ArrowRight, BarChart3, Settings, Users, FileText, LogOut } from 'lucide-react';

// --- Components ---

const LoginPage = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
          <p className="text-slate-400">Please enter your details to sign in.</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-5 h-5 text-slate-600" />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="name@company.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-600" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="••••••••"
              />
            </div>
          </div>
          <button 
            onClick={onLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-semibold transition mt-4 flex items-center justify-center gap-2"
          >
            Sign In <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ onLogout }: { onLogout: () => void }) => (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex">
    {/* Sidebar */}
    <aside className="w-64 border-r border-slate-800 p-6 flex flex-col">
      <div className="text-2xl font-bold text-white mb-10">SaaSify</div>
      <nav className="space-y-2 flex-grow">
        <a href="#" className="flex items-center gap-3 text-indigo-400 bg-indigo-950/30 px-4 py-3 rounded-xl">
          <BarChart3 className="w-5 h-5" /> Dashboard
        </a>
        <a href="#" className="flex items-center gap-3 text-slate-400 hover:text-white px-4 py-3 rounded-xl transition">
          <Users className="w-5 h-5" /> Team
        </a>
        <a href="#" className="flex items-center gap-3 text-slate-400 hover:text-white px-4 py-3 rounded-xl transition">
          <FileText className="w-5 h-5" /> Reports
        </a>
        <a href="#" className="flex items-center gap-3 text-slate-400 hover:text-white px-4 py-3 rounded-xl transition">
          <Settings className="w-5 h-5" /> Settings
        </a>
      </nav>
      <button onClick={onLogout} className="flex items-center gap-3 text-red-400 hover:text-red-300 px-4 py-3">
        <LogOut className="w-5 h-5" /> Logout
      </button>
    </aside>

    {/* Main Content */}
    <main className="flex-1 p-10">
      <header className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold">JD</div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-6">
        {[
          { label: 'Active Users', value: '1,284', change: '+12%' },
          { label: 'Revenue', value: '$48,200', change: '+8%' },
          { label: 'Conversion Rate', value: '3.2%', change: '-1%' },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <p className="text-slate-400 text-sm">{stat.label}</p>
            <p className="text-3xl font-bold mt-2">{stat.value}</p>
            <p className={`text-sm mt-1 ${stat.change.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>{stat.change}</p>
          </div>
        ))}
      </div>
    </main>
  </div>
);

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return isLoggedIn ? (
    <Dashboard onLogout={() => setIsLoggedIn(false)} />
  ) : (
    <LoginPage onLogin={() => setIsLoggedIn(true)} />
  );
}
