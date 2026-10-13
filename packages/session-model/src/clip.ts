import type { Clip } from "./types";

export function clipDuration(clip: Clip): number {
  return clip.sourceOutSec - clip.sourceInSec;
}

export function clipEnd(clip: Clip): number {
  return clip.timelineStartSec + clipDuration(clip);
}

export function sourceToTimeline(clip: Clip, sourceSec: number): number | null {
  if (sourceSec < clip.sourceInSec || sourceSec >= clip.sourceOutSec) {
    return null;
  }
  return clip.timelineStartSec + (sourceSec - clip.sourceInSec);
}

export function timelineToSource(clip: Clip, timelineSec: number): number | null {
  const end = clipEnd(clip);
  if (timelineSec < clip.timelineStartSec || timelineSec >= end) {
    return null;
  }
  return clip.sourceInSec + (timelineSec - clip.timelineStartSec);
}

export function coveringClip(clips: Clip[], trackId: string, sourceSec: number): Clip | undefined {
  return clips.find(
    (clip) =>
      clip.trackId === trackId &&
      sourceSec >= clip.sourceInSec &&
      sourceSec < clip.sourceOutSec,
  );
}

export function clampFades(clip: Clip): Clip {
  const duration = Math.max(0, clipDuration(clip));
  let fadeInSec = Math.max(0, clip.fadeInSec);
  let fadeOutSec = Math.max(0, clip.fadeOutSec);
  if (fadeInSec + fadeOutSec > duration) {
    if (duration === 0) {
      fadeInSec = 0;
      fadeOutSec = 0;
    } else {
      const scale = duration / (fadeInSec + fadeOutSec);
      fadeInSec *= scale;
      fadeOutSec *= scale;
    }
  }
  return { ...clip, fadeInSec, fadeOutSec };
}
