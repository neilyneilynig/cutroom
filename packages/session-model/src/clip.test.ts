import { describe, expect, it } from "vitest";
import {
  clampFades,
  clipDuration,
  clipEnd,
  sourceToTimeline,
  timelineToSource,
} from "./clip";
import type { Clip } from "./types";

const clip: Clip = {
  id: "c1",
  trackId: "t1",
  fileId: "f1",
  sourceInSec: 10,
  sourceOutSec: 20,
  timelineStartSec: 5,
  gainDb: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
};

describe("clip geometry", () => {
  it("maps source 12s to timeline 7s", () => {
    expect(clipDuration(clip)).toBe(10);
    expect(clipEnd(clip)).toBe(15);
    expect(sourceToTimeline(clip, 12)).toBe(7);
    expect(timelineToSource(clip, 7)).toBe(12);
    expect(sourceToTimeline(clip, 9)).toBeNull();
    expect(sourceToTimeline(clip, 20)).toBeNull();
  });

  it("clamps fades so they do not exceed clip duration", () => {
    const faded = clampFades({ ...clip, fadeInSec: 8, fadeOutSec: 8 });
    expect(faded.fadeInSec + faded.fadeOutSec).toBeCloseTo(10);
    expect(faded.fadeInSec).toBeCloseTo(5);
    expect(faded.fadeOutSec).toBeCloseTo(5);
  });
});
