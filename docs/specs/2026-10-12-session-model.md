# Cutroom session model

Date: 2026-10-12

## Purpose

Professional editors cut client podcasts without rewriting media files. The session is an edit decision list (EDL): clips reference original files by path and source in/out. Transcript words belong to those source ranges. A text delete is a timeline-range delete across all tracks (linked ripple), which is how conversation editing works on split-track interviews.

## Invariants

- Sample rate is locked at ingest (48 kHz preferred; first file wins).
- Original media is never overwritten.
- Clip duration is `sourceOutSec - sourceInSec`. Timeline end is `timelineStartSec + duration`.
- Word times are **source-relative** (seconds into the original file), not timeline-relative.
- A word is audible/visible iff some clip on its track covers that source time.
- Linked ripple delete of `[t0, t1)` on the timeline removes that range from **every** track and closes the gap.
- Per-clip trim/split on the timeline does not have to ripple other tracks (finish work).
- Podcast loudness target: −16 LUFS integrated, true peak ≤ −1 dBTP.

## Objects

- `Project` — id, sampleRate, files, tracks, clips, words, markers.
- `MediaFile` — id, path, durationSec, channelCount, sampleRate.
- `Track` — id, name, kind (`dialogue` | `music` | `fx`), order, mute, solo.
- `Clip` — id, trackId, fileId, sourceInSec, sourceOutSec, timelineStartSec, gainDb, fadeInSec, fadeOutSec.
- `Word` — id, trackId, fileId, sourceStartSec, sourceEndSec, text, confidence.
- `Marker` — id, timeSec, kind (`comment` | `todo`), body, versionId?

## Mapping

Timeline time of a source instant `s` on a clip:

`timeline = clip.timelineStartSec + (s - clip.sourceInSec)`  if `sourceInSec <= s < sourceOutSec`.

Render walks clips in track order, then timeline order, applying gain and linear fades.

## V1 limits

At most 4 tracks. No nested sequences. No video. No plugins.
