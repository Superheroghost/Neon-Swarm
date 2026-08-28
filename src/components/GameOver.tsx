import { useEffect, useRef, useState } from "react";
import { RotateCcw, Home, Trophy, ChevronUp, ChevronDown, CornerDownLeft, Zap, Timer, TrendingUp } from "lucide-react";
import type { GameStats } from "../game/engine";
import type { ScoreEntry } from "../game/storage";
import { cn } from "../utils/cn";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

interface Props {
  score: number;
  stats: GameStats;
  scores: ScoreEntry[];
  qualifies: boolean;
  coarse: boolean;
  onSave: (name: string) => void;
  onRetry: () => void;
  onMenu: () => void;
  onHover: () => void;
}

function cycle(ch: string, dir: number): string {
  const i = CHARSET.indexOf(ch);
  return CHARSET[(i + dir + CHARSET.length) % CHARSET.length];
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function GameOver({
  score, stats, scores, qualifies, coarse, onSave, onRetry, onMenu, onHover,
}: Props) {
  const initialBest = useRef(scores[0]?.score ?? 0).current;
  const wasBest = score > initialBest;
  const [step, setStep] = useState<"entry" | "board">(qualifies ? "entry" : "board");
  const [chars, setChars] = useState<string[]>(["A", "C", "E"]);
  const [sel, setSel] = useState(0);
  const [savedName, setSavedName] = useState<string | null>(null);

  const confirm = () => {
    const name = chars.join("");
    onSave(name);
    setSavedName(name);
    setStep("board");
  };

  // keyboard handling (self-contained so initials typing never clashes)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (step === "entry") {
        const k = e.key.toUpperCase();
        if (/^[A-Z0-9]$/.test(k)) {
          setChars((c) => {
            const n = [...c];
            n[sel] = k;
            return n;
          });
          setSel((s) => Math.min(2, s + 1));
          e.preventDefault();
        } else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          setChars((c) => {
            const n = [...c];
            n[sel] = cycle(n[sel], e.code === "ArrowUp" ? 1 : -1);
            return n;
          });
          e.preventDefault();
        } else if (e.code === "ArrowLeft") {
          setSel((s) => Math.max(0, s - 1));
        } else if (e.code === "ArrowRight") {
          setSel((s) => Math.min(2, s + 1));
        } else if (e.code === "Backspace") {
          setSel((s) => Math.max(0, s - 1));
        } else if (e.code === "Enter") {
          confirm();
        }
        return;
      }
      // board step
      if (e.code === "KeyR" || e.code === "Enter") onRetry();
      if (e.code === "Escape") onMenu();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sel, chars]);

  return (
    <div className="screen-dim absolute inset-0 z-20 flex items-center justify-center overflow-y-auto px-5">
      <div className="anim-in flex w-full max-w-md flex-col items-center py-8">
        <div className="font-display text-4xl font-black tracking-[0.18em] text-pink-100 sm:text-5xl" style={{ textShadow: "0 0 26px rgba(255,45,149,0.65), 0 0 70px rgba(255,45,149,0.4)" }}>
          GAME OVER
        </div>

        {wasBest && (
          <div className="pulse-soft mt-3 flex items-center gap-2 rounded-full border border-amber-300/50 bg-amber-400/10 px-4 py-1 font-display text-xs font-bold tracking-[0.25em] text-amber-200">
            <Trophy size={13} /> NEW RECORD
          </div>
        )}

        {/* score + stats */}
        <div className="mt-5 font-display text-5xl font-black tabular-nums text-cyan-50 sm:text-6xl" style={{ textShadow: "0 0 22px rgba(34,211,238,0.6)" }}>
          {score.toLocaleString("en-US")}
        </div>

        <div className="mt-4 grid w-full grid-cols-3 gap-2">
          {[
            { icon: <Zap size={13} />, label: "Kills", value: String(stats.kills) },
            { icon: <Timer size={13} />, label: "Time", value: formatTime(stats.time) },
            { icon: <TrendingUp size={13} />, label: "Max combo", value: `×${stats.maxMult}` },
          ].map((s) => (
            <div key={s.label} className="panel flex flex-col items-center gap-0.5 px-2 py-2.5">
              <div className="flex items-center gap-1 font-tech text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400">
                {s.icon} {s.label}
              </div>
              <div className="font-display text-lg font-bold text-slate-100">{s.value}</div>
            </div>
          ))}
        </div>

        {step === "entry" ? (
          <div className="panel mt-5 flex w-full flex-col items-center px-5 py-5">
            <div className="font-tech text-[10px] font-bold uppercase tracking-[0.4em] text-amber-300/90">
              Top 8 — log your callsign
            </div>
            <div className="mt-4 flex items-start gap-3">
              {chars.map((ch, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <button
                    aria-label="previous letter"
                    className="btn-ghost flex h-7 w-10 items-center justify-center rounded-md"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setSel(i);
                      setChars((c) => {
                        const n = [...c];
                        n[i] = cycle(n[i], 1);
                        return n;
                      });
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setSel(i);
                    }}
                    className={cn(
                      "font-display flex h-14 w-12 items-center justify-center rounded-lg border text-2xl font-black transition-all",
                      sel === i
                        ? "border-cyan-300 bg-cyan-400/15 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.4)]"
                        : "border-white/10 bg-white/5 text-slate-300"
                    )}
                  >
                    <span className={cn(sel === i && "blink")}>{ch}</span>
                  </button>
                  <button
                    aria-label="next letter"
                    className="btn-ghost flex h-7 w-10 items-center justify-center rounded-md"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setSel(i);
                      setChars((c) => {
                        const n = [...c];
                        n[i] = cycle(n[i], -1);
                        return n;
                      });
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                confirm();
              }}
              onMouseEnter={onHover}
              className="btn-neon mt-5 flex items-center gap-2 rounded-lg px-7 py-2.5 text-xs"
            >
              <CornerDownLeft size={14} /> Enlist score
            </button>
            {!coarse && (
              <div className="mt-2.5 font-tech text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                type letters · <kbd className="key">ENTER</kbd> confirm
              </div>
            )}
          </div>
        ) : (
          <>
            {scores.length > 0 && (
              <div className="panel mt-5 w-full px-5 py-4">
                <div className="mb-2 font-tech text-[10px] font-bold uppercase tracking-[0.4em] text-amber-300/80">
                  Hall of fame
                </div>
                {scores.slice(0, 5).map((e, i) => {
                  const mine = savedName !== null && e.name === savedName && e.score === score;
                  return (
                    <div
                      key={`${e.at}-${i}`}
                      className={cn(
                        "flex items-center gap-3 border-b border-white/5 py-1.5 last:border-0",
                        mine && "rounded bg-cyan-400/10 px-1.5"
                      )}
                    >
                      <span className="font-display w-6 text-xs font-bold text-slate-500">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={cn("font-display flex-1 text-sm tracking-[0.25em]", mine ? "text-cyan-200" : "text-slate-300")}>
                        {e.name}
                        {mine && <span className="ml-2 font-tech text-[9px] tracking-[0.2em] text-cyan-400">YOU</span>}
                      </span>
                      <span className="font-display text-sm font-bold tabular-nums text-slate-200">
                        {e.score.toLocaleString("en-US")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex w-full gap-2.5">
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRetry();
                }}
                onMouseEnter={onHover}
                className="btn-neon flex flex-1 items-center justify-center gap-2.5 rounded-lg px-5 py-3.5 text-xs"
              >
                <RotateCcw size={15} /> Retry
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  onMenu();
                }}
                onMouseEnter={onHover}
                className="btn-ghost flex items-center justify-center gap-2.5 rounded-lg px-5 py-3.5 text-xs"
              >
                <Home size={15} /> Menu
              </button>
            </div>
            <div className="mt-3 font-tech text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              {coarse ? "tap retry to redeploy instantly" : (<><kbd className="key">R</kbd> instant retry</>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
