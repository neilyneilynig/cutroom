import { z } from "zod";
import type { Project } from "./types";

export const PROJECT_FORMAT = "cutroom-project";
export const PROJECT_VERSION = 1;

const projectSchema = z.object({
  id: z.string(),
  sampleRate: z.number(),
  files: z.array(
    z.object({ id: z.string(), path: z.string(), durationSec: z.number(), channelCount: z.number(), sampleRate: z.number() }),
  ),
  tracks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["dialogue", "music", "fx"]),
      order: z.number(),
      mute: z.boolean(),
      solo: z.boolean(),
    }),
  ),
  clips: z.array(
    z.object({
      id: z.string(),
      trackId: z.string(),
      fileId: z.string(),
      sourceInSec: z.number(),
      sourceOutSec: z.number(),
      timelineStartSec: z.number(),
      gainDb: z.number(),
      fadeInSec: z.number(),
      fadeOutSec: z.number(),
    }),
  ),
  words: z.array(
    z.object({
      id: z.string(),
      trackId: z.string(),
      fileId: z.string(),
      sourceStartSec: z.number(),
      sourceEndSec: z.number(),
      text: z.string(),
      confidence: z.number(),
    }),
  ),
  markers: z.array(
    z.object({
      id: z.string(),
      timeSec: z.number(),
      kind: z.enum(["comment", "todo"]),
      body: z.string(),
      versionId: z.string().optional(),
    }),
  ),
});

const fileSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  project: projectSchema,
});

export function serializeProject(project: Project): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, project }, null, 2);
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Cutroom project (invalid JSON)");
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`This file is not a Cutroom project: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data.project;
}
