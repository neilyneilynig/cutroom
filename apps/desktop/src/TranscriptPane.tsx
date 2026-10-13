import { useEffect, useMemo, useRef } from "react";
import type { TimedWord, Track } from "@cutroom/session-model";
import { groupParagraphs, wordRangeSelection } from "./paragraphs";
import { formatTime, type Selection } from "./Timeline";

const LOW_CONFIDENCE = 0.5;
const EPS = 1e-6;

type Props = {
  words: TimedWord[];
  tracks: Track[];
  playheadSec: number;
  playing: boolean;
  selection: Selection | null;
  progress: Record<string, number>;
  modelPath: string | null;
  onSelect: (selection: Selection) => void;
  onSeek: (sec: number) => void;
  onTranscribe: (trackIds: string[]) => void;
  onChooseModel: () => void;
};

export function TranscriptPane(props: Props) {
  const { words, tracks, playheadSec, selection, progress } = props;
  const paragraphs = useMemo(() => groupParagraphs(words), [words]);
  const indexById = useMemo(() => new Map(words.map((w, i) => [w.word.id, i])), [words]);
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? "?";
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const currentRef = useRef<HTMLSpanElement | null>(null);
  const busy = Object.keys(progress).length > 0;
  const untranscribed = tracks.filter((t) => !words.some((w) => w.word.trackId === t.id));

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  useEffect(() => {
    if (props.playing) currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [props.playing, playheadSec]);

  const header = (
    <div className="pane-head">
      <span className="pane-title">Transcript</span>
      {Object.entries(progress).map(([trackId, pct]) => (
        <span key={trackId} className="busy">
          Transcribing {trackName(trackId)}… {pct}%
        </span>
      ))}
      <span className="spacer" />
      {props.modelPath ? (
        <>
          <span className="dim small" title={props.modelPath}>
            Whisper · {props.modelPath.split(/[\\/]/).pop()}
          </span>
          <button
            onClick={() => props.onTranscribe((untranscribed.length ? untranscribed : tracks).map((t) => t.id))}
            disabled={busy || tracks.length === 0}
          >
            {words.length && !untranscribed.length ? "Re-transcribe all" : "Transcribe"}
          </button>
        </>
      ) : (
        <button onClick={props.onChooseModel}>Choose Whisper model…</button>
      )}
    </div>
  );

  if (words.length === 0) {
    return (
      <section className="transcript">
        {header}
        <div className="transcript-empty">
          {props.modelPath ? (
            <p>
              Transcribe to edit by text. It runs on this machine — audio never leaves it.
              <br />
              Select words and press <kbd>Delete</kbd> to cut them from every track.
            </p>
          ) : (
            <p>
              Transcription needs a whisper.cpp model file (e.g. <code>ggml-base.en.bin</code>, 142 MB) from
              huggingface.co/ggerganov/whisper.cpp. Choose it once; Cutroom keeps a copy.
            </p>
          )}
        </div>
      </section>
    );
  }

  const isSelected = (w: TimedWord) =>
    selection !== null && w.startSec >= selection.t0 - EPS && w.endSec <= selection.t1 + EPS;

  return (
    <section className="transcript">
      {header}
      <div className="transcript-body">
        {paragraphs.map((para) => (
          <div key={para.words[0].word.id} className="para">
            <div className="para-meta">
              <span className="speaker">{trackName(para.trackId)}</span>
              <button className="link" onClick={() => props.onSeek(para.startSec)}>
                {formatTime(para.startSec)}
              </button>
            </div>
            <p>
              {para.words.map((w) => {
                const i = indexById.get(w.word.id)!;
                const current = playheadSec >= w.startSec && playheadSec < w.endSec;
                const cls = [
                  "word",
                  isSelected(w) ? "selected" : "",
                  current ? "current" : "",
                  w.word.confidence < LOW_CONFIDENCE ? "unsure" : "",
                ].join(" ");
                return (
                  <span
                    key={w.word.id}
                    ref={current ? currentRef : undefined}
                    className={cls}
                    title={`${formatTime(w.startSec)} · ${Math.round(w.word.confidence * 100)}%`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (e.shiftKey && anchor.current !== null) {
                        props.onSelect(wordRangeSelection(words, anchor.current, i));
                        return;
                      }
                      anchor.current = i;
                      dragging.current = true;
                      props.onSeek(w.startSec);
                      props.onSelect(wordRangeSelection(words, i, i));
                    }}
                    onPointerEnter={() => {
                      if (dragging.current && anchor.current !== null) {
                        props.onSelect(wordRangeSelection(words, anchor.current, i));
                      }
                    }}
                  >
                    {w.word.text}{" "}
                  </span>
                );
              })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
