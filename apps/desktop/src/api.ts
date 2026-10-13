import { invoke } from "@tauri-apps/api/core";
import type { Project } from "@cutroom/session-model";

export type ImportedWav = {
  path: string;
  sampleRate: number;
  channelCount: number;
  durationSec: number;
  peaksPerSec: number;
  peaks: number[];
};

export type Peaks = { peaksPerSec: number; data: Float32Array };

export type ExportOptions = {
  format: { kind: "wav" } | { kind: "mp3"; kbps: number };
  normalize: boolean;
};

export type Loudness = { integratedLufs: number; truePeakDbtp: number };
export type ExportReport = { before: Loudness; gainDb: number };
export type TranscribedWord = { startSec: number; endSec: number; text: string; confidence: number };
export type TranscribeProgress = { trackId: string; percent: number };

export const importWav = (path: string) => invoke<ImportedWav>("import_wav", { path });
export const exportMix = (project: Project, dest: string, options: ExportOptions) =>
  invoke<ExportReport>("export", { project, dest, options });
export const measureMix = (project: Project) => invoke<Loudness>("measure_mix", { project });
export const findModel = () => invoke<string | null>("find_model");
export const installModel = (source: string) => invoke<string>("install_model", { source });
export const transcribe = (model: string, path: string, trackId: string) =>
  invoke<TranscribedWord[]>("transcribe", { model, path, trackId });
export const saveProject = (path: string, contents: string) => invoke<void>("save_project", { path, contents });
export const loadProject = (path: string) => invoke<string>("load_project", { path });
export const play = (project: Project, fromSec: number) => invoke<void>("play", { project, fromSec });
export const stop = () => invoke<void>("stop");
