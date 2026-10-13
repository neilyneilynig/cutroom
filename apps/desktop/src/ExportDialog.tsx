import { useState } from "react";
import { PODCAST_LUFS, TRUE_PEAK_DBTP } from "@cutroom/session-model";
import type { ExportOptions, ExportReport } from "./api";

type Choice = "wav" | "mp3-192" | "mp3-128";

const FORMATS: Record<Choice, { label: string; ext: string; format: ExportOptions["format"] }> = {
  wav: { label: "WAV master (16-bit)", ext: "wav", format: { kind: "wav" } },
  "mp3-192": { label: "MP3 192 kbps", ext: "mp3", format: { kind: "mp3", kbps: 192 } },
  "mp3-128": { label: "MP3 128 kbps", ext: "mp3", format: { kind: "mp3", kbps: 128 } },
};

type Props = {
  onExport: (options: ExportOptions, ext: string) => Promise<{ dest: string; report: ExportReport } | null>;
  onClose: () => void;
};

export function ExportDialog({ onExport, onClose }: Props) {
  const [choice, setChoice] = useState<Choice>("wav");
  const [normalize, setNormalize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ dest: string; report: ExportReport } | null>(null);

  async function run() {
    setBusy(true);
    try {
      const result = await onExport({ format: FORMATS[choice].format, normalize }, FORMATS[choice].ext);
      if (result) setDone(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-label="Export">
        <h2>Export mix</h2>
        {done ? (
          <>
            <p>
              Wrote <code>{done.dest.split(/[\\/]/).pop()}</code>
            </p>
            <p className="dim">
              Mix measured {fmt(done.report.before.integratedLufs)} LUFS, true peak {fmt(done.report.before.truePeakDbtp)}{" "}
              dBTP.
              {done.report.gainDb !== 0 && <> Applied {done.report.gainDb > 0 ? "+" : ""}{done.report.gainDb.toFixed(1)} dB.</>}
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {(Object.keys(FORMATS) as Choice[]).map((key) => (
              <label key={key} className="radio">
                <input type="radio" name="format" checked={choice === key} onChange={() => setChoice(key)} />
                {FORMATS[key].label}
              </label>
            ))}
            <label className="radio">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
              Normalize to {PODCAST_LUFS} LUFS (true peak ≤ {TRUE_PEAK_DBTP} dBTP)
            </label>
            <div className="modal-actions">
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={run} disabled={busy}>
                {busy ? "Rendering…" : "Export…"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "−∞";
}
