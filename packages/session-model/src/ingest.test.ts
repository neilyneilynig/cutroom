import { describe, expect, it } from "vitest";
import { emptyProject, ingestFile } from "./ingest";

const host = { path: "/a/host.wav", durationSec: 10, channelCount: 1, sampleRate: 48000 };

describe("ingestFile", () => {
  it("locks the project sample rate to the first file and adds one full-length clip on a new track", () => {
    const p = ingestFile(emptyProject(), host, "Host");
    expect(p.sampleRate).toBe(48000);
    expect(p.files).toHaveLength(1);
    expect(p.tracks).toEqual([expect.objectContaining({ name: "Host", kind: "dialogue", order: 0 })]);
    expect(p.clips[0]).toEqual(
      expect.objectContaining({
        trackId: p.tracks[0].id,
        fileId: p.files[0].id,
        sourceInSec: 0,
        sourceOutSec: 10,
        timelineStartSec: 0,
      }),
    );
  });

  it("rejects a second file at a different sample rate", () => {
    const p = ingestFile(emptyProject(), host, "Host");
    expect(() => ingestFile(p, { ...host, path: "/b.wav", sampleRate: 44100 }, "Guest")).toThrow(/44100/);
  });

  it("rejects a fifth track", () => {
    let p = emptyProject();
    for (let i = 0; i < 4; i++) p = ingestFile(p, { ...host, path: `/${i}.wav` }, `T${i}`);
    expect(() => ingestFile(p, host, "T5")).toThrow(/4 tracks/);
  });
});
