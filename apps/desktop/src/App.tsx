import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ingestFile, MAX_TRACKS } from "@cutroom/session-model";
import * as api from "./api";
import { editorReducer, initialEditor, timelineDuration } from "./editor";
import { formatTime, LANE_PX, RULER_PX, Timeline, type Selection } from "./Timeline";

const MIN_PX_PER_SEC = 0.2;
const MAX_PX_PER_SEC = 2000;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
}

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, initialEditor);
  const [peaks, setPeaks] = useState<Record<string, api.Peaks>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [scrollSec, setScrollSec] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playStart = useRef({ wall: 0, sec: 0 });
  const viewRef = useRef<HTMLDivElement>(null);

  const project = editor.project;
  const duration = timelineDuration(project);
  const tracks = [...project.tracks].sort((a, b) => a.order - b.order);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    api.stop().catch(() => {});
  }, []);

  const fail = (e: unknown) => setError(String(e instanceof Error ? e.message : e));

  const fitToWindow = useCallback((seconds: number) => {
    const width = viewRef.current?.clientWidth ?? 1000;
    setPxPerSec(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, (width - 40) / Math.max(1, seconds))));
    setScrollSec(0);
  }, []);

  async function addFiles() {
    const picked = await open({ multiple: true, filters: [{ name: "WAV audio", extensions: ["wav", "wave"] }] });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    stopPlayback();
    let next = project;
    const nextPeaks = { ...peaks };
    try {
      for (const path of paths) {
        setBusy(`Reading ${baseName(path)}…`);
        const wav = await api.importWav(path);
        next = ingestFile(
          next,
          { path: wav.path, durationSec: wav.durationSec, channelCount: wav.channelCount, sampleRate: wav.sampleRate },
          baseName(path),
        );
        nextPeaks[next.files.at(-1)!.id] = { peaksPerSec: wav.peaksPerSec, data: Float32Array.from(wav.peaks) };
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
    if (next !== project) {
      setPeaks(nextPeaks);
      dispatch({ type: "replace", project: next });
      if (project.files.length === 0) fitToWindow(timelineDuration(next));
    }
  }

  async function exportMix() {
    if (project.clips.length === 0) return;
    const dest = await save({ defaultPath: "mix.wav", filters: [{ name: "WAV audio", extensions: ["wav"] }] });
    if (!dest) return;
    setBusy("Rendering mix…");
    try {
      await api.exportWav(project, dest);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function togglePlay() {
    if (playing) {
      stopPlayback();
      return;
    }
    if (project.clips.length === 0) return;
    const from = playheadSec >= duration ? 0 : playheadSec;
    try {
      await api.play(project, from);
      playStart.current = { wall: performance.now(), sec: from };
      setPlayheadSec(from);
      setPlaying(true);
    } catch (e) {
      fail(e);
    }
  }

  function cutSelection() {
    if (!selection) return;
    stopPlayback();
    dispatch({ type: "cut", t0: selection.t0, t1: selection.t1 });
    setPlayheadSec(selection.t0);
    setSelection(null);
  }

  function edit(action: Parameters<typeof dispatch>[0]) {
    stopPlayback();
    dispatch(action);
  }

  function zoom(next: number, anchorSec: number) {
    const clamped = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, next));
    const anchorX = (anchorSec - scrollSec) * pxPerSec;
    setScrollSec(Math.max(0, anchorSec - anchorX / clamped));
    setPxPerSec(clamped);
  }

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const sec = playStart.current.sec + (performance.now() - playStart.current.wall) / 1000;
      if (sec >= duration) {
        setPlayheadSec(duration);
        setPlaying(false);
        return;
      }
      setPlayheadSec(sec);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      cutSelection();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      edit({ type: e.shiftKey ? "redo" : "undo" });
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      edit({ type: "redo" });
    } else if (mod && e.key.toLowerCase() === "o") {
      e.preventDefault();
      addFiles();
    } else if (mod && e.key.toLowerCase() === "e") {
      e.preventDefault();
      exportMix();
    } else if (e.key === "Home") {
      setPlayheadSec(0);
      setScrollSec(0);
    } else if (e.key === "Escape") {
      setSelection(null);
    } else if (e.key === "=" || e.key === "+") {
      zoom(pxPerSec * 1.5, playheadSec);
    } else if (e.key === "-") {
      zoom(pxPerSec / 1.5, playheadSec);
    } else if (e.key === "0") {
      fitToWindow(duration);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasMedia = project.files.length > 0;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▍▌▎
          </span>
          Cutroom
        </div>
        <div className="group">
          <button onClick={addFiles} disabled={project.tracks.length >= MAX_TRACKS} title="Add WAV files (Ctrl+O)">
            Add audio
          </button>
          <button onClick={exportMix} disabled={!hasMedia} title="Export mixdown WAV (Ctrl+E)">
            Export WAV
          </button>
        </div>
        <div className="group">
          <button
            onClick={() => edit({ type: "undo" })}
            disabled={editor.past.length === 0}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button onClick={() => edit({ type: "redo" })} disabled={editor.future.length === 0} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button onClick={cutSelection} disabled={!selection} title="Ripple-delete selection on all tracks (Delete)">
            Cut range
          </button>
        </div>
        <div className="group">
          <button onClick={() => zoom(pxPerSec / 1.5, playheadSec)} disabled={!hasMedia} title="Zoom out (-)">
            −
          </button>
          <button onClick={() => fitToWindow(duration)} disabled={!hasMedia} title="Fit (0)">
            Fit
          </button>
          <button onClick={() => zoom(pxPerSec * 1.5, playheadSec)} disabled={!hasMedia} title="Zoom in (+)">
            +
          </button>
        </div>
      </header>

      <main className="workspace" ref={viewRef}>
        {hasMedia ? (
          <div className="editor">
            <div className="track-heads" style={{ paddingTop: RULER_PX }}>
              {tracks.map((track) => (
                <div key={track.id} className="track-head" style={{ height: LANE_PX }}>
                  <div className="track-name" title={track.name}>
                    {track.name}
                  </div>
                  <div className="track-buttons">
                    <button
                      className={track.mute ? "toggle on mute" : "toggle"}
                      onClick={() => edit({ type: "toggleMute", trackId: track.id })}
                      title="Mute"
                    >
                      M
                    </button>
                    <button
                      className={track.solo ? "toggle on solo" : "toggle"}
                      onClick={() => edit({ type: "toggleSolo", trackId: track.id })}
                      title="Solo"
                    >
                      S
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Timeline
              project={project}
              peaks={peaks}
              pxPerSec={pxPerSec}
              scrollSec={scrollSec}
              playheadSec={playheadSec}
              selection={selection}
              onSeek={(sec) => {
                if (playing) stopPlayback();
                setPlayheadSec(Math.min(sec, duration));
              }}
              onSelect={setSelection}
              onScroll={setScrollSec}
              onZoom={zoom}
            />
          </div>
        ) : (
          <div className="empty">
            <h1>Start a cut</h1>
            <p>Add up to {MAX_TRACKS} WAV files — one per mic, plus music. They must share a sample rate.</p>
            <p className="hint">Originals are never modified. Edits are an edit list; export renders a new file.</p>
            <button className="primary" onClick={addFiles}>
              Add audio…
            </button>
          </div>
        )}
      </main>

      <footer className="transport">
        <button className="play primary" onClick={togglePlay} disabled={!hasMedia} title="Play / Stop (Space)">
          {playing ? "■ Stop" : "▶ Play"}
        </button>
        <span className="clock">
          {formatTime(playheadSec)} <span className="dim">/ {formatTime(duration)}</span>
        </span>
        {selection && (
          <span className="dim">
            Selection {formatTime(selection.t0)}–{formatTime(selection.t1)} ({(selection.t1 - selection.t0).toFixed(2)}s)
          </span>
        )}
        <span className="spacer" />
        {busy && <span className="busy">{busy}</span>}
        {project.sampleRate > 0 && <span className="dim">{(project.sampleRate / 1000).toFixed(1)} kHz</span>}
        <span className="dim keys">Drag to select · Del ripple-cuts · Ctrl+wheel zoom</span>
      </footer>

      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
          <span className="dim"> — click to dismiss</span>
        </div>
      )}
    </div>
  );
}
