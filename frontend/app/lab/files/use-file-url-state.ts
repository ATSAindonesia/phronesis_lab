import { useCallback, useEffect, useState } from "react";

export interface FileUrlState {
  file: string;
  openDirs: string[];
}

export function parseUrlState(): FileUrlState {
  if (typeof window === "undefined") {
    return { file: "", openDirs: [] };
  }
  const params = new URLSearchParams(window.location.search);
  const file = params.get("file") || "";
  const openParam = params.get("open") || "";
  const openDirs = openParam
    ? openParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // If a file is selected, ensure all its ancestor directories are also considered open
  if (file) {
    const parts = file.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i];
      if (!openDirs.includes(acc)) {
        openDirs.push(acc);
      }
    }
  }

  return { file, openDirs };
}

export function updateUrlState(
  file: string,
  openDirs: string[],
  action: "push" | "replace" = "push"
) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  if (file) {
    params.set("file", file);
  }
  const uniqueOpen = Array.from(new Set(openDirs)).filter(Boolean);
  if (uniqueOpen.length > 0) {
    params.set("open", uniqueOpen.join(","));
  }

  const queryString = params.toString();
  const newUrl =
    window.location.pathname + (queryString ? "?" + queryString : "") + window.location.hash;

  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (newUrl === currentUrl) return;

  if (action === "push") {
    window.history.pushState({ file, openDirs: uniqueOpen }, "", newUrl);
  } else {
    window.history.replaceState({ file, openDirs: uniqueOpen }, "", newUrl);
  }
}
