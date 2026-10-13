import { describe, expect, it } from "vitest";
import type { TimedWord } from "@cutroom/session-model";
import { groupParagraphs, wordRangeSelection } from "./paragraphs";

const tw = (id: string, trackId: string, startSec: number, endSec: number): TimedWord => ({
  word: { id, trackId, fileId: "f", sourceStartSec: startSec, sourceEndSec: endSec, text: id, confidence: 1 },
  startSec,
  endSec,
});

describe("groupParagraphs", () => {
  it("starts a new paragraph on speaker change or a long pause", () => {
    const words = [tw("a", "h", 0, 1), tw("b", "h", 1, 2), tw("c", "g", 2.1, 3), tw("d", "g", 6, 7)];
    const paras = groupParagraphs(words, 2);
    expect(paras.map((p) => p.words.map((w) => w.word.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(paras[1]).toEqual(expect.objectContaining({ trackId: "g", startSec: 2.1 }));
  });
});

describe("wordRangeSelection", () => {
  it("spans from the earlier word start to the later word end, in either direction", () => {
    const words = [tw("a", "h", 0, 1), tw("b", "h", 1.2, 2), tw("c", "h", 2.5, 3)];
    expect(wordRangeSelection(words, 2, 0)).toEqual({ t0: 0, t1: 3 });
    expect(wordRangeSelection(words, 1, 1)).toEqual({ t0: 1.2, t1: 2 });
  });
});
