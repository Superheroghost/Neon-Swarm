import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, type GameStats, type HudState, type Phase } from "./game/engine";
import {
  loadMuted,
  loadScores,
  persistMuted,
  qualifiesForBoard,
  saveScore,
  type ScoreEntry,
} from "./game/storage";
import HUD from "./components/HUD";
import Menu from "./components/Menu";
import PauseOverlay from "./components/PauseOverlay";
import GameOver from "./components/GameOver";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [hud, setHud] = useState<HudState>({ score: 0, mult: 1, lives: 3 });
  const [scores, setScores] = useState<ScoreEntry[]>(() => loadScores());
  const [finalScore, setFinalScore] = useState(0);
  const [finalStats, setFinalStats] = useState<GameStats>({ kills: 0, time: 0, maxMult: 1 });
  const [muted, setMuted] = useState<boolean>(() => loadMuted());
  const [runId, setRunId] = useState(0);
  const [coarse] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
  );

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, {
      onHud: setHud,
      onPhase: setPhase,
      onGameOver: (score, stats) => {
        setFinalScore(score);
        setFinalStats(stats);
      },
    });
    engine.setMuted(loadMuted());
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      persistMuted(next);
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const startGame = useCallback(() => {
    setRunId((i) => i + 1);
    engineRef.current?.start();
  }, []);

  const toMenu = useCallback(() => {
    engineRef.current?.quitToMenu();
  }, []);

  // ------------------------------------------------------------- shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (e.code === "KeyM") {
        toggleMute();
        return;
      }
      if (phase === "menu" && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        startGame();
      } else if (phase === "playing" && (e.code === "Escape" || e.code === "KeyP")) {
        e.preventDefault();
        eng.pause();
      } else if (phase === "paused") {
        if (e.code === "Escape" || e.code === "KeyP") {
          e.preventDefault();
          eng.resume();
        } else if (e.code === "KeyR") {
          startGame();
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [phase, startGame, toggleMute]);

  const qualifies = qualifiesForBoard(finalScore, scores);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#04050c]"
      style={{ height: "100dvh" }}
    >
      {/* game world */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: phase === "playing" && !coarse ? "none" : "default" }}
        />
      </div>

      {/* CRT flavor */}
      <div className="vignette-overlay" />
      <div className="crt-overlay" />

      {/* HUD */}
      {(phase === "playing" || phase === "paused") && (
        <HUD
          key={runId}
          hud={hud}
          muted={muted}
          coarse={coarse}
          onPause={() => engineRef.current?.pause()}
          onToggleMute={toggleMute}
        />
      )}

      {/* screens */}
      {phase === "menu" && (
        <Menu
          scores={scores}
          coarse={coarse}
          onStart={startGame}
          onHover={() => engineRef.current?.uiBlip()}
        />
      )}

      {phase === "paused" && (
        <PauseOverlay
          muted={muted}
          coarse={coarse}
          onResume={() => engineRef.current?.resume()}
          onRestart={startGame}
          onQuit={toMenu}
          onToggleMute={toggleMute}
        />
      )}

      {phase === "over" && (
        <GameOver
          key={`${finalScore}-${finalStats.kills}`}
          score={finalScore}
          stats={finalStats}
          scores={scores}
          qualifies={qualifies}
          coarse={coarse}
          onSave={(name) => setScores(saveScore(name, finalScore))}
          onRetry={startGame}
          onMenu={toMenu}
          onHover={() => engineRef.current?.uiBlip()}
        />
      )}
    </div>
  );
}
