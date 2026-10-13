import { describe, expect, it } from "vitest";
import { emptyProject, ingestFile } from "@cutroom/session-model";
import { editorReducer, initialEditor, timelineDuration } from "./editor";

const media = { path: "/h.wav", durationSec: 10, channelCount: 1, sampleRate: 48000 };

function loaded() {
  const project = ingestFile(ingestFile(emptyProject(), media, "Host"), { ...media, path: "/g.wav" }, "Guest");
  return editorReducer(initialEditor(), { type: "replace", project });
}

describe("editorReducer", () => {
  it("cuts a range on every track and shortens the timeline", () => {
    const s = editorReducer(loaded(), { type: "cut", t0: 2, t1: 5 });
    expect(timelineDuration(s.project)).toBeCloseTo(7);
    expect(s.project.clips.filter((c) => c.trackId === s.project.tracks[1].id)).toHaveLength(2);
  });

  it("undo and redo restore the project", () => {
    const before = loaded();
    const cut = editorReducer(before, { type: "cut", t0: 2, t1: 5 });
    const undone = editorReducer(cut, { type: "undo" });
    expect(undone.project).toBe(before.project);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.project).toBe(cut.project);
  });

  it("a new edit clears redo", () => {
    const cut = editorReducer(loaded(), { type: "cut", t0: 2, t1: 5 });
    const undone = editorReducer(cut, { type: "undo" });
    const again = editorReducer(undone, { type: "cut", t0: 0, t1: 1 });
    expect(again.future).toHaveLength(0);
  });

  it("toggles mute and solo per track", () => {
    const s = loaded();
    const id = s.project.tracks[0].id;
    const muted = editorReducer(s, { type: "toggleMute", trackId: id });
    expect(muted.project.tracks[0].mute).toBe(true);
    const soloed = editorReducer(muted, { type: "toggleSolo", trackId: id });
    expect(soloed.project.tracks[0].solo).toBe(true);
  });

  it("ignores an empty cut", () => {
    const s = loaded();
    expect(editorReducer(s, { type: "cut", t0: 3, t1: 3 })).toBe(s);
  });
});
