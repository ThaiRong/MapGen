import type { Project } from "./types";

export interface History {
  past: Project[];
  future: Project[];
}

export const HISTORY_LIMIT = 100;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export function commit(history: History, project: Project): History {
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), project],
    future: [],
  };
}

export interface HistoryStep {
  history: History;
  project: Project | null;
}

export function undo(history: History, current: Project): HistoryStep {
  if (history.past.length === 0) return { history, project: null };
  const previous = history.past[history.past.length - 1];
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
    project: previous,
  };
}

export function redo(history: History, current: Project): HistoryStep {
  if (history.future.length === 0) return { history, project: null };
  const next = history.future[0];
  return {
    history: { past: [...history.past, current], future: history.future.slice(1) },
    project: next,
  };
}
