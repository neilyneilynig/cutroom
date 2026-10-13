import { nanoid } from "nanoid";
import { clampFades, clipEnd } from "./clip";
import type { Clip, Project, Word } from "./types";

export type ClipPatch = Partial<Pick<Clip, "gainDb" | "fadeInSec" | "fadeOutSec">>;

export function updateClip(project: Project, clipId: string, patch: ClipPatch): Project {
  return {
    ...project,
    clips: project.clips.map((clip) => (clip.id === clipId ? clampFades({ ...clip, ...patch }) : clip)),
  };
}

export function clipAt(project: Project, trackId: string, timelineSec: number): Clip | undefined {
  return project.clips.find(
    (clip) => clip.trackId === trackId && timelineSec >= clip.timelineStartSec && timelineSec < clipEnd(clip),
  );
}

// Splits one clip at a timeline time. Nothing moves; the new edges get no fade.
export function splitClip(project: Project, clipId: string, timelineSec: number): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip || timelineSec <= clip.timelineStartSec || timelineSec >= clipEnd(clip)) {
    return project;
  }
  const cutSource = clip.sourceInSec + (timelineSec - clip.timelineStartSec);
  const left = clampFades({ ...clip, sourceOutSec: cutSource, fadeOutSec: 0 });
  const right = clampFades({ ...clip, id: nanoid(), sourceInSec: cutSource, timelineStartSec: timelineSec, fadeInSec: 0 });
  return { ...project, clips: project.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) };
}

export function setTrackWords(project: Project, trackId: string, words: Omit<Word, "id">[]): Project {
  return {
    ...project,
    words: [
      ...project.words.filter((word) => word.trackId !== trackId),
      ...words.map((word) => ({ ...word, id: nanoid() })),
    ],
  };
}
