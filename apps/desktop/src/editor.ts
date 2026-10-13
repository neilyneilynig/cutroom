import { clipEnd, emptyProject, removeLinkedRange, type Project } from "@cutroom/session-model";

const HISTORY_LIMIT = 200;

export type EditorState = {
  project: Project;
  past: Project[];
  future: Project[];
};

export type EditorAction =
  | { type: "replace"; project: Project }
  | { type: "cut"; t0: number; t1: number }
  | { type: "toggleMute"; trackId: string }
  | { type: "toggleSolo"; trackId: string }
  | { type: "undo" }
  | { type: "redo" };

export function initialEditor(): EditorState {
  return { project: emptyProject(), past: [], future: [] };
}

export function timelineDuration(project: Project): number {
  return project.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
}

function commit(state: EditorState, project: Project): EditorState {
  return { project, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] };
}

function updateTrack(project: Project, trackId: string, key: "mute" | "solo"): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, [key]: !t[key] } : t)),
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "replace":
      return commit(state, action.project);
    case "cut":
      if (action.t1 <= action.t0) return state;
      return commit(state, removeLinkedRange(state.project, action.t0, action.t1));
    case "toggleMute":
      return commit(state, updateTrack(state.project, action.trackId, "mute"));
    case "toggleSolo":
      return commit(state, updateTrack(state.project, action.trackId, "solo"));
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { project: previous, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { project: next, past: [...state.past, state.project], future: rest };
    }
  }
}
