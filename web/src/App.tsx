import { useState, useCallback, useEffect, useRef } from "react";
import { GameShell, GameTopbar, GameAuth } from "@freegamestore/games";
import { Game } from "./components/Game";
import { useLeaderboard } from '@freegamestore/games';
import type { GamePhase } from "./types";

const BEST_SCORE_KEY = "freeplatformer-best";

function getBestScore(): number {
  const v = localStorage.getItem(BEST_SCORE_KEY);
  return v ? parseInt(v, 10) : 0;
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>("playing");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(getBestScore);
  const [combo, setCombo] = useState(1);
  const [paused, setPaused] = useState(false);
  const scoreRef = useRef(0);
  const { submitScore } = useLeaderboard("platformer");

  const handleScore = useCallback((s: number) => {
    scoreRef.current = s;
    setScore(s);
  }, []);

  const handleCombo = useCallback((mult: number) => {
    setCombo(mult);
  }, []);

  const handleGameOver = useCallback(() => {
    const final = scoreRef.current;
    const best = getBestScore();
    if (final > best) {
      localStorage.setItem(BEST_SCORE_KEY, String(final));
      setBestScore(final);
    }
    setPhase("over");
    if (final > 0) submitScore(final);
  }, [submitScore]);

  const start = useCallback(() => {
    setScore(0);
    setCombo(1);
    scoreRef.current = 0;
    setPhase("playing");
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (phase !== "playing" && (e.key === " " || e.key === "Enter")) {
        start();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase, start]);

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Platformer"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Best", value: bestScore },
            ...(combo > 1 ? [{ label: "Combo", value: `×${combo}` }] : []),
          ]}
          onPlayPause={phase === "playing" ? () => setPaused(p => !p) : undefined}
          paused={paused}
          onRestart={start}
          actions={<GameAuth />}
          rules={
            <div>
              <h3 style={{fontWeight:700}}>Platformer</h3>
              <h4 style={{fontWeight:600}}>Controls</h4>
              <ul>
                <li>Arrow keys / WASD to move + jump</li>
                <li>Tap top of screen to jump; tap left/right side to move</li>
              </ul>
              <h4 style={{fontWeight:600}}>Score</h4>
              <ul>
                <li>Coins extend your combo timer. Chain pickups to stack a ×2 → ×3 → ×4 multiplier on coin value.</li>
                <li>Distance also scores, slowly.</li>
              </ul>
              <h4 style={{fontWeight:600}}>Hazards</h4>
              <ul>
                <li>Red saw-tooth strips on some platforms kill on contact.</li>
                <li>Falling off the bottom is also lethal.</li>
              </ul>
              <h4 style={{fontWeight:600}}>Power-ups</h4>
              <ul>
                <li><b>Blue</b> — double-jump: one extra mid-air jump for 8s.</li>
                <li><b>Purple</b> — slow-mo: world slows to 45% for 3s. Controls stay responsive.</li>
                <li><b>Gold</b> — shield: absorbs one spike or fall.</li>
              </ul>
            </div>
          }
        />
      }
    >
      <div className="relative w-full h-full">
        {phase === "playing" ? (
          <Game onScore={handleScore} onCombo={handleCombo} onGameOver={handleGameOver} paused={paused} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p
              className="text-xl font-bold"
              style={{ color: "var(--error)", fontFamily: "Fraunces, serif" }}
            >
              Game Over! Score: {score}
            </p>
            <button
              onClick={start}
              className="px-6 py-3 rounded-xl font-semibold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Play Again
            </button>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Press Space or Enter to start
            </p>
          </div>
        )}
      </div>
    </GameShell>
  );
}
