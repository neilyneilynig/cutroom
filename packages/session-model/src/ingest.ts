import { nanoid } from "nanoid";
import { MAX_TRACKS, type MediaFile, type Project, type TrackKind } from "./types";

export function emptyProject(): Project {
  return { id: nanoid(), sampleRate: 0, files: [], tracks: [], clips: [], words: [], markers: [] };
}

// Adds a file as a new track holding one full-length clip. The first file locks the sample rate.
export function ingestFile(
  project: Project,
  media: Omit<MediaFile, "id">,
  trackName: string,
  kind: TrackKind = "dialogue",
): Project {
  if (project.tracks.length >= MAX_TRACKS) {
    throw new Error(`V1 supports at most ${MAX_TRACKS} tracks`);
  }
  if (project.sampleRate !== 0 && media.sampleRate !== project.sampleRate) {
    throw new Error(
      `Sample rate mismatch: project is ${project.sampleRate} Hz, ${media.path} is ${media.sampleRate} Hz`,
    );
  }
  const file: MediaFile = { ...media, id: nanoid() };
  const track = { id: nanoid(), name: trackName, kind, order: project.tracks.length, mute: false, solo: false };
  const clip = {
    id: nanoid(),
    trackId: track.id,
    fileId: file.id,
    sourceInSec: 0,
    sourceOutSec: media.durationSec,
    timelineStartSec: 0,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
  };
  return {
    ...project,
    sampleRate: project.sampleRate || media.sampleRate,
    files: [...project.files, file],
    tracks: [...project.tracks, track],
    clips: [...project.clips, clip],
  };
}
