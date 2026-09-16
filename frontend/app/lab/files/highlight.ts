/**
 * Syntax highlighter token-based untuk Code Explorer.
 * Mendukung: go, typescript, tsx, javascript, json, css, bash, yaml, markdown.
 * Render per token / baris untuk performa tinggi tanpa dependency eksternal.
 */

export type TokenType =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "boolean"
  | "function"
  | "property"
  | "punctuation"
  | "operator"
  | "tag"
  | "attr"
  | "type"
  | "variable"
  | "plain";

export interface Token {
  type: TokenType;
  text: string;
}

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends",
  "finally", "for", "from", "function", "if", "import", "in", "instanceof",
  "let", "new", "return", "super", "switch", "this", "throw", "try",
  "typeof", "var", "void", "while", "with", "yield", "interface", "type",
  "namespace", "enum", "implements", "private", "protected", "public",
  "readonly", "static", "declare", "as"
]);

const GO_KEYWORDS = new Set([
  "break", "default", "func", "interface", "select",
  "case", "defer", "go", "map", "struct",
  "chan", "else", "goto", "package", "switch",
  "const", "fallthrough", "if", "range", "type",
  "continue", "for", "import", "return", "var"
]);

const BASH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "select",
  "while", "until", "do", "done", "in", "function", "time", "return",
  "exit", "set", "export", "alias", "unset", "echo"
]);

const GO_TYPES = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr"
]);

function normalizeLang(lang?: string): string {
  if (!lang) return "plaintext";
  const l = lang.toLowerCase().trim();
  if (l === "ts" || l === "typescript") return "typescript";
  if (l === "tsx") return "tsx";
  if (l === "js" || l === "javascript") return "javascript";
  if (l === "jsx") return "tsx";
  if (l === "golang" || l === "go") return "go";
  if (l === "sh" || l === "bash" || l === "shell" || l === "zsh") return "bash";
  if (l === "json") return "json";
  if (l === "css" || l === "scss" || l === "less") return "css";
  if (l === "yaml" || l === "yml") return "yaml";
  if (l === "md" || l === "markdown") return "markdown";
  return "plaintext";
}

export function highlightLine(line: string, language: string): Token[] {
  const lang = normalizeLang(language);
  if (lang === "plaintext" || line.length === 0) {
    return [{ type: "plain", text: line }];
  }

  const tokens: Token[] = [];
  let i = 0;
  const len = line.length;

  const pushToken = (type: TokenType, text: string) => {
    if (!text) return;
    if (tokens.length > 0 && tokens[tokens.length - 1].type === type) {
      tokens[tokens.length - 1].text += text;
    } else {
      tokens.push({ type, text });
    }
  };

  // Helper scan string
  const scanString = (quoteChar: string): string => {
    let s = quoteChar;
    i++;
    while (i < len) {
      const ch = line[i];
      if (ch === "\\") {
        s += ch;
        i++;
        if (i < len) {
          s += line[i];
          i++;
        }
      } else if (ch === quoteChar) {
        s += ch;
        i++;
        break;
      } else {
        s += ch;
        i++;
      }
    }
    return s;
  };

  // Helper scan identifier/word
  const isWordChar = (ch: string) => /[a-zA-Z0-9_$]/.test(ch);

  // Markdown parser per baris
  if (lang === "markdown") {
    // Header
    const headerMatch = line.match(/^(#{1,6}\s+)(.*)$/);
    if (headerMatch) {
      tokens.push({ type: "keyword", text: headerMatch[1] });
      tokens.push({ type: "function", text: headerMatch[2] });
      return tokens;
    }
    // List item
    const listMatch = line.match(/^(\s*[-*+]\s+|\s*\d+\.\s+)(.*)$/);
    if (listMatch) {
      tokens.push({ type: "punctuation", text: listMatch[1] });
      tokens.push({ type: "plain", text: listMatch[2] });
      return tokens;
    }
    // Blockquote
    if (line.trimStart().startsWith(">")) {
      tokens.push({ type: "comment", text: line });
      return tokens;
    }
  }

  // YAML parser per baris
  if (lang === "yaml") {
    // Comment
    const commentIdx = line.indexOf("#");
    let contentPart = line;
    let commentPart = "";
    if (commentIdx !== -1) {
      contentPart = line.slice(0, commentIdx);
      commentPart = line.slice(commentIdx);
    }

    const keyValMatch = contentPart.match(/^(\s*)([\w.-]+)(\s*:)(.*)$/);
    if (keyValMatch) {
      if (keyValMatch[1]) tokens.push({ type: "plain", text: keyValMatch[1] });
      tokens.push({ type: "property", text: keyValMatch[2] });
      tokens.push({ type: "punctuation", text: keyValMatch[3] });
      const val = keyValMatch[4];
      if (val) {
        const trimmed = val.trim();
        if (trimmed === "true" || trimmed === "false" || trimmed === "null") {
          tokens.push({ type: "boolean", text: val });
        } else if (!isNaN(Number(trimmed)) && trimmed !== "") {
          tokens.push({ type: "number", text: val });
        } else if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          tokens.push({ type: "string", text: val });
        } else {
          tokens.push({ type: "string", text: val });
        }
      }
      if (commentPart) tokens.push({ type: "comment", text: commentPart });
      return tokens;
    }
  }

  // General Tokenizer Loop
  while (i < len) {
    const ch = line[i];

    // 1. Whitespace
    if (/\s/.test(ch)) {
      let ws = "";
      while (i < len && /\s/.test(line[i])) {
        ws += line[i];
        i++;
      }
      pushToken("plain", ws);
      continue;
    }

    // 2. Comments
    if (
      (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "go" || lang === "css") &&
      ch === "/" &&
      line[i + 1] === "/"
    ) {
      pushToken("comment", line.slice(i));
      break;
    }
    if (
      (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "go" || lang === "css") &&
      ch === "/" &&
      line[i + 1] === "*"
    ) {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx !== -1) {
        pushToken("comment", line.slice(i, endIdx + 2));
        i = endIdx + 2;
        continue;
      } else {
        pushToken("comment", line.slice(i));
        break;
      }
    }
    if ((lang === "bash" || lang === "yaml") && ch === "#") {
      pushToken("comment", line.slice(i));
      break;
    }

    // 3. Strings
    if (ch === "\"" || ch === "'" || (ch === "`" && (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "go"))) {
      const str = scanString(ch);
      pushToken("string", str);
      continue;
    }

    // 4. Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z0-9_$]/.test(line[i - 1]))) {
      let num = "";
      while (i < len && /[0-9a-fA-FxXoObB._]/.test(line[i])) {
        num += line[i];
        i++;
      }
      pushToken("number", num);
      continue;
    }

    // 5. TSX / HTML Tags
    if ((lang === "tsx" || lang === "html") && ch === "<" && /[a-zA-Z\/_]/.test(line[i + 1] || "")) {
      let tag = "<";
      i++;
      if (line[i] === "/") {
        tag += "/";
        i++;
      }
      while (i < len && /[a-zA-Z0-9_.-]/.test(line[i])) {
        tag += line[i];
        i++;
      }
      pushToken("tag", tag);
      continue;
    }

    // 6. Words / Identifiers
    if (/[a-zA-Z_$]/.test(ch)) {
      let word = "";
      while (i < len && isWordChar(line[i])) {
        word += line[i];
        i++;
      }

      // Check keyword / boolean / type
      if (lang === "typescript" || lang === "tsx" || lang === "javascript") {
        if (JS_KEYWORDS.has(word)) {
          pushToken("keyword", word);
        } else if (word === "true" || word === "false" || word === "null" || word === "undefined") {
          pushToken("boolean", word);
        } else if (i < len && line[i] === "(") {
          pushToken("function", word);
        } else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(word)) {
          pushToken("type", word);
        } else {
          pushToken("plain", word);
        }
        continue;
      }

      if (lang === "go") {
        if (GO_KEYWORDS.has(word)) {
          pushToken("keyword", word);
        } else if (GO_TYPES.has(word)) {
          pushToken("type", word);
        } else if (word === "true" || word === "false" || word === "nil" || word === "iota") {
          pushToken("boolean", word);
        } else if (i < len && line[i] === "(") {
          pushToken("function", word);
        } else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(word)) {
          pushToken("type", word);
        } else {
          pushToken("plain", word);
        }
        continue;
      }

      if (lang === "bash") {
        if (BASH_KEYWORDS.has(word)) {
          pushToken("keyword", word);
        } else {
          pushToken("plain", word);
        }
        continue;
      }

      if (lang === "json") {
        if (word === "true" || word === "false" || word === "null") {
          pushToken("boolean", word);
        } else {
          pushToken("plain", word);
        }
        continue;
      }

      if (lang === "css") {
        if (i < len && line[i] === ":") {
          pushToken("property", word);
        } else {
          pushToken("plain", word);
        }
        continue;
      }

      pushToken("plain", word);
      continue;
    }

    // 7. Operators & Punctuation
    if (/[{}()\[\],;:.]/.test(ch)) {
      pushToken("punctuation", ch);
      i++;
      continue;
    }

    if (/[=+\-*/%&|^!~<>?:]/.test(ch)) {
      let op = "";
      while (i < len && /[=+\-*/%&|^!~<>?:]/.test(line[i])) {
        op += line[i];
        i++;
      }
      pushToken("operator", op);
      continue;
    }

    // Fallback single character
    pushToken("plain", ch);
    i++;
  }

  return tokens;
}

export function getTokenClassName(type: TokenType): string {
  switch (type) {
    case "keyword":
      return "text-amber-600 dark:text-amber-400 font-medium";
    case "string":
      return "text-emerald-600 dark:text-emerald-400";
    case "comment":
      return "text-neutral-400 dark:text-neutral-500 italic";
    case "number":
    case "boolean":
      return "text-orange-600 dark:text-orange-400";
    case "function":
      return "text-blue-600 dark:text-blue-400 font-medium";
    case "property":
    case "attr":
      return "text-violet-600 dark:text-violet-400";
    case "tag":
      return "text-rose-600 dark:text-rose-400 font-medium";
    case "type":
      return "text-yellow-600 dark:text-yellow-500 font-medium";
    case "variable":
      return "text-teal-600 dark:text-teal-400";
    case "operator":
      return "text-neutral-500 dark:text-neutral-400";
    case "punctuation":
      return "text-neutral-400 dark:text-neutral-500";
    case "plain":
    default:
      return "text-ink";
  }
}
