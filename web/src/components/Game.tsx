import { useRef, useEffect } from "react";
import kaplay from "kaplay";

interface GameProps {
  onScore: (score: number) => void;
  onGameOver: () => void;
  paused?: boolean;
}

interface PosObj {
  exists(): boolean;
  destroy(): void;
  pos: { x: number; y: number };
}

interface CoinObj extends PosObj {
  angle: number;
}

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const PLAYER_SPEED = 300;
const JUMP_FORCE = 650;
const PLATFORM_SPEED_BASE = 120;
const PLATFORM_SPEED_MAX = 300;
const PLATFORM_SPEED_RAMP = 0.5;
const PLATFORM_GAP_BASE = 180;
const PLATFORM_GAP_MAX = 280;
const GAP_RAMP = 0.15;
const COIN_VALUE = 10;
const DISTANCE_SCORE_RATE = 2;

export function Game({ onScore, onGameOver, paused }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScoreRef = useRef(onScore);
  const onGameOverRef = useRef(onGameOver);
  const pausedRef = useRef(paused);
  onScoreRef.current = onScore;
  onGameOverRef.current = onGameOver;
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const k = kaplay({
      canvas,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      background: [15, 23, 42] as [number, number, number],
      global: false,
    });

    k.setGravity(1600);

    let score = 0;
    let coins = 0;
    let distance = 0;
    let elapsed = 0;
    let alive = true;

    // Player
    const player = k.add([
      k.rect(32, 40),
      k.pos(150, 300),
      k.area(),
      k.body(),
      k.anchor("bot"),
      k.color(37, 99, 235),
      "player",
    ]);

    // Player eye (decoration)
    const eye = k.add([
      k.rect(8, 8),
      k.pos(0, 0),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    eye.onUpdate(() => {
      eye.pos.x = player.pos.x + 8;
      eye.pos.y = player.pos.y - 28;
    });

    // Starting ground platform
    k.add([
      k.rect(400, 24),
      k.pos(0, 500),
      k.area(),
      k.body({ isStatic: true }),
      k.color(55, 65, 81),
      "platform",
    ]);

    // Procedural platform state
    let nextPlatformX = 350;
    const platforms: PosObj[] = [];
    const coinObjects: CoinObj[] = [];

    function getPlatformSpeed(): number {
      return Math.min(PLATFORM_SPEED_MAX, PLATFORM_SPEED_BASE + elapsed * PLATFORM_SPEED_RAMP);
    }

    function getGap(): number {
      return Math.min(PLATFORM_GAP_MAX, PLATFORM_GAP_BASE + elapsed * GAP_RAMP);
    }

    function spawnPlatform() {
      const gap = getGap();
      const w = 80 + Math.random() * 100;
      nextPlatformX += gap + Math.random() * 60;
      const y = 250 + Math.random() * 250;

      const plat = k.add([
        k.rect(w, 20),
        k.pos(nextPlatformX, y),
        k.area(),
        k.body({ isStatic: true }),
        k.color(55, 65, 81),
        "platform",
      ]);
      platforms.push(plat as unknown as PosObj);

      // Coin on some platforms
      if (Math.random() < 0.6) {
        const coin = k.add([
          k.rect(16, 16),
          k.pos(nextPlatformX + w / 2, y - 30),
          k.area(),
          k.anchor("center"),
          k.color(251, 191, 36),
          k.rotate(0),
          "coin",
        ]);
        coinObjects.push(coin as unknown as CoinObj);
      }
    }

    // Spawn initial platforms
    for (let i = 0; i < 8; i++) {
      spawnPlatform();
    }

    // Coin collection
    player.onCollide("coin", (coinObj) => {
      coins++;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);
      coinObj.destroy();
      const idx = coinObjects.findIndex((c) => !c.exists());
      if (idx !== -1) coinObjects.splice(idx, 1);
    });

    // Input state
    const input = { left: false, right: false, jump: false };

    k.onKeyDown("left", () => { input.left = true; });
    k.onKeyDown("a", () => { input.left = true; });
    k.onKeyDown("right", () => { input.right = true; });
    k.onKeyDown("d", () => { input.right = true; });
    k.onKeyPress("space", () => { input.jump = true; });
    k.onKeyPress("up", () => { input.jump = true; });
    k.onKeyPress("w", () => { input.jump = true; });

    // Touch controls
    k.onTouchStart((pos) => {
      if (pos.y < GAME_HEIGHT * 0.4) {
        input.jump = true;
      } else if (pos.x < GAME_WIDTH * 0.5) {
        input.left = true;
      } else {
        input.right = true;
      }
    });

    k.onTouchEnd(() => {
      input.left = false;
      input.right = false;
    });

    // Score display in-game
    const scoreLabel = k.add([
      k.text("0", { size: 20 }),
      k.pos(12, 12),
      k.color(255, 255, 255),
      k.fixed(),
    ]);

    // Main update loop
    k.onUpdate(() => {
      if (!alive || pausedRef.current) return;

      const dt = k.dt();
      elapsed += dt;
      distance += getPlatformSpeed() * dt / 60;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);
      scoreLabel.text = String(score);

      // Player movement
      if (input.left) {
        player.pos.x -= PLAYER_SPEED * dt;
      }
      if (input.right) {
        player.pos.x += PLAYER_SPEED * dt;
      }
      if (input.jump && player.isGrounded()) {
        player.jump(JUMP_FORCE);
      }

      // Reset per-frame input (keys use onKeyDown which re-fires, jump is press-based)
      input.left = false;
      input.right = false;
      input.jump = false;

      // Scroll everything left (endless runner)
      const speed = getPlatformSpeed() * dt;

      for (const plat of platforms) {
        if (plat.exists()) {
          plat.pos.x -= speed;
        }
      }
      for (const coin of coinObjects) {
        if (coin.exists()) {
          coin.pos.x -= speed;
          coin.angle += 180 * dt;
        }
      }
      player.pos.x -= speed;

      // Keep player from going too far left
      if (player.pos.x < 40) {
        player.pos.x = 40;
      }
      // Keep player from going too far right
      if (player.pos.x > GAME_WIDTH - 40) {
        player.pos.x = GAME_WIDTH - 40;
      }

      // Remove off-screen platforms and spawn new ones
      for (let i = platforms.length - 1; i >= 0; i--) {
        const plat = platforms[i];
        if (plat && plat.exists() && plat.pos.x < -200) {
          plat.destroy();
          platforms.splice(i, 1);
        }
      }
      for (let i = coinObjects.length - 1; i >= 0; i--) {
        const coin = coinObjects[i];
        if (coin && coin.exists() && coin.pos.x < -50) {
          coin.destroy();
          coinObjects.splice(i, 1);
        }
      }

      // Ensure we always have platforms ahead
      const rightmostX = platforms.reduce((max, p) => {
        if (p.exists()) return Math.max(max, p.pos.x);
        return max;
      }, 0);
      if (rightmostX < GAME_WIDTH + 400) {
        nextPlatformX = rightmostX;
        spawnPlatform();
      }

      // Fall off screen = game over
      if (player.pos.y > GAME_HEIGHT + 100) {
        alive = false;
        onGameOverRef.current();
      }
    });

    return () => {
      k.quit();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
