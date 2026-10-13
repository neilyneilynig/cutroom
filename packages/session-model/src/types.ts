export const PODCAST_LUFS = -16;
export const TRUE_PEAK_DBTP = -1;
export const MAX_TRACKS = 4;

export type TrackKind = "dialogue" | "music" | "fx";

export type MediaFile = {
  id: string;
  path: string;
  durationSec: number;
  channelCount: number;
  sampleRate: number;
};

export type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  order: number;
  mute: boolean;
  solo: boolean;
};

export type Clip = {
  id: string;
  trackId: string;
  fileId: string;
  sourceInSec: number;
  sourceOutSec: number;
  timelineStartSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
};

export type Word = {
  id: string;
  trackId: string;
  fileId: string;
  sourceStartSec: number;
  sourceEndSec: number;
  text: string;
  confidence: number;
};

export type MarkerKind = "comment" | "todo";

export type Marker = {
  id: string;
  timeSec: number;
  kind: MarkerKind;
  body: string;
  versionId?: string;
};

export type Project = {
  id: string;
  sampleRate: number;
  files: MediaFile[];
  tracks: Track[];
  clips: Clip[];
  words: Word[];
  markers: Marker[];
};
