import { useCallback, useEffect, useState } from "react";

// State navigasi Command Sets disimpan di URL (?service=<uuid>&title=<uuid>)
// pakai History API murni — sama seperti Code Explorer, biar tombol
// back/forward browser dan deep link tetap jalan tanpa useSearchParams.

export interface CommandsUrlState {
  service: string;
  title: string;
}

export function parseUrlState(): CommandsUrlState {
  if (typeof window === "undefined") {
    return { service: "", title: "" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    service: params.get("service") || "",
    title: params.get("title") || "",
  };
}

export function updateUrlState(
  state: CommandsUrlState,
  action: "push" | "replace" = "push"
) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  if (state.service) params.set("service", state.service);
  if (state.service && state.title) params.set("title", state.title);

  const queryString = params.toString();
  const newUrl =
    window.location.pathname +
    (queryString ? "?" + queryString : "") +
    window.location.hash;

  const currentUrl =
    window.location.pathname + window.location.search + window.location.hash;
  if (newUrl === currentUrl) return;

  if (action === "push") {
    window.history.pushState(state, "", newUrl);
  } else {
    window.history.replaceState(state, "", newUrl);
  }
}

// Hook tipis: state service/title + sinkronisasi popstate.
export function useCommandsUrlState() {
  const [state, setState] = useState<CommandsUrlState>({ service: "", title: "" });

  useEffect(() => {
    setState(parseUrlState());
    const onPop = () => setState(parseUrlState());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback(
    (next: CommandsUrlState, action: "push" | "replace" = "push") => {
      updateUrlState(next, action);
      setState(next);
    },
    []
  );

  return { state, navigate };
}
