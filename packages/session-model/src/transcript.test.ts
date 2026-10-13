import { describe, expect, it } from "vitest";
import { sourceToTimeline } from "./clip";
import { deleteWords, visibleWords } from "./transcript";
import type { Project, Word } from "./types";

function word(id: string, start: number, end: number, trackId = "t1"): Word {
  return { id, trackId, fileId: "f1", sourceStartSec: start, sourceEndSec: end, text: id, confidence: 1 };
}

const project: Project = {
  id: "p1",
  sampleRate: 48000,
  files: [],
  tracks: [],
  clips: [
    { id: "c1", trackId: "t1", fileId: "f1", sourceInSec: 0, sourceOutSec: 3, timelineStartSec: 0, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 },
    { id: "c2", trackId: "t2", fileId: "f2", sourceInSec: 0, sourceOutSec: 3, timelineStartSec: 0, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 },
  ],
  words: [word("w1", 0, 1), word("w2", 1, 2), word("w3", 2, 3)],
  markers: [],
};

describe("transcript", () => {
  it("shows every word covered by a clip", () => {
    expect(visibleWords(project).map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("deleting a word ripples the conversation", () => {
    const next = deleteWords(project, ["w2"]);
    const vis = visibleWords(next);
    expect(vis.map((w) => w.id)).toEqual(["w1", "w3"]);
    const t1 = next.clips.filter((c) => c.trackId === "t1");
    const covering = t1.find((c) => 2 >= c.sourceInSec && 2 < c.sourceOutSec)!;
    expect(sourceToTimeline(covering, 2)).toBeCloseTo(1);
  });

  it("closes the hole on the other track too", () => {
    const next = deleteWords(project, ["w2"]);
    const t2 = next.clips.filter((c) => c.trackId === "t2");
    expect(t2.reduce((s, c) => s + c.sourceOutSec - c.sourceInSec, 0)).toBeCloseTo(2);
  });

  it("orders visible words by timeline position", () => {
    const moved: Project = {
      ...project,
      clips: [
        { ...project.clips[0], id: "a", sourceInSec: 2, sourceOutSec: 3, timelineStartSec: 0 },
        { ...project.clips[0], id: "b", sourceInSec: 0, sourceOutSec: 1, timelineStartSec: 1 },
      ],
    };
    expect(visibleWords(moved).map((w) => w.id)).toEqual(["w3", "w1"]);
  });

  it("ignores unknown or hidden word ids", () => {
    expect(deleteWords(project, ["nope"])).toBe(project);
  });
});
