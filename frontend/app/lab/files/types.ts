export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface TreeResponse {
  path: string;
  entries: FileEntry[];
}

export interface ContentResponse {
  path: string;
  name: string;
  language: string;
  size: number;
  content: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface TreeNode {
  entry: FileEntry;
  depth: number;
  isOpen: boolean;
  isLoading: boolean;
  children?: TreeNode[];
  isLoaded: boolean;
  error?: string;
}

export interface FlatItem {
  path: string;
  name: string;
  type: "file" | "directory";
  depth: number;
  isOpen: boolean;
  isLoading: boolean;
  isLoaded: boolean;
  hasChildren: boolean;
  error?: string;
}
