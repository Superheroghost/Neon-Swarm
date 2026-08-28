import { Play, RotateCcw, Home, Volume2, VolumeX } from "lucide-react";

interface Props {
  muted: boolean;
  coarse: boolean;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onToggleMute: () => void;
}

export default function PauseOverlay({ muted, coarse, onResume, onRestart, onQuit, onToggleMute }: Props) {
  return (
    <div className="screen-dim absolute inset-0 z-20 flex items-center justify-center px-5">
      <div className="panel anim-in flex w-full max-w-xs flex-col items-center px-7 py-8">
        <div className="font-display text-2xl font-black tracking-[0.35em] text-cyan-100" style={{ textShadow: "0 0 18px rgba(34,211,238,0.6)" }}>
          PAUSED
        </div>
        <div className="mt-1 font-tech text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">
          systems on standby
        </div>

        <div className="mt-7 flex w-full flex-col gap-2.5">
          <button
            onClick={(e) => { e.currentTarget.blur(); onResume(); }}
            className="btn-neon flex items-center justify-center gap-2.5 rounded-lg px-5 py-3 text-xs"
          >
            <Play size={15} /> Resume
          </button>
          <button
            onClick={(e) => { e.currentTarget.blur(); onRestart(); }}
            className="btn-ghost flex items-center justify-center gap-2.5 rounded-lg px-5 py-3 text-xs"
          >
            <RotateCcw size={15} /> Restart
          </button>
          <button
            onClick={(e) => { e.currentTarget.blur(); onToggleMute(); }}
            className="btn-ghost flex items-center justify-center gap-2.5 rounded-lg px-5 py-3 text-xs"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />} Sound {muted ? "off" : "on"}
          </button>
          <button
            onClick={(e) => { e.currentTarget.blur(); onQuit(); }}
            className="btn-ghost flex items-center justify-center gap-2.5 rounded-lg px-5 py-3 text-xs"
          >
            <Home size={15} /> Abort to menu
          </button>
        </div>

        {!coarse && (
          <div className="mt-6 font-tech text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
            <kbd className="key">ESC</kbd> resume · <kbd className="key">R</kbd> restart
          </div>
        )}
      </div>
    </div>
  );
}
