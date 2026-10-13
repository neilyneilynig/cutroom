import type { TimedWord } from "@cutroom/session-model";
import type { Selection } from "./Timeline";

export type Paragraph = { trackId: string; startSec: number; words: TimedWord[] };

export function groupParagraphs(words: TimedWord[], pauseSec = 1.5): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let previous: TimedWord | undefined;
  for (const word of words) {
    const current = paragraphs.at(-1);
    const newSpeaker = !current || current.trackId !== word.word.trackId;
    const longPause = previous !== undefined && word.startSec - previous.endSec > pauseSec;
    if (newSpeaker || longPause) {
      paragraphs.push({ trackId: word.word.trackId, startSec: word.startSec, words: [word] });
    } else {
      current.words.push(word);
    }
    previous = word;
  }
  return paragraphs;
}

export function wordRangeSelection(words: TimedWord[], anchor: number, focus: number): Selection {
  const lo = Math.min(anchor, focus);
  const hi = Math.max(anchor, focus);
  const t1 = words.slice(lo, hi + 1).reduce((max, w) => Math.max(max, w.endSec), words[hi].endSec);
  return { t0: words[lo].startSec, t1 };
}
