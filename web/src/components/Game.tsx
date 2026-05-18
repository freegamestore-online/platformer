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

const TILE = 18;
const PLAYER_SCALE = 2;
const COIN_SCALE = 1.4;

const MOUNTAIN_W = 1001;
const MOUNTAIN_H = 168;
const HILL_W = 1001;
const HILL_H = 128;
const CLOUD1_W = 189;
const CLOUD1_H = 127;
const CLOUD2_W = 176;
const CLOUD2_H = 121;

interface Cloud {
  sprite: "bg-cloud1" | "bg-cloud2";
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  opacity: number;
}

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

    // React StrictMode invokes effect setup → cleanup → setup synchronously in dev.
    // kaplay maintains global state and binds a WebGL context to the canvas; a
    // sync quit-then-init leaves the canvas's GL context lost. Defer init to a
    // microtask so the StrictMode cleanup can flip `cancelled` first; only the
    // surviving mount actually runs kaplay.
    let cancelled = false;
    let teardown: (() => void) | null = null;

    queueMicrotask(() => {
      if (cancelled) return;

      const k = kaplay({
      canvas,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      background: [135, 200, 240] as [number, number, number],
      global: false,
    });

    // 12 cols × 4 rows of 18px tiles in characters.png; green frog is tiles 0–1
    k.loadSpriteAtlas("/sprites/characters.png", {
      player: {
        x: 0,
        y: 0,
        width: 36,
        height: 18,
        sliceX: 2,
        anims: {
          walk: { from: 0, to: 1, loop: true, speed: 6 },
        },
      },
    });
    k.loadSprite("platform", "/sprites/platform.png");
    k.loadSprite("coin", "/sprites/coin.png");
    k.loadSprite("bg-mountains", "/sprites/bg-mountains.png");
    k.loadSprite("bg-hills-far", "/sprites/bg-hills-far.png");
    k.loadSprite("bg-hills-near", "/sprites/bg-hills-near.png");
    k.loadSprite("bg-cloud1", "/sprites/bg-cloud1.png");
    k.loadSprite("bg-cloud2", "/sprites/bg-cloud2.png");
    k.loadSprite("bg-sun", "/sprites/bg-sun.png");

    k.setGravity(1600);

    let score = 0;
    let coins = 0;
    let distance = 0;
    let elapsed = 0;
    let alive = true;

    // Parallax scroll offsets (negative = world moves left)
    let scrollFar = 0;
    let scrollMid = 0;
    let scrollNear = 0;

    // Drifting foreground clouds
    const clouds: Cloud[] = [];
    for (let i = 0; i < 5; i++) {
      const useFirst = Math.random() < 0.5;
      const scale = 0.55 + Math.random() * 0.4;
      clouds.push({
        sprite: useFirst ? "bg-cloud1" : "bg-cloud2",
        x: Math.random() * GAME_WIDTH,
        y: 40 + Math.random() * 140,
        w: (useFirst ? CLOUD1_W : CLOUD2_W) * scale,
        h: (useFirst ? CLOUD1_H : CLOUD2_H) * scale,
        speed: 20 + Math.random() * 30,
        opacity: 0.75 + Math.random() * 0.2,
      });
    }

    const sparkles: Sparkle[] = [];

    function spawnSparkles(x: number, y: number) {
      const count = 8;
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

    // Background layer (drawn behind everything)
    const bgLayer = k.add([
      k.pos(0, 0),
      k.z(-100),
      k.fixed(),
    ]);

    bgLayer.onDraw(() => {
      // Soft sky gradient (top -> horizon)
      const steps = 10;
      const stepH = GAME_HEIGHT / steps;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const r = Math.round(110 + t * 70);
        const g = Math.round(170 + t * 40);
        const b = Math.round(230 - t * 30);
        k.drawRect({
          pos: k.vec2(0, i * stepH),
          width: GAME_WIDTH,
          height: stepH + 1,
          color: k.rgb(r, g, b),
        });
      }

      // Sun (fixed top-right, with soft halo)
      const sunX = GAME_WIDTH - 130;
      const sunY = 70;
      k.drawCircle({
        pos: k.vec2(sunX + 40, sunY + 40),
        radius: 70,
        color: k.rgb(255, 240, 180),
        opacity: 0.35,
      });
      k.drawSprite({
        sprite: "bg-sun",
        pos: k.vec2(sunX, sunY),
        width: 80,
        height: 80,
      });

      // Far mountains — slowest parallax
      const farScale = 0.7;
      const farW = MOUNTAIN_W * farScale;
      const farH = MOUNTAIN_H * farScale;
      const farY = GAME_HEIGHT - 320;
      const farOff = ((scrollFar % farW) + farW) % farW - farW;
      for (let i = 0; i < 3; i++) {
        k.drawSprite({
          sprite: "bg-mountains",
          pos: k.vec2(farOff + i * farW, farY),
          width: farW,
          height: farH,
          opacity: 0.7,
        });
      }

      // Mid hills
      const midScale = 0.55;
      const midW = HILL_W * midScale;
      const midH = HILL_H * midScale;
      const midY = GAME_HEIGHT - 220;
      const midOff = ((scrollMid % midW) + midW) % midW - midW;
      for (let i = 0; i < 3; i++) {
        k.drawSprite({
          sprite: "bg-hills-far",
          pos: k.vec2(midOff + i * midW, midY),
          width: midW,
          height: midH,
          opacity: 0.85,
        });
      }

      // Near hills
      const nearScale = 0.5;
      const nearW = HILL_W * nearScale;
      const nearH = HILL_H * nearScale;
      const nearY = GAME_HEIGHT - 160;
      const nearOff = ((scrollNear % nearW) + nearW) % nearW - nearW;
      for (let i = 0; i < 3; i++) {
        k.drawSprite({
          sprite: "bg-hills-near",
          pos: k.vec2(nearOff + i * nearW, nearY),
          width: nearW,
          height: nearH,
        });
      }

      // Drifting clouds
      for (const c of clouds) {
        k.drawSprite({
          sprite: c.sprite,
          pos: k.vec2(c.x, c.y),
          width: c.w,
          height: c.h,
          opacity: c.opacity,
        });
      }
    });

    // FX layer (in front of gameplay objects)
    const fxLayer = k.add([
      k.pos(0, 0),
      k.z(100),
      k.fixed(),
    ]);

    fxLayer.onDraw(() => {
      for (const s of sparkles) {
        const alpha = s.life / s.maxLife;
        k.drawCircle({
          pos: k.vec2(s.x, s.y),
          radius: s.size * alpha,
          color: k.rgb(251, 191, 36),
          opacity: alpha,
        });
      }
      for (const t of trailPositions) {
        const alpha = (1 - t.age / 0.25) * 0.35;
        k.drawCircle({
          pos: k.vec2(t.x, t.y),
          radius: 11,
          color: k.rgb(120, 220, 130),
          opacity: alpha,
        });
      }
      if (alive && player.exists()) {
        k.drawCircle({
          pos: k.vec2(player.pos.x, player.pos.y - 18),
          radius: 22,
          color: k.rgb(120, 220, 130),
          opacity: 0.18,
        });
      }
    });

    // Player: animated sprite, hops forever (walk anim cycles frames 0-1)
    const player = k.add([
      k.sprite("player", { anim: "walk" }),
      k.scale(PLAYER_SCALE),
      k.pos(150, 300),
      k.area(),
      k.body(),
      k.anchor("bot"),
      "player",
    ]);

    const trailPositions: { x: number; y: number; age: number }[] = [];

    function addPlatform(x: number, y: number, w: number): PosObj {
      const plat = k.add([
        k.rect(w, TILE),
        k.pos(x, y),
        k.area(),
        k.body({ isStatic: true }),
        k.color(101, 67, 33),
        "platform",
      ]);
      plat.onDraw(() => {
        const tiles = Math.ceil(w / TILE);
        for (let i = 0; i < tiles; i++) {
          k.drawSprite({
            sprite: "platform",
            pos: k.vec2(i * TILE, 0),
            width: TILE,
            height: TILE,
          });
        }
      });
      return plat as unknown as PosObj;
    }

    // Starting ground platform — NOT in scrolling array (acts as safe zone)
    addPlatform(0, 500, 400);

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

      const plat = addPlatform(nextPlatformX, y, w);
      platforms.push(plat);

      if (Math.random() < 0.6) {
        const coin = k.add([
          k.sprite("coin"),
          k.scale(COIN_SCALE),
          k.pos(nextPlatformX + w / 2, y - 26),
          k.area(),
          k.anchor("center"),
          k.rotate(0),
          "coin",
        ]);
        coinObjects.push(coin as unknown as CoinObj);
      }
    }

    for (let i = 0; i < 8; i++) spawnPlatform();

    player.onCollide("coin", (coinObj) => {
      coins++;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);
      spawnSparkles(coinObj.pos.x, coinObj.pos.y);
      coinObj.destroy();
      const idx = coinObjects.findIndex((c) => !c.exists());
      if (idx !== -1) coinObjects.splice(idx, 1);
    });

    const input = { left: false, right: false, jump: false };
    k.onKeyDown("left", () => { input.left = true; });
    k.onKeyDown("a", () => { input.left = true; });
    k.onKeyDown("right", () => { input.right = true; });
    k.onKeyDown("d", () => { input.right = true; });
    k.onKeyPress("space", () => { input.jump = true; });
    k.onKeyPress("up", () => { input.jump = true; });
    k.onKeyPress("w", () => { input.jump = true; });
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

    k.onUpdate(() => {
      if (!alive || pausedRef.current) return;

      const dt = k.dt();
      elapsed += dt;
      distance += getPlatformSpeed() * dt / 60;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);

      const speed = getPlatformSpeed() * dt;

      // Parallax: layers scroll at fractions of world speed
      scrollFar -= speed * 0.08;
      scrollMid -= speed * 0.22;
      scrollNear -= speed * 0.5;

      // Drifting clouds (independent slow drift)
      for (const c of clouds) {
        c.x -= c.speed * dt;
        if (c.x + c.w < -50) {
          c.x = GAME_WIDTH + Math.random() * 100;
          c.y = 40 + Math.random() * 140;
        }
      }

      // Sparkles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i]!;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) sparkles.splice(i, 1);
      }

      // Trail (only when airborne)
      if (!player.isGrounded()) {
        trailPositions.push({ x: player.pos.x, y: player.pos.y - 18, age: 0 });
      }
      for (let i = trailPositions.length - 1; i >= 0; i--) {
        trailPositions[i]!.age += dt;
        if (trailPositions[i]!.age > 0.25) trailPositions.splice(i, 1);
      }
      while (trailPositions.length > 6) trailPositions.shift();

      // Movement
      if (input.left) player.pos.x -= PLAYER_SPEED * dt;
      if (input.right) player.pos.x += PLAYER_SPEED * dt;
      if (input.jump && player.isGrounded()) player.jump(JUMP_FORCE);
      input.left = false;
      input.right = false;
      input.jump = false;

      // World scroll: shove all gameplay objects left
      for (const plat of platforms) {
        if (plat.exists()) plat.pos.x -= speed;
      }
      for (const coin of coinObjects) {
        if (coin.exists()) {
          coin.pos.x -= speed;
          coin.angle += 180 * dt;
        }
      }
      player.pos.x -= speed;

      if (player.pos.x < 40) player.pos.x = 40;
      if (player.pos.x > GAME_WIDTH - 40) player.pos.x = GAME_WIDTH - 40;

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

      const rightmostX = platforms.reduce((max, p) => {
        if (p.exists()) return Math.max(max, p.pos.x);
        return max;
      }, 0);
      if (rightmostX < GAME_WIDTH + 400) {
        nextPlatformX = rightmostX;
        spawnPlatform();
      }

      if (player.pos.y > GAME_HEIGHT + 100) {
        alive = false;
        onGameOverRef.current();
      }
    });

      teardown = () => k.quit();
    });

    return () => {
      cancelled = true;
      if (teardown) teardown();
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
