import { useEffect, useState } from "react";
import { Pause, Volume2, VolumeX, MousePointer2, Move } from "lucide-react";
import type { HudState } from "../game/engine";
import { cn } from "../utils/cn";

interface Props {
  hud: HudState;
  muted: boolean;
  coarse: boolean;
  onPause: () => void;
  onToggleMute: () => void;
}

function ShipIcon({ lost }: { lost: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      className={cn("transition-all duration-300", lost ? "opacity-20" : "opacity-100")}
      style={lost ? undefined : { filter: "drop-shadow(0 0 5px rgba(34,211,238,0.9))" }}
    >
      <path
        d="M21 12 L4 20 L8 12 L4 4 Z"
        fill={lost ? "rgba(148,197,255,0.25)" : "rgba(34,211,238,0.9)"}
        stroke={lost ? "rgba(148,197,255,0.3)" : "#a5f3fc"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HUD({ hud, muted, coarse, onPause, onToggleMute }: Props) {
  const [showHints, setShowHints] = useState(true);

  useEffect(() => {
    setShowHints(true);
    const t = window.setTimeout(() => setShowHints(false), 7000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* top bar */}
      <div
        className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3 px-4 sm:px-6"
        style={{ paddingTop: "max(0.85rem, env(safe-area-inset-top))" }}
      >
        {/* score */}
        <div className="anim-in">
          <div className="font-tech text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-300/70">
            Score
          </div>
          <div
            className="font-display text-2xl font-bold tabular-nums leading-none text-cyan-50 sm:text-3xl"
            style={{ textShadow: "0 0 14px rgba(34,211,238,0.55)" }}
          >
            {hud.score.toLocaleString("en-US")}
          </div>
          <div
            key={hud.mult}
            className={cn(
              "mult-pop mt-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-display text-[11px] font-bold tracking-widest",
              hud.mult > 1
                ? "border-pink-400/60 bg-pink-500/15 text-pink-200"
                : "border-cyan-300/30 bg-cyan-400/5 text-cyan-200/60"
            )}
            style={
              hud.mult > 1 ? { boxShadow: "0 0 12px rgba(255,45,149,0.35)" } : undefined
            }
          >
            ×{hud.mult} COMBO
          </div>
        </div>

        {/* right cluster */}
        <div className="anim-in flex items-center gap-2.5">
          <div className="mr-1 flex items-center gap-1.5 pt-1">
            {[0, 1, 2].map((i) => (
              <ShipIcon key={i} lost={i >= hud.lives} />
            ))}
          </div>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="btn-ghost pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg"
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="btn-neon pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg"
            aria-label="Pause"
          >
            <Pause size={17} />
          </button>
        </div>
      </div>

      {/* control hints */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 flex justify-center px-4 transition-opacity duration-700",
          showHints ? "opacity-100" : "opacity-0"
        )}
        style={{ paddingBottom: "max(1.1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="panel flex items-center gap-3 px-4 py-2 font-tech text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300/90 sm:text-xs">
          {coarse ? (
            <>
              <Move size={14} className="text-cyan-300" />
              <span>Left thumb — move</span>
              <span className="text-slate-600">/</span>
              <MousePointer2 size={14} className="text-pink-400" />
              <span>Right thumb — aim &amp; fire</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <kbd className="key">W</kbd>
                <kbd className="key">A</kbd>
                <kbd className="key">S</kbd>
                <kbd className="key">D</kbd>
              </span>
              <span>move</span>
              <span className="text-slate-600">/</span>
              <MousePointer2 size={14} className="text-pink-400" />
              <span>aim</span>
              <span className="text-slate-600">/</span>
              <kbd className="key">CLICK</kbd>
              <span>or</span>
              <kbd className="key">SPACE</kbd>
              <span>fire</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
