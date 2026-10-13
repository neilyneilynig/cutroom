import { useEffect, useState } from "react";
import { clipDuration, clipEnd, type Clip, type ClipPatch } from "@cutroom/session-model";
import { formatTime } from "./Timeline";

type Props = {
  clip: Clip;
  trackName: string;
  playheadSec: number;
  onChange: (patch: ClipPatch) => void;
  onSplit: () => void;
  onClose: () => void;
};

export function Inspector({ clip, trackName, playheadSec, onChange, onSplit, onClose }: Props) {
  // The gain slider edits a draft and commits once on release, so a drag is one undo step.
  const [gain, setGain] = useState(clip.gainDb);
  useEffect(() => setGain(clip.gainDb), [clip.id, clip.gainDb]);
  const commitGain = () => gain !== clip.gainDb && onChange({ gainDb: gain });
  const canSplit = playheadSec > clip.timelineStartSec && playheadSec < clipEnd(clip);
  const fadeInput = (key: "fadeInSec" | "fadeOutSec", label: string) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        step={0.1}
        max={clipDuration(clip)}
        value={Number(clip[key].toFixed(2))}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (Number.isFinite(value)) onChange({ [key]: Math.max(0, value) });
        }}
      />
      s
    </label>
  );

  return (
    <div className="inspector">
      <span className="pane-title">Clip</span>
      <span className="dim">
        {trackName} · {formatTime(clip.timelineStartSec)} · {clipDuration(clip).toFixed(1)}s
      </span>
      <label>
        Gain
        <input
          type="range"
          min={-24}
          max={12}
          step={0.5}
          value={gain}
          onChange={(e) => setGain(Number(e.target.value))}
          onPointerUp={commitGain}
          onKeyUp={commitGain}
          onBlur={commitGain}
        />
        <span className="num">{gain > 0 ? "+" : ""}{gain.toFixed(1)} dB</span>
      </label>
      {fadeInput("fadeInSec", "Fade in")}
      {fadeInput("fadeOutSec", "Fade out")}
      <button onClick={onSplit} disabled={!canSplit} title="Split at playhead (Ctrl+B)">
        Split at playhead
      </button>
      <span className="spacer" />
      <button className="link" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
