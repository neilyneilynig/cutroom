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

export const importWav = (path: string) => invoke<ImportedWav>("import_wav", { path });
export const exportWav = (project: Project, dest: string) => invoke<void>("export_wav", { project, dest });
export const play = (project: Project, fromSec: number) => invoke<void>("play", { project, fromSec });
export const stop = () => invoke<void>("stop");
