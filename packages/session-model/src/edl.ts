import { nanoid } from "nanoid";
import { clipEnd } from "./clip";
import type { Clip, Project } from "./types";

// Removes timeline [t0, t1) from the clips and closes the gap (ripple).
// Edges created by the cut get no fade; the clip's outer fades are kept.
export function removeTimelineRange(clips: Clip[], t0: number, t1: number): Clip[] {
  if (t1 <= t0) {
    return clips;
  }
  const gap = t1 - t0;
  const out: Clip[] = [];
  for (const clip of clips) {
    const start = clip.timelineStartSec;
    const end = clipEnd(clip);
    if (end <= t0) {
      out.push(clip);
    } else if (start >= t1) {
      out.push({ ...clip, timelineStartSec: start - gap });
    } else if (start >= t0 && end <= t1) {
      continue;
    } else if (start < t0 && end > t1) {
      out.push({ ...clip, sourceOutSec: clip.sourceInSec + (t0 - start), fadeOutSec: 0 });
      out.push({
        ...clip,
        id: nanoid(),
        sourceInSec: clip.sourceInSec + (t1 - start),
        timelineStartSec: t0,
        fadeInSec: 0,
      });
    } else if (start < t0) {
      out.push({ ...clip, sourceOutSec: clip.sourceInSec + (t0 - start), fadeOutSec: 0 });
    } else {
      out.push({ ...clip, sourceInSec: clip.sourceInSec + (t1 - start), timelineStartSec: t0, fadeInSec: 0 });
    }
  }
  return out;
}

export function removeLinkedRange(project: Project, t0: number, t1: number): Project {
  const trackIds = [...new Set(project.clips.map((clip) => clip.trackId))];
  const clips = trackIds.flatMap((trackId) =>
    removeTimelineRange(
      project.clips.filter((clip) => clip.trackId === trackId),
      t0,
      t1,
    ),
  );
  return { ...project, clips };
}
