import { sourceToTimeline } from "./clip";
import { removeLinkedRange } from "./edl";
import type { Project, Word } from "./types";

// Timeline time of a word's start, or null if no clip on its track covers it.
export function wordTimelineStart(project: Project, word: Word): number | null {
  for (const clip of project.clips) {
    if (clip.trackId !== word.trackId || clip.fileId !== word.fileId) {
      continue;
    }
    const t = sourceToTimeline(clip, word.sourceStartSec);
    if (t !== null) {
      return t;
    }
  }
  return null;
}

export function visibleWords(project: Project): Word[] {
  return project.words
    .map((word) => ({ word, t: wordTimelineStart(project, word) }))
    .filter((entry): entry is { word: Word; t: number } => entry.t !== null)
    .sort((a, b) => a.t - b.t)
    .map((entry) => entry.word);
}

export function deleteWords(project: Project, wordIds: string[]): Project {
  const ids = new Set(wordIds);
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const word of project.words) {
    if (!ids.has(word.id)) {
      continue;
    }
    const start = wordTimelineStart(project, word);
    if (start === null) {
      continue;
    }
    t0 = Math.min(t0, start);
    t1 = Math.max(t1, start + (word.sourceEndSec - word.sourceStartSec));
  }
  if (t1 <= t0) {
    return project;
  }
  return removeLinkedRange(project, t0, t1);
}

export type TimedWord = { word: Word; startSec: number; endSec: number };

export function timelineWords(project: Project): TimedWord[] {
  return visibleWords(project).map((word) => {
    const startSec = wordTimelineStart(project, word)!;
    return { word, startSec, endSec: startSec + (word.sourceEndSec - word.sourceStartSec) };
  });
}
