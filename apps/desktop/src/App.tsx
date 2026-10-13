import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ingestFile,
  MAX_TRACKS,
  parseProject,
  serializeProject,
  timelineWords,
  type Project,
} from "@cutroom/session-model";
import * as api from "./api";
import { editorReducer, initialEditor, timelineDuration, type EditorAction } from "./editor";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { formatTime, LANE_PX, RULER_PX, Timeline, type Selection } from "./Timeline";
import { TranscriptPane } from "./TranscriptPane";

const MIN_PX_PER_SEC = 0.2;
const MAX_PX_PER_SEC = 2000;
const PROJECT_EXT = "cutroom";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, initialEditor);
  const [peaks, setPeaks] = useState<Record<string, api.Peaks>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [scrollSec, setScrollSec] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loudness, setLoudness] = useState<api.Loudness | null>(null);
  const [exporting, setExporting] = useState(false);
  const playStart = useRef({ wall: 0, sec: 0 });
  const viewRef = useRef<HTMLDivElement>(null);

  const project = editor.project;
  const duration = timelineDuration(project);
  const tracks = useMemo(() => [...project.tracks].sort((a, b) => a.order - b.order), [project.tracks]);
  const words = useMemo(() => timelineWords(project), [project]);
  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const hasMedia = project.files.length > 0;
  const dirty = hasMedia && project !== savedProject;

  useEffect(() => {
    api.findModel().then(setModelPath).catch(() => {});
    const unlisten = listen<api.TranscribeProgress>("transcribe-progress", (event) => {
      setProgress((p) => (event.payload.trackId in p ? { ...p, [event.payload.trackId]: event.payload.percent } : p));
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  useEffect(() => {
    const name = projectPath ? baseName(projectPath) : "Untitled";
    document.title = `${dirty ? "• " : ""}${name} — Cutroom`;
  }, [projectPath, dirty]);

  useEffect(() => setLoudness(null), [project]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    api.stop().catch(() => {});
  }, []);

  const fail = (e: unknown) => setError(String(e instanceof Error ? e.message : e));

  const fitToWindow = useCallback((seconds: number) => {
    const width = viewRef.current?.clientWidth ?? 1000;
    setPxPerSec(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, (width - 210) / Math.max(1, seconds))));
    setScrollSec(0);
  }, []);

  function edit(action: EditorAction) {
    stopPlayback();
    dispatch(action);
  }

  async function readPeaks(path: string) {
    setBusy(`Reading ${baseName(path)}…`);
    return api.importWav(path);
  }

  async function addFiles() {
    const picked = await open({ multiple: true, filters: [{ name: "WAV audio", extensions: ["wav", "wave"] }] });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    stopPlayback();
    let next = project;
    const nextPeaks = { ...peaks };
    try {
      for (const path of paths) {
        const wav = await readPeaks(path);
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

  async function saveAs(): Promise<string | null> {
    const dest = await save({
      defaultPath: `${projectPath ? baseName(projectPath) : "episode"}.${PROJECT_EXT}`,
      filters: [{ name: "Cutroom project", extensions: [PROJECT_EXT] }],
    });
    if (!dest) return null;
    return dest.endsWith(`.${PROJECT_EXT}`) ? dest : `${dest}.${PROJECT_EXT}`;
  }

  async function saveProject(forceDialog = false) {
    if (!hasMedia) return;
    const dest = !forceDialog && projectPath ? projectPath : await saveAs();
    if (!dest) return;
    try {
      await api.saveProject(dest, serializeProject(project));
      setProjectPath(dest);
      setSavedProject(project);
    } catch (e) {
      fail(e);
    }
  }

  async function openProject() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const picked = await open({ filters: [{ name: "Cutroom project", extensions: [PROJECT_EXT] }] });
    if (!picked || Array.isArray(picked)) return;
    stopPlayback();
    try {
      const loaded = parseProject(await api.loadProject(picked));
      const nextPeaks: Record<string, api.Peaks> = {};
      for (const file of loaded.files) {
        let wav: api.ImportedWav;
        try {
          wav = await readPeaks(file.path);
        } catch {
          throw new Error(`Missing media: ${file.path}`);
        }
        if (wav.sampleRate !== loaded.sampleRate) {
          throw new Error(`${file.path} is now ${wav.sampleRate} Hz; the project is ${loaded.sampleRate} Hz`);
        }
        nextPeaks[file.id] = { peaksPerSec: wav.peaksPerSec, data: Float32Array.from(wav.peaks) };
      }
      setPeaks(nextPeaks);
      dispatch({ type: "open", project: loaded });
      setProjectPath(picked);
      setSavedProject(loaded);
      setSelection(null);
      setSelectedClipId(null);
      setPlayheadSec(0);
      fitToWindow(timelineDuration(loaded));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function chooseModel() {
    const picked = await open({ filters: [{ name: "whisper.cpp model", extensions: ["bin"] }] });
    if (!picked || Array.isArray(picked)) return;
    setBusy("Installing model…");
    try {
      setModelPath(await api.installModel(picked));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function transcribeTracks(trackIds: string[]) {
    if (!modelPath) return;
    const model = modelPath;
    // Words are source-relative, so a transcript stays valid even if the project is edited meanwhile.
    for (const trackId of trackIds) {
      const clip = project.clips.find((c) => c.trackId === trackId);
      const file = clip && project.files.find((f) => f.id === clip.fileId);
      if (!file) continue;
      setProgress((p) => ({ ...p, [trackId]: 0 }));
      try {
        const result = await api.transcribe(model, file.path, trackId);
        dispatch({
          type: "setTrackWords",
          trackId,
          words: result.map((w) => ({
            trackId,
            fileId: file.id,
            sourceStartSec: w.startSec,
            sourceEndSec: w.endSec,
            text: w.text,
            confidence: w.confidence,
          })),
        });
      } catch (e) {
        fail(e);
      } finally {
        setProgress(({ [trackId]: _, ...rest }) => rest);
      }
    }
  }

  async function runExport(options: api.ExportOptions, ext: string) {
    const dest = await save({
      defaultPath: `${projectPath ? baseName(projectPath) : "mix"}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!dest) return null;
    try {
      const report = await api.exportMix(project, dest, options);
      return { dest, report };
    } catch (e) {
      fail(e);
      return null;
    }
  }

  async function measure() {
    setBusy("Measuring loudness…");
    try {
      setLoudness(await api.measureMix(project));
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
    edit({ type: "cut", t0: selection.t0, t1: selection.t1 });
    setPlayheadSec(selection.t0);
    setSelection(null);
  }

  function splitAtPlayhead() {
    if (!selectedClip) return;
    edit({ type: "splitClip", clipId: selectedClip.id, atSec: playheadSec });
  }

  function seek(sec: number) {
    if (playing) stopPlayback();
    setPlayheadSec(Math.max(0, Math.min(sec, duration)));
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
    if (isTyping(e.target) || exporting) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      cutSelection();
    } else if (mod && key === "z") {
      e.preventDefault();
      edit({ type: e.shiftKey ? "redo" : "undo" });
    } else if (mod && key === "y") {
      e.preventDefault();
      edit({ type: "redo" });
    } else if (mod && key === "s") {
      e.preventDefault();
      saveProject(e.shiftKey);
    } else if (mod && key === "o") {
      e.preventDefault();
      openProject();
    } else if (mod && key === "i") {
      e.preventDefault();
      addFiles();
    } else if (mod && key === "e") {
      e.preventDefault();
      if (hasMedia) setExporting(true);
    } else if (mod && key === "b") {
      e.preventDefault();
      splitAtPlayhead();
    } else if (e.key === "Home") {
      seek(0);
      setScrollSec(0);
    } else if (e.key === "Escape") {
      setSelection(null);
      setSelectedClipId(null);
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

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▍▌▎
          </span>
          Cutroom
          <span className="dim project-name">
            {projectPath ? baseName(projectPath) : hasMedia ? "Untitled" : ""}
            {dirty ? " •" : ""}
          </span>
        </div>
        <div className="group">
          <button onClick={openProject} title="Open project (Ctrl+O)">
            Open
          </button>
          <button onClick={() => saveProject()} disabled={!hasMedia} title="Save project (Ctrl+S, Ctrl+Shift+S = Save As)">
            Save
          </button>
          <button onClick={addFiles} disabled={project.tracks.length >= MAX_TRACKS} title="Add WAV files (Ctrl+I)">
            Add audio
          </button>
          <button onClick={() => setExporting(true)} disabled={!hasMedia} title="Export (Ctrl+E)">
            Export
          </button>
        </div>
        <div className="group">
          <button onClick={() => edit({ type: "undo" })} disabled={editor.past.length === 0} title="Undo (Ctrl+Z)">
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
          <>
            <TranscriptPane
              words={words}
              tracks={tracks}
              playheadSec={playheadSec}
              playing={playing}
              selection={selection}
              progress={progress}
              modelPath={modelPath}
              onSelect={setSelection}
              onSeek={seek}
              onTranscribe={transcribeTracks}
              onChooseModel={chooseModel}
            />
            {selectedClip && (
              <Inspector
                clip={selectedClip}
                trackName={tracks.find((t) => t.id === selectedClip.trackId)?.name ?? ""}
                playheadSec={playheadSec}
                onChange={(patch) => edit({ type: "updateClip", clipId: selectedClip.id, patch })}
                onSplit={splitAtPlayhead}
                onClose={() => setSelectedClipId(null)}
              />
            )}
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
                      {track.id in progress && <span className="busy small">{progress[track.id]}%</span>}
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
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
                onSeek={seek}
                onSelect={setSelection}
                onScroll={setScrollSec}
                onZoom={zoom}
              />
            </div>
          </>
        ) : (
          <div className="empty">
            <h1>Start a cut</h1>
            <p>Add up to {MAX_TRACKS} WAV files — one per mic, plus music. They must share a sample rate.</p>
            <p className="hint">Originals are never modified. Edits are an edit list; export renders a new file.</p>
            <div className="empty-actions">
              <button className="primary" onClick={addFiles}>
                Add audio…
              </button>
              <button onClick={openProject}>Open project…</button>
            </div>
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
        {hasMedia &&
          (loudness ? (
            <span className="meter" title="Integrated loudness · true peak of the current mix">
              {Number.isFinite(loudness.integratedLufs) ? loudness.integratedLufs.toFixed(1) : "−∞"} LUFS ·{" "}
              {Number.isFinite(loudness.truePeakDbtp) ? loudness.truePeakDbtp.toFixed(1) : "−∞"} dBTP
            </span>
          ) : (
            <button className="link" onClick={measure} disabled={busy !== null}>
              Measure loudness
            </button>
          ))}
        {project.sampleRate > 0 && <span className="dim">{(project.sampleRate / 1000).toFixed(1)} kHz</span>}
      </footer>

      {exporting && <ExportDialog onExport={runExport} onClose={() => setExporting(false)} />}

      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
          <span className="dim"> — click to dismiss</span>
        </div>
      )}
    </div>
  );
}
