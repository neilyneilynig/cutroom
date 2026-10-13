import { describe, expect, it } from "vitest";
import { removeLinkedRange, removeTimelineRange } from "./edl";
import type { Clip, Project } from "./types";

function mk(id: string, sourceInSec: number, sourceOutSec: number, timelineStartSec: number, trackId = "t1"): Clip {
  return {
    id,
    trackId,
    fileId: "f1",
    sourceInSec,
    sourceOutSec,
    timelineStartSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
  };
}

describe("removeTimelineRange", () => {
  it("leaves a clip wholly before the range unchanged", () => {
    const out = removeTimelineRange([mk("c1", 0, 2, 0)], 3, 5);
    expect(out).toEqual([mk("c1", 0, 2, 0)]);
  });

  it("shifts a clip wholly after the range left by its length", () => {
    const out = removeTimelineRange([mk("c1", 0, 2, 6)], 3, 5);
    expect(out[0].timelineStartSec).toBe(4);
    expect(out[0].sourceInSec).toBe(0);
  });

  it("drops a clip wholly inside the range", () => {
    expect(removeTimelineRange([mk("c1", 0, 1, 3.5)], 3, 5)).toEqual([]);
  });

  it("trims the tail of a clip overlapping the range start", () => {
    const out = removeTimelineRange([mk("c1", 10, 14, 0)], 3, 5);
    expect(out).toHaveLength(1);
    expect(out[0].sourceOutSec).toBe(13);
    expect(out[0].timelineStartSec).toBe(0);
  });

  it("trims the head of a clip overlapping the range end", () => {
    const out = removeTimelineRange([mk("c1", 10, 16, 4)], 3, 5);
    expect(out).toHaveLength(1);
    expect(out[0].sourceInSec).toBe(11);
    expect(out[0].timelineStartSec).toBe(3);
  });

  it("splits a clip that contains the deleted range", () => {
    const out = removeTimelineRange([mk("c1", 0, 10, 0)], 3, 5);
    expect(out).toHaveLength(2);
    expect(out[0].sourceOutSec).toBe(3);
    expect(out[1].sourceInSec).toBe(5);
    expect(out[1].timelineStartSec).toBe(3);
    expect(out[1].id).not.toBe(out[0].id);
  });

  it("is a no-op for an empty or inverted range", () => {
    const clips = [mk("c1", 0, 10, 0)];
    expect(removeTimelineRange(clips, 5, 5)).toEqual(clips);
    expect(removeTimelineRange(clips, 5, 3)).toEqual(clips);
  });

  it("does not stack fades onto the cut edges of a split", () => {
    const out = removeTimelineRange([{ ...mk("c1", 0, 10, 0), fadeInSec: 1, fadeOutSec: 1 }], 3, 5);
    expect(out[0].fadeInSec).toBe(1);
    expect(out[0].fadeOutSec).toBe(0);
    expect(out[1].fadeInSec).toBe(0);
    expect(out[1].fadeOutSec).toBe(1);
  });
});

describe("removeLinkedRange", () => {
  it("closes the same hole on every track", () => {
    const project: Project = {
      id: "p1",
      sampleRate: 48000,
      files: [],
      tracks: [],
      clips: [mk("a", 0, 10, 0, "t1"), mk("b", 0, 10, 0, "t2")],
      words: [],
      markers: [],
    };
    const next = removeLinkedRange(project, 2, 4);
    for (const trackId of ["t1", "t2"]) {
      const clips = next.clips.filter((c) => c.trackId === trackId);
      const total = clips.reduce((sum, c) => sum + (c.sourceOutSec - c.sourceInSec), 0);
      expect(total).toBe(8);
      expect(clips[1].timelineStartSec).toBe(2);
    }
  });
});
