import { Play, Trophy, Zap, Timer, Crosshair, MousePointer2, Hand, Sparkles } from "lucide-react";
import type { ScoreEntry } from "../game/storage";

interface Props {
  scores: ScoreEntry[];
  coarse: boolean;
  onStart: () => void;
  onHover: () => void;
}

function ScoreRow({ entry, rank }: { entry: ScoreEntry; rank: number }) {
  const top = rank === 0;
  return (
    <div className="flex items-center gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span
        className="font-display w-7 text-sm font-bold"
        style={{ color: top ? "#ffd24d" : "rgba(148,197,255,0.5)" }}
      >
        {String(rank + 1).padStart(2, "0")}
      </span>
      {top && <Trophy size={13} className="shrink-0 text-amber-300" />}
      <span className="font-display flex-1 text-sm tracking-[0.25em] text-slate-200">
        {entry.name}
      </span>
      <span
        className="font-display text-sm font-bold tabular-nums"
        style={{
          color: top ? "#ffd24d" : "#9fd8ff",
          textShadow: top ? "0 0 10px rgba(255,210,77,0.5)" : "0 0 8px rgba(34,211,238,0.3)",
        }}
      >
        {entry.score.toLocaleString("en-US")}
      </span>
    </div>
  );
}

export default function Menu({ scores, coarse, onStart, onHover }: Props) {
  const best = scores[0]?.score ?? 0;

  return (
    <div className="screen-dim absolute inset-0 z-20 flex items-center justify-center overflow-y-auto">
      <div className="flex w-full max-w-3xl flex-col items-center px-5 py-8">
        {/* title */}
        <div className="anim-in mb-1 flex items-center gap-2 font-tech text-[10px] font-bold uppercase tracking-[0.5em] text-cyan-300/70 sm:text-xs">
          <Sparkles size={12} />
          Sector defense protocol
          <Sparkles size={12} />
        </div>
        <h1 className="anim-in float-y text-center font-display text-[17vw] font-black leading-[0.95] sm:text-8xl">
          <span className="title-neon">NEON</span>
          <br />
          <span className="title-neon-pink">SWARM</span>
        </h1>

        {best > 0 && (
          <div className="anim-in mt-4 flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/10 px-4 py-1 font-display text-xs font-bold tracking-[0.2em] text-amber-200">
            <Trophy size={13} />
            BEST — {best.toLocaleString("en-US")}
          </div>
        )}

        {/* start */}
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onStart();
          }}
          onMouseEnter={onHover}
          className="btn-neon anim-in mt-7 flex items-center gap-3 rounded-xl px-10 py-4 text-sm sm:text-base"
        >
          <Play size={18} />
          Start mission
        </button>
        <div className="anim-in mt-2.5 font-tech text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
          {coarse ? "tap to deploy" : (
            <>press <kbd className="key">ENTER</kbd> to deploy</>
          )}
        </div>

        {/* cards */}
        <div className="mt-8 grid w-full gap-4 sm:grid-cols-2">
          {/* how to play */}
          <div className="panel anim-in-slow p-5">
            <div className="mb-3 font-tech text-[10px] font-bold uppercase tracking-[0.4em] text-cyan-300/80">
              Controls
            </div>
            {coarse ? (
              <ul className="space-y-2.5 font-tech text-sm font-medium text-slate-300">
                <li className="flex items-center gap-3">
                  <Hand size={16} className="shrink-0 text-cyan-300" />
                  Left thumb — twin-stick move
                </li>
                <li className="flex items-center gap-3">
                  <Crosshair size={16} className="shrink-0 text-pink-400" />
                  Right thumb — aim &amp; autofire
                </li>
                <li className="flex items-center gap-3">
                  <Zap size={16} className="shrink-0 text-amber-300" />
                  Grab gold novas to nuke the swarm
                </li>
              </ul>
            ) : (
              <ul className="space-y-2.5 font-tech text-sm font-medium text-slate-300">
                <li className="flex items-center gap-3">
                  <span className="flex shrink-0 items-center gap-1">
                    <kbd className="key">W</kbd><kbd className="key">A</kbd><kbd className="key">S</kbd><kbd className="key">D</kbd>
                  </span>
                  move — arrows work too
                </li>
                <li className="flex items-center gap-3">
                  <MousePointer2 size={16} className="shrink-0 text-pink-400" />
                  mouse to aim — hold click or <kbd className="key">SPACE</kbd>
                </li>
                <li className="flex items-center gap-3">
                  <kbd className="key">P</kbd>
                  pause
                  <kbd className="key ml-2">M</kbd>
                  mute
                </li>
              </ul>
            )}
            <div className="mt-4 border-t border-white/5 pt-3">
              <div className="mb-2 font-tech text-[10px] font-bold uppercase tracking-[0.4em] text-pink-400/80">
                Know thy swarm
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-tech text-xs font-medium text-slate-400">
                <span><i className="mr-1.5 inline-block h-2 w-2 rotate-45 bg-[#ff2d95] shadow-[0_0_6px_#ff2d95]" />Chaser — hunts you</span>
                <span><i className="mr-1.5 inline-block h-2 w-2 bg-[#3dffa0] shadow-[0_0_6px_#3dffa0]" />Wanderer — ricochets</span>
                <span><i className="mr-1.5 inline-block h-2 w-2 rotate-45 bg-[#5f8cff] shadow-[0_0_6px_#5f8cff]" />Weaver — slips sideways</span>
                <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ffb020] shadow-[0_0_6px_#ffb020]" />Splitter — divides!</span>
              </div>
            </div>
          </div>

          {/* high scores */}
          <div className="panel anim-in-slow p-5" style={{ animationDelay: "0.08s" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-tech text-[10px] font-bold uppercase tracking-[0.4em] text-amber-300/80">
                Hall of fame
              </div>
              <Timer size={13} className="text-slate-500" />
            </div>
            {scores.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
                <Zap size={20} className="text-cyan-300/50" />
                <div className="font-tech text-sm font-medium text-slate-500">
                  No pilots on record.
                  <br />
                  Be the first legend.
                </div>
              </div>
            ) : (
              <div>
                {scores.slice(0, 6).map((e, i) => (
                  <ScoreRow key={`${e.at}-${i}`} entry={e} rank={i} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="anim-in-slow mt-6 font-tech text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-600">
          chain kills · raise the combo · survive the surge
        </div>
      </div>
    </div>
  );
}
