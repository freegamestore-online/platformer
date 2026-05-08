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

// Cloud data for parallax
interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  opacity: number;
}

// Sparkle particle for coin collection
interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

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
      background: [25, 35, 60] as [number, number, number],
      global: false,
    });

    k.setGravity(1600);

    let score = 0;
    let coins = 0;
    let distance = 0;
    let elapsed = 0;
    let alive = true;

    // --- Parallax clouds ---
    const clouds: Cloud[] = [];
    for (let i = 0; i < 8; i++) {
      clouds.push({
        x: Math.random() * GAME_WIDTH,
        y: 30 + Math.random() * 200,
        w: 60 + Math.random() * 100,
        h: 20 + Math.random() * 16,
        speed: 10 + Math.random() * 20,
        opacity: 0.15 + Math.random() * 0.2,
      });
    }

    // --- Sparkle particles ---
    const sparkles: Sparkle[] = [];

    function spawnSparkles(x: number, y: number) {
      const count = 6;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        sparkles.push({
          x, y,
          vx: Math.cos(angle) * (60 + Math.random() * 80),
          vy: Math.sin(angle) * (60 + Math.random() * 80) - 40,
          life: 0.4 + Math.random() * 0.3,
          maxLife: 0.4 + Math.random() * 0.3,
          size: 2 + Math.random() * 3,
        });
      }
    }

    // --- Background layer (z=-100 to draw behind everything) ---
    const bgLayer = k.add([
      k.pos(0, 0),
      k.z(-100),
      k.fixed(),
    ]);

    bgLayer.onDraw(() => {
      // Gradient sky
      const steps = 8;
      const stepH = GAME_HEIGHT / steps;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const r = Math.round(25 + t * 5);
        const g = Math.round(50 - t * 20);
        const b = Math.round(100 - t * 40);
        k.drawRect({
          pos: k.vec2(0, i * stepH),
          width: GAME_WIDTH,
          height: stepH + 1,
          color: k.rgb(r, g, b),
        });
      }

      // Clouds
      for (const c of clouds) {
        k.drawRect({
          pos: k.vec2(c.x, c.y),
          width: c.w,
          height: c.h,
          radius: c.h / 2,
          color: k.rgb(255, 255, 255),
          opacity: c.opacity,
        });
      }
    });

    // --- Foreground effects layer (z=100 to draw on top) ---
    const fxLayer = k.add([
      k.pos(0, 0),
      k.z(100),
      k.fixed(),
    ]);

    fxLayer.onDraw(() => {
      // Sparkles
      for (const s of sparkles) {
        const alpha = s.life / s.maxLife;
        k.drawCircle({
          pos: k.vec2(s.x, s.y),
          radius: s.size * alpha,
          color: k.rgb(251, 191, 36),
          opacity: alpha,
        });
      }

      // Player trail / glow
      for (const t of trailPositions) {
        const alpha = (1 - t.age / 0.25) * 0.3;
        k.drawCircle({
          pos: k.vec2(t.x, t.y),
          radius: 12,
          color: k.rgb(96, 165, 250),
          opacity: alpha,
        });
      }

      // Player glow
      if (alive && player.exists()) {
        k.drawCircle({
          pos: k.vec2(player.pos.x, player.pos.y - 20),
          radius: 24,
          color: k.rgb(59, 130, 246),
          opacity: 0.15,
        });
      }
    });

    // Player
    const player = k.add([
      k.rect(32, 40, { radius: 6 }),
      k.pos(150, 300),
      k.area(),
      k.body(),
      k.anchor("bot"),
      k.color(59, 130, 246),
      "player",
    ]);

    // Player eye (decoration)
    const eye = k.add([
      k.rect(8, 8, { radius: 2 }),
      k.pos(0, 0),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    eye.onUpdate(() => {
      eye.pos.x = player.pos.x + 8;
      eye.pos.y = player.pos.y - 28;
    });

    // Player trail
    const trailPositions: { x: number; y: number; age: number }[] = [];

    // Starting ground platform
    k.add([
      k.rect(400, 24, { radius: 6 }),
      k.pos(0, 500),
      k.area(),
      k.body({ isStatic: true }),
      k.color(71, 85, 105),
      k.outline(2, k.rgb(51, 65, 85)),
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
        k.rect(w, 20, { radius: 6 }),
        k.pos(nextPlatformX, y),
        k.area(),
        k.body({ isStatic: true }),
        k.color(71, 85, 105),
        k.outline(2, k.rgb(51, 65, 85)),
        "platform",
      ]);
      platforms.push(plat as unknown as PosObj);

      // Coin on some platforms
      if (Math.random() < 0.6) {
        const coin = k.add([
          k.rect(16, 16, { radius: 8 }),
          k.pos(nextPlatformX + w / 2, y - 30),
          k.area(),
          k.anchor("center"),
          k.color(251, 191, 36),
          k.outline(2, k.rgb(234, 179, 8)),
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
      spawnSparkles(coinObj.pos.x, coinObj.pos.y);
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

    // Main update loop
    k.onUpdate(() => {
      if (!alive || pausedRef.current) return;

      const dt = k.dt();
      elapsed += dt;
      distance += getPlatformSpeed() * dt / 60;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);

      // Update clouds
      for (const c of clouds) {
        c.x -= c.speed * dt;
        if (c.x + c.w < 0) {
          c.x = GAME_WIDTH + Math.random() * 100;
          c.y = 30 + Math.random() * 200;
        }
      }

      // Update sparkles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i]!;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) {
          sparkles.splice(i, 1);
        }
      }

      // Player trail
      if (!player.isGrounded()) {
        trailPositions.push({ x: player.pos.x, y: player.pos.y - 20, age: 0 });
      }
      for (let i = trailPositions.length - 1; i >= 0; i--) {
        trailPositions[i]!.age += dt;
        if (trailPositions[i]!.age > 0.25) {
          trailPositions.splice(i, 1);
        }
      }
      // Keep trail short
      while (trailPositions.length > 6) trailPositions.shift();

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
