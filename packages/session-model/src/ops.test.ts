import { describe, expect, it } from "vitest";
import { emptyProject, ingestFile } from "./ingest";
import { clipAt, setTrackWords, splitClip, updateClip } from "./ops";
import { parseProject, serializeProject } from "./persist";

const media = { path: "/h.wav", durationSec: 10, channelCount: 1, sampleRate: 48000 };
const base = () => ingestFile(emptyProject(), media, "Host");

describe("clip ops", () => {
  it("updates gain and clamps fades to the clip length", () => {
    const p = base();
    const id = p.clips[0].id;
    const next = updateClip(p, id, { gainDb: -3, fadeInSec: 8, fadeOutSec: 8 });
    expect(next.clips[0].gainDb).toBe(-3);
    expect(next.clips[0].fadeInSec + next.clips[0].fadeOutSec).toBeCloseTo(10);
  });

  it("splits a clip at a timeline time without moving anything", () => {
    const p = base();
    const next = splitClip(p, p.clips[0].id, 4);
    expect(next.clips).toHaveLength(2);
    expect(next.clips[0].sourceOutSec).toBe(4);
    expect(next.clips[1]).toEqual(expect.objectContaining({ sourceInSec: 4, timelineStartSec: 4, sourceOutSec: 10 }));
  });

  it("ignores a split outside the clip", () => {
    const p = base();
    expect(splitClip(p, p.clips[0].id, 0)).toBe(p);
    expect(splitClip(p, p.clips[0].id, 12)).toBe(p);
  });

  it("finds the clip under a timeline time on a track", () => {
    const p = base();
    expect(clipAt(p, p.tracks[0].id, 3)?.id).toBe(p.clips[0].id);
    expect(clipAt(p, p.tracks[0].id, 11)).toBeUndefined();
  });

  it("replaces only that track's words", () => {
    const p = ingestFile(base(), { ...media, path: "/g.wav" }, "Guest");
    const [host, guest] = p.tracks;
    const word = (trackId: string, fileId: string, text: string) => ({ trackId, fileId, sourceStartSec: 0, sourceEndSec: 1, text, confidence: 1 });
    let next = setTrackWords(p, guest.id, [word(guest.id, p.files[1].id, "hey")]);
    next = setTrackWords(next, host.id, [word(host.id, p.files[0].id, "hi")]);
    next = setTrackWords(next, host.id, [word(host.id, p.files[0].id, "hello")]);
    expect(next.words.map((w) => w.text).sort()).toEqual(["hello", "hey"]);
    expect(new Set(next.words.map((w) => w.id)).size).toBe(2);
  });
});

describe("persist", () => {
  it("round-trips a project", () => {
    const p = base();
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("rejects a file that is not a cutroom project", () => {
    expect(() => parseProject('{"hello":1}')).toThrow(/not a Cutroom project/);
    expect(() => parseProject("nope")).toThrow(/not a Cutroom project/);
  });
});
