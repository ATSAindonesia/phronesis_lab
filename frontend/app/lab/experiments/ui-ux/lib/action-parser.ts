// Streaming parser for Bolt artifacts, actions, and fallback code blocks
// Based on stackblitz/bolt.new message-parser architecture

export interface BoltAction {
  id: string;
  type: "file" | "shell";
  filePath?: string;
  content: string;
  status: "pending" | "running" | "complete" | "failed";
}

export interface BoltArtifact {
  id: string;
  title: string;
  actions: BoltAction[];
}

export interface ActionParserCallbacks {
  onArtifactStart?: (artifact: { id: string; title: string }) => void;
  onActionStart?: (action: BoltAction) => void;
  onActionStream?: (action: BoltAction, delta: string) => void;
  onActionComplete?: (action: BoltAction) => void;
  onArtifactComplete?: () => void;
  onThought?: (thought: string) => void;
}

const ARTIFACT_TAG_OPEN = "<boltArtifact";
const ARTIFACT_TAG_CLOSE = "</boltArtifact>";
const ARTIFACT_ACTION_TAG_OPEN = "<boltAction";
const ARTIFACT_ACTION_TAG_CLOSE = "</boltAction>";

export function extractAttribute(tag: string, attributeName: string): string | undefined {
  // Matches attribute="value", attribute='value', or attribute=value (handles newlines/spaces)
  const regex = new RegExp(`${attributeName}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = tag.match(regex);
  if (match) return match[1];

  // Fallback for unquoted attribute
  const unquotedRegex = new RegExp(`${attributeName}\\s*=\\s*([^\\s>]+)`, "i");
  const unquotedMatch = tag.match(unquotedRegex);
  return unquotedMatch ? unquotedMatch[1] : undefined;
}

export function cleanFileContent(raw: string): string {
  let content = raw.trim();
  // Strip leading code fence e.g. ```tsx or ```typescript
  content = content.replace(/^```[a-zA-Z0-9-]*\r?\n/i, "");
  // Strip trailing code fence
  content = content.replace(/\r?\n```\s*$/i, "");
  return content.trim() + "\n";
}

export class StreamingActionParser {
  private fullInput = "";
  private position = 0;
  private currentAction: BoltAction | null = null;
  private currentArtifact: { id: string; title: string } | null = null;
  private actionCounter = 0;
  private callbacks: ActionParserCallbacks;
  private insideArtifact = false;
  private insideAction = false;
  private fallbackMode = false;
  private thoughtBuffer = "";

  constructor(callbacks: ActionParserCallbacks) {
    this.callbacks = callbacks;
  }

  public feed(chunk: string): void {
    this.fullInput += chunk;
    this.process();
  }

  private process(): void {
    const input = this.fullInput;
    let i = this.position;

    while (i < input.length) {
      if (this.insideArtifact) {
        if (this.insideAction && this.currentAction) {
          const endTag = this.fallbackMode ? "```" : ARTIFACT_ACTION_TAG_CLOSE;
          const closeIndex = input.indexOf(endTag, i);

          if (closeIndex !== -1) {
            const finalDelta = input.slice(i, closeIndex);
            if (finalDelta) {
              this.currentAction.content += finalDelta;
              this.callbacks.onActionStream?.(this.currentAction, finalDelta);
            }

            if (this.currentAction.type === "file") {
              this.currentAction.content = cleanFileContent(this.currentAction.content);
            } else {
              this.currentAction.content = this.currentAction.content.trim();
            }

            this.currentAction.status = "complete";
            this.callbacks.onActionComplete?.(this.currentAction);

            this.insideAction = false;
            this.currentAction = null;
            i = closeIndex + endTag.length;

            if (this.fallbackMode) {
              this.finish();
              return;
            }
          } else {
            // Stream available delta while reserving enough space for the close tag
            const safeLength = Math.max(0, input.length - (endTag.length - 1));
            if (safeLength > i) {
              const delta = input.slice(i, safeLength);
              this.currentAction.content += delta;
              this.callbacks.onActionStream?.(this.currentAction, delta);
              i = safeLength;
            }
            break;
          }
        } else {
          // Inside artifact, searching for next <boltAction or </boltArtifact>
          const actionOpenIndex = input.indexOf(ARTIFACT_ACTION_TAG_OPEN, i);
          const artifactCloseIndex = input.indexOf(ARTIFACT_TAG_CLOSE, i);

          if (
            actionOpenIndex !== -1 &&
            (artifactCloseIndex === -1 || actionOpenIndex < artifactCloseIndex)
          ) {
            const actionTagEnd = input.indexOf(">", actionOpenIndex);

            if (actionTagEnd !== -1) {
              const actionTag = input.slice(actionOpenIndex, actionTagEnd + 1);
              const actionType = (extractAttribute(actionTag, "type") || "file").toLowerCase() as
                | "file"
                | "shell";
              const filePath = extractAttribute(actionTag, "filePath") || undefined;

              this.actionCounter++;
              const action: BoltAction = {
                id: `action-${Date.now()}-${this.actionCounter}`,
                type: actionType,
                filePath,
                content: "",
                status: "running",
              };

              this.currentAction = action;
              this.insideAction = true;
              this.callbacks.onActionStart?.(action);

              i = actionTagEnd + 1;
            } else {
              // Wait for full opening tag
              break;
            }
          } else if (artifactCloseIndex !== -1) {
            this.insideArtifact = false;
            this.currentArtifact = null;
            this.callbacks.onArtifactComplete?.();
            i = artifactCloseIndex + ARTIFACT_TAG_CLOSE.length;
          } else {
            break;
          }
        }
      } else {
        // Outside artifact: look for <boltArtifact or fallback markdown code fence
        const artifactOpenIndex = input.indexOf(ARTIFACT_TAG_OPEN, i);

        if (artifactOpenIndex !== -1) {
          const artifactTagEnd = input.indexOf(">", artifactOpenIndex);

          if (artifactTagEnd !== -1) {
            // Thought before artifact
            if (artifactOpenIndex > i) {
              const thought = input.slice(i, artifactOpenIndex).trim();
              if (thought) {
                this.thoughtBuffer += (this.thoughtBuffer ? "\n\n" : "") + thought;
                this.callbacks.onThought?.(this.thoughtBuffer);
              }
            }

            const artifactTag = input.slice(artifactOpenIndex, artifactTagEnd + 1);
            const artifactId = extractAttribute(artifactTag, "id") || "project-update";
            const artifactTitle = extractAttribute(artifactTag, "title") || "Generated Application";

            this.currentArtifact = { id: artifactId, title: artifactTitle };
            this.insideArtifact = true;
            this.callbacks.onArtifactStart?.(this.currentArtifact);

            i = artifactTagEnd + 1;
          } else {
            // Incomplete tag, wait for more chunks
            break;
          }
        } else {
          // Check for fallback markdown code block: ```tsx or ```jsx
          const markdownSlice = input.slice(i);
          const markdownMatch = markdownSlice.match(/```(?:tsx|jsx|typescript|javascript|react)?\s*\n/i);

          if (markdownMatch && markdownMatch.index !== undefined) {
            const matchIndex = i + markdownMatch.index;
            if (matchIndex > i) {
              const thought = input.slice(i, matchIndex).trim();
              if (thought) {
                this.thoughtBuffer += (this.thoughtBuffer ? "\n\n" : "") + thought;
                this.callbacks.onThought?.(this.thoughtBuffer);
              }
            }

            this.fallbackMode = true;
            this.insideArtifact = true;
            this.currentArtifact = { id: "generated-app", title: "Generated Application" };
            this.callbacks.onArtifactStart?.(this.currentArtifact);

            this.actionCounter++;
            const action: BoltAction = {
              id: `action-${Date.now()}-${this.actionCounter}`,
              type: "file",
              filePath: "src/App.tsx",
              content: "",
              status: "running",
            };

            this.currentAction = action;
            this.insideAction = true;
            this.callbacks.onActionStart?.(action);

            i = matchIndex + markdownMatch[0].length;
          } else {
            // Outside artifact text (streamed reasoning)
            const safeLength = Math.max(0, input.length - (ARTIFACT_TAG_OPEN.length - 1));
            if (safeLength > i) {
              const delta = input.slice(i, safeLength);
              if (delta) {
                this.thoughtBuffer += delta;
                this.callbacks.onThought?.(this.thoughtBuffer.trim());
              }
              i = safeLength;
            }
            break;
          }
        }
      }
    }

    this.position = i;
  }

  public finish(): void {
    if (this.currentAction) {
      const remaining = this.fullInput.slice(this.position);
      if (remaining) {
        this.currentAction.content += remaining;
      }

      if (this.currentAction.type === "file") {
        this.currentAction.content = cleanFileContent(this.currentAction.content);
      } else {
        this.currentAction.content = this.currentAction.content.trim();
      }

      this.currentAction.status = "complete";
      this.callbacks.onActionComplete?.(this.currentAction);
      this.currentAction = null;
      this.insideAction = false;
    }

    if (this.insideArtifact) {
      this.insideArtifact = false;
      this.currentArtifact = null;
      this.callbacks.onArtifactComplete?.();
    }

    this.fallbackMode = false;
  }
}
