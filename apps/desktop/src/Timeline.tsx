import { useEffect, useRef, useState } from "react";
import { clipEnd, type Project } from "@cutroom/session-model";
import type { Peaks } from "./api";

export const RULER_PX = 26;
export const LANE_PX = 110;

export type Selection = { t0: number; t1: number };

type Props = {
  project: Project;
  peaks: Record<string, Peaks>;
  pxPerSec: number;
  scrollSec: number;
  playheadSec: number;
  selection: Selection | null;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  onSeek: (sec: number) => void;
  onSelect: (selection: Selection | null) => void;
  onScroll: (sec: number) => void;
  onZoom: (pxPerSec: number, anchorSec: number) => void;
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function rulerStep(pxPerSec: number): number {
  for (const step of [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]) {
    if (step * pxPerSec >= 70) return step;
  }
  return 1200;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function Timeline(props: Props) {
  const { project, peaks, pxPerSec, scrollSec, playheadSec, selection, selectedClipId } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startSec: number; moved: boolean } | null>(null);
  const width = useSize(wrapRef);
  const height = RULER_PX + LANE_PX * Math.max(1, project.tracks.length);
  const tracks = [...project.tracks].sort((a, b) => a.order - b.order);
  const anySolo = tracks.some((t) => t.solo);

  const xOf = (sec: number) => (sec - scrollSec) * pxPerSec;
  const secOf = (x: number) => Math.max(0, scrollSec + x / pxPerSec);

  // Waveforms, clips and ruler: redrawn on edits, zoom and scroll only.
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || width === 0) return;
    const ctx = setupCanvas(canvas, width, height);
    ctx.fillStyle = cssVar("--lane");
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = cssVar("--ruler");
    ctx.fillRect(0, 0, width, RULER_PX);
    ctx.fillStyle = cssVar("--muted-text");
    ctx.strokeStyle = cssVar("--grid");
    ctx.font = "11px ui-monospace, monospace";
    const step = rulerStep(pxPerSec);
    for (let t = Math.floor(scrollSec / step) * step; xOf(t) < width; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_PX - 8);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(formatTime(t), x + 4, 15);
    }

    tracks.forEach((track, lane) => {
      const top = RULER_PX + lane * LANE_PX;
      const audible = !track.mute && (!anySolo || track.solo);
      ctx.strokeStyle = cssVar("--grid");
      ctx.beginPath();
      ctx.moveTo(0, top + LANE_PX - 0.5);
      ctx.lineTo(width, top + LANE_PX - 0.5);
      ctx.stroke();

      for (const clip of project.clips.filter((c) => c.trackId === track.id)) {
        const x0 = xOf(clip.timelineStartSec);
        const x1 = xOf(clipEnd(clip));
        if (x1 < 0 || x0 > width) continue;
        const clipTop = top + 6;
        const clipH = LANE_PX - 12;
        ctx.globalAlpha = audible ? 1 : 0.35;
        ctx.fillStyle = cssVar("--clip");
        ctx.fillRect(x0, clipTop, x1 - x0, clipH);
        ctx.strokeStyle = cssVar(clip.id === selectedClipId ? "--accent" : "--clip-edge");
        ctx.lineWidth = clip.id === selectedClipId ? 2 : 1;
        ctx.strokeRect(Math.round(x0) + 0.5, clipTop + 0.5, Math.max(1, x1 - x0 - 1), clipH - 1);
        ctx.lineWidth = 1;

        const filePeaks = peaks[clip.fileId];
        if (filePeaks) {
          const mid = clipTop + clipH / 2;
          const amp = clipH / 2 - 4;
          ctx.fillStyle = cssVar("--wave");
          const from = Math.max(0, Math.floor(x0));
          const to = Math.min(width, Math.ceil(x1));
          for (let x = from; x < to; x++) {
            const s0 = clip.sourceInSec + (secOf(x) - clip.timelineStartSec);
            const s1 = s0 + 1 / pxPerSec;
            const i0 = Math.floor(s0 * filePeaks.peaksPerSec);
            const i1 = Math.max(i0 + 1, Math.floor(s1 * filePeaks.peaksPerSec));
            let lo = 0;
            let hi = 0;
            for (let i = i0; i < i1 && i * 2 + 1 < filePeaks.data.length; i++) {
              lo = Math.min(lo, filePeaks.data[i * 2]);
              hi = Math.max(hi, filePeaks.data[i * 2 + 1]);
            }
            ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
          }
        }

        const fadeIn = clip.fadeInSec * pxPerSec;
        const fadeOut = clip.fadeOutSec * pxPerSec;
        ctx.strokeStyle = cssVar("--fade");
        ctx.lineWidth = 1.5;
        if (fadeIn > 1) {
          ctx.beginPath();
          ctx.moveTo(x0, clipTop + clipH);
          ctx.lineTo(x0 + fadeIn, clipTop);
          ctx.stroke();
        }
        if (fadeOut > 1) {
          ctx.beginPath();
          ctx.moveTo(x1 - fadeOut, clipTop);
          ctx.lineTo(x1, clipTop + clipH);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        if (clip.gainDb !== 0 && x1 - x0 > 48) {
          ctx.fillStyle = cssVar("--text");
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillText(`${clip.gainDb > 0 ? "+" : ""}${clip.gainDb.toFixed(1)} dB`, Math.max(x0, 0) + 6, clipTop + 14);
        }
        ctx.globalAlpha = 1;
      }
    });
  }, [project, peaks, pxPerSec, scrollSec, width, height, selectedClipId]);

  // Selection and playhead: cheap overlay redrawn every animation frame while playing.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || width === 0) return;
    const ctx = setupCanvas(canvas, width, height);
    ctx.clearRect(0, 0, width, height);
    if (selection) {
      const x0 = xOf(selection.t0);
      const x1 = xOf(selection.t1);
      ctx.fillStyle = cssVar("--selection");
      ctx.fillRect(x0, RULER_PX, x1 - x0, height - RULER_PX);
    }
    const px = Math.round(xOf(playheadSec)) + 0.5;
    ctx.strokeStyle = cssVar("--accent");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
    ctx.fillStyle = cssVar("--accent");
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 8);
    ctx.fill();
  }, [selection, playheadSec, pxPerSec, scrollSec, width, height]);

  function localX(e: React.PointerEvent | React.WheelEvent) {
    return e.clientX - wrapRef.current!.getBoundingClientRect().left;
  }

  return (
    <div
      ref={wrapRef}
      className="timeline"
      style={{ height }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        const sec = secOf(localX(e));
        dragRef.current = { startSec: sec, moved: false };
        const lane = Math.floor((e.clientY - wrapRef.current!.getBoundingClientRect().top - RULER_PX) / LANE_PX);
        const track = tracks[lane];
        const hit = track
          ? project.clips.find((c) => c.trackId === track.id && sec >= c.timelineStartSec && sec < clipEnd(c))
          : undefined;
        props.onSelectClip(hit?.id ?? null);
        props.onSeek(sec);
        props.onSelect(null);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const sec = secOf(localX(e));
        if (Math.abs(sec - drag.startSec) * pxPerSec < 3 && !drag.moved) return;
        drag.moved = true;
        props.onSelect({ t0: Math.min(drag.startSec, sec), t1: Math.max(drag.startSec, sec) });
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          const factor = e.deltaY < 0 ? 1.25 : 0.8;
          props.onZoom(pxPerSec * factor, secOf(localX(e)));
        } else {
          const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / pxPerSec;
          props.onScroll(Math.max(0, scrollSec + delta));
        }
      }}
    >
      <canvas ref={baseRef} />
      <canvas ref={overlayRef} className="overlay" />
    </div>
  );
}
