import { useRef, useEffect } from "react";
import kaplay from "kaplay";
import { useGameSounds } from "@freegamestore/games";

interface GameProps {
  onScore: (score: number) => void;
  onGameOver: () => void;
  onCombo?: (mult: number) => void;
  paused?: boolean;
}

type PowerupType = "double-jump" | "slow-mo" | "shield";

interface ActivePowerup {
  type: PowerupType;
  remaining: number;
  // For double-jump: number of jumps left while active.
  charges?: number;
}

interface PosObj {
  exists(): boolean;
  destroy(): void;
  pos: { x: number; y: number };
}

interface CoinObj extends PosObj {
  angle: number;
  baseY: number;
  bobOffset: number;
  // Marks a coin as a power-up pickup; the renderer + onCollide handler
  // branch on this.
  powerup?: PowerupType;
}

interface PlatformObj extends PosObj {
  spikes?: SpikeObj;
  onDraw(fn: () => void): void;
}

interface SpikeObj extends PosObj {
  width: number;
  onDraw(fn: () => void): void;
}

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const PLAYER_SPEED = 320;
const JUMP_FORCE = 900;
const GRAVITY = 1200;
// At g=1200, JUMP_FORCE=900 gives a peak jump height of 900²/(2·1200) ≈ 338 px.
// Platform Y range is 250–500 (top edge), so a 250 px elevation change is the
// worst case — comfortably reachable from a standing start, with margin for
// horizontal drift mid-jump.

const PLATFORM_SPEED_BASE = 140;
const PLATFORM_SPEED_MAX = 380;
// 1.6 px/s² ramp means cap hits at ~150 s (was ~360 s with 0.5). Difficulty
// is noticeable in the first minute, not the fifth.
const PLATFORM_SPEED_RAMP = 1.6;
const PLATFORM_GAP_BASE = 180;
const PLATFORM_GAP_MAX = 320;
const GAP_RAMP = 0.35;
// Platforms shrink over time too — narrowest at PLATFORM_W_MIN_LATE.
const PLATFORM_W_MIN_EARLY = 110;
const PLATFORM_W_MAX_EARLY = 200;
const PLATFORM_W_MIN_LATE = 60;
const PLATFORM_W_MAX_LATE = 110;
const WIDTH_RAMP_SECONDS = 120;
const COIN_VALUE = 10;
const DISTANCE_SCORE_RATE = 2;

// --- Combo system ---
// Each coin pickup extends a window; consecutive pickups within it raise the
// multiplier up to MAX_MULT. The window ticks down whether you're collecting
// or not, so you're rewarded for runs of close-together coins, not idle time.
const COMBO_WINDOW = 3.0;
const MAX_MULT = 4;

// --- Hazards ---
// Probability a newly spawned platform gets spikes on top. Ramps with elapsed:
// 0% before SPIKE_GRACE_SECONDS, then linearly to SPIKE_MAX_RATE by SPIKE_RAMP_END.
const SPIKE_GRACE_SECONDS = 15;
const SPIKE_RAMP_END = 90;
const SPIKE_MAX_RATE = 0.32;

// --- Power-ups ---
// Probability that a coin-bearing platform spawns a power-up instead.
const POWERUP_RATE = 0.08;
const DOUBLE_JUMP_DURATION = 8;
const DOUBLE_JUMP_CHARGES = 1;
const SLOWMO_DURATION = 3;
const SLOWMO_FACTOR = 0.45;
const SHIELD_DURATION = 999;  // Until consumed.

const TILE = 18;
const PLAYER_SCALE = 3.2;
const COIN_SCALE = 1.8;

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

export function Game({ onScore, onGameOver, onCombo, paused }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScoreRef = useRef(onScore);
  const onGameOverRef = useRef(onGameOver);
  const onComboRef = useRef(onCombo);
  const pausedRef = useRef(paused);
  onScoreRef.current = onScore;
  onGameOverRef.current = onGameOver;
  onComboRef.current = onCombo;
  pausedRef.current = paused;

  // SDK-synthesized sounds; auto-mute via the topbar toggle.
  const sounds = useGameSounds();
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;

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
      letterbox: true,
      background: [135, 200, 240] as [number, number, number],
      global: false,
    });

    // 12 cols × 3 rows of 18px tiles in characters.png. Each tile is a
    // standalone character (not a walk-cycle pair), so we extract a single
    // 18×18 frame and animate via squash-and-stretch in the update loop.
    // Tile (1, 0) = the green frog.
    k.loadSpriteAtlas("/sprites/characters.png", {
      player: { x: 18, y: 0, width: 18, height: 18 },
    });
    k.loadSprite("platform", "/sprites/platform.png");
    k.loadSprite("coin", "/sprites/coin.png");
    k.loadSprite("bg-mountains", "/sprites/bg-mountains.png");
    k.loadSprite("bg-hills-far", "/sprites/bg-hills-far.png");
    k.loadSprite("bg-hills-near", "/sprites/bg-hills-near.png");
    k.loadSprite("bg-cloud1", "/sprites/bg-cloud1.png");
    k.loadSprite("bg-cloud2", "/sprites/bg-cloud2.png");
    k.loadSprite("bg-sun", "/sprites/bg-sun.png");

    k.setGravity(GRAVITY);

    let score = 0;
    let coins = 0;
    let distance = 0;
    let elapsed = 0;
    let alive = true;
    let wasGrounded = true;

    // Combo state.
    let comboTimer = 0;
    let mult = 1;
    let lastReportedMult = 1;
    function bumpMult() {
      comboTimer = COMBO_WINDOW;
      if (mult < MAX_MULT) mult++;
    }
    function reportMultIfChanged() {
      if (mult !== lastReportedMult) {
        lastReportedMult = mult;
        onComboRef.current?.(mult);
      }
    }

    // Power-ups.
    const activePowerups: ActivePowerup[] = [];
    function hasPowerup(t: PowerupType): boolean {
      return activePowerups.some((p) => p.type === t);
    }
    function getPowerup(t: PowerupType): ActivePowerup | undefined {
      return activePowerups.find((p) => p.type === t);
    }
    function activatePowerup(t: PowerupType) {
      // Refresh if already active; otherwise add fresh.
      const existing = getPowerup(t);
      if (existing) {
        if (t === "double-jump") {
          existing.remaining = DOUBLE_JUMP_DURATION;
          existing.charges = (existing.charges ?? 0) + DOUBLE_JUMP_CHARGES;
        } else if (t === "slow-mo") {
          existing.remaining = SLOWMO_DURATION;
        } else if (t === "shield") {
          existing.remaining = SHIELD_DURATION;
        }
        return;
      }
      if (t === "double-jump") {
        activePowerups.push({ type: t, remaining: DOUBLE_JUMP_DURATION, charges: DOUBLE_JUMP_CHARGES });
      } else if (t === "slow-mo") {
        activePowerups.push({ type: t, remaining: SLOWMO_DURATION });
      } else if (t === "shield") {
        activePowerups.push({ type: t, remaining: SHIELD_DURATION });
      }
    }
    function consumeShield(): boolean {
      const idx = activePowerups.findIndex((p) => p.type === "shield");
      if (idx === -1) return false;
      activePowerups.splice(idx, 1);
      return true;
    }
    // Pick a power-up type with equal probability.
    function pickPowerup(): PowerupType {
      const r = Math.random();
      if (r < 0.34) return "double-jump";
      if (r < 0.67) return "slow-mo";
      return "shield";
    }

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
        // Shield aura when shield is active — clearly different from the
        // green ambient halo so the player knows they have a free hit.
        if (hasPowerup("shield")) {
          k.drawCircle({
            pos: k.vec2(player.pos.x, player.pos.y - 28),
            radius: 38 + Math.sin(elapsed * 6) * 3,
            color: k.rgb(255, 215, 100),
            opacity: 0.22,
          });
        } else {
          k.drawCircle({
            pos: k.vec2(player.pos.x, player.pos.y - 18),
            radius: 22,
            color: k.rgb(120, 220, 130),
            opacity: 0.18,
          });
        }
        // Slow-mo vignette tint — pale purple over the whole screen.
        if (hasPowerup("slow-mo")) {
          k.drawRect({
            pos: k.vec2(0, 0),
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
            color: k.rgb(180, 120, 255),
            opacity: 0.08,
          });
        }
      }

      // Active power-up icons in the top-left of the play area, stacked
      // vertically. Each shows the type glyph + a remaining bar (or charge
      // count for double-jump).
      let stackY = 14;
      for (const pu of activePowerups) {
        const iconX = 18;
        const iconY = stackY;
        // Background pill
        k.drawRect({
          pos: k.vec2(iconX - 4, iconY - 4),
          width: 70,
          height: 28,
          color: k.rgb(20, 20, 30),
          opacity: 0.55,
          radius: 14,
        });
        // Glyph (reuse drawPowerup at local space)
        const haloColor: [number, number, number] =
          pu.type === "double-jump" ? [100, 180, 255] :
          pu.type === "slow-mo"     ? [180, 120, 255] :
                                      [255, 215, 100];
        k.drawCircle({
          pos: k.vec2(iconX + 6, iconY + 10),
          radius: 8,
          color: k.rgb(haloColor[0], haloColor[1], haloColor[2]),
        });
        // Label: time remaining (or charges for double-jump)
        const label =
          pu.type === "double-jump" ? `×${pu.charges ?? 0}` :
          pu.type === "slow-mo"     ? `${pu.remaining.toFixed(1)}s` :
                                      "1 hit";
        k.drawText({
          text: label,
          pos: k.vec2(iconX + 20, iconY + 4),
          size: 12,
          color: k.rgb(240, 240, 250),
        });
        stackY += 34;
      }

      // Combo multiplier indicator — visible only when active. Big number
      // top-center so it doesn't fight with the score in the topbar.
      if (mult > 1) {
        const pulse = 1 + Math.sin(elapsed * 16) * 0.05;
        const text = `×${mult}`;
        k.drawText({
          text,
          pos: k.vec2(GAME_WIDTH / 2, 20),
          size: 28 * pulse,
          color: mult >= 4 ? k.rgb(255, 80, 80) : mult >= 3 ? k.rgb(255, 160, 80) : k.rgb(255, 230, 80),
          anchor: "top",
          outline: { color: k.rgb(20, 20, 40), width: 3 },
        });
        // Combo timer bar under the number.
        const barW = 60;
        const fill = comboTimer / COMBO_WINDOW;
        k.drawRect({
          pos: k.vec2(GAME_WIDTH / 2 - barW / 2, 50),
          width: barW,
          height: 4,
          color: k.rgb(40, 40, 60),
          opacity: 0.8,
          radius: 2,
        });
        k.drawRect({
          pos: k.vec2(GAME_WIDTH / 2 - barW / 2, 50),
          width: barW * fill,
          height: 4,
          color: k.rgb(255, 230, 80),
          radius: 2,
        });
      }
    });

    // Player: single-frame sprite with hand-rolled squash-and-stretch.
    // Real walk frames live on different rows of the Kenney sheet but the
    // squash-on-ground / stretch-on-jump pattern reads more clearly than a
    // 2-frame cycle at this scale.
    const player = k.add([
      k.sprite("player"),
      k.scale(k.vec2(PLAYER_SCALE, PLAYER_SCALE)),
      k.pos(150, 300),
      k.area(),
      k.body(),
      k.anchor("bot"),
      "player",
    ]);

    const trailPositions: { x: number; y: number; age: number }[] = [];

    function addPlatform(x: number, y: number, w: number, withSpikes: boolean): PlatformObj {
      const plat = k.add([
        k.rect(w, TILE),
        k.pos(x, y),
        k.area(),
        k.body({ isStatic: true }),
        k.color(101, 67, 33),
        "platform",
      ]) as unknown as PlatformObj;
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

      // Spike strip: same x-extent, sits just above the platform top, kills
      // on contact. Drawn as red saw-teeth.
      if (withSpikes) {
        // Inset 6px from each end so the player has at least a small safe
        // landing zone on the edges.
        const spikeInset = Math.min(6, Math.max(0, w / 4));
        const spikeX = x + spikeInset;
        const spikeW = w - spikeInset * 2;
        const spikeH = 10;
        const spike = k.add([
          k.rect(spikeW, spikeH),
          k.pos(spikeX, y - spikeH),
          k.area(),
          k.color(220, 60, 60),
          k.opacity(0),  // hidden body; visuals via onDraw below
          "spike",
        ]) as unknown as SpikeObj;
        spike.width = spikeW;
        spike.onDraw(() => {
          // Saw-tooth triangles.
          const toothW = 8;
          const teeth = Math.max(2, Math.floor(spikeW / toothW));
          const actualToothW = spikeW / teeth;
          for (let i = 0; i < teeth; i++) {
            k.drawTriangle({
              p1: k.vec2(i * actualToothW, spikeH),
              p2: k.vec2(i * actualToothW + actualToothW / 2, 0),
              p3: k.vec2((i + 1) * actualToothW, spikeH),
              color: k.rgb(210, 60, 60),
              outline: { color: k.rgb(140, 30, 30), width: 1 },
            });
          }
        });
        plat.spikes = spike;
      }

      return plat;
    }

    // Starting ground platform — NOT in scrolling array (acts as safe zone)
    addPlatform(0, 500, 400, false);

    let nextPlatformX = 350;
    const platforms: PlatformObj[] = [];
    const coinObjects: CoinObj[] = [];

    function getSpikeRate(): number {
      if (elapsed < SPIKE_GRACE_SECONDS) return 0;
      const t = Math.min(1, (elapsed - SPIKE_GRACE_SECONDS) / (SPIKE_RAMP_END - SPIKE_GRACE_SECONDS));
      return SPIKE_MAX_RATE * t;
    }

    function getPlatformSpeed(): number {
      return Math.min(PLATFORM_SPEED_MAX, PLATFORM_SPEED_BASE + elapsed * PLATFORM_SPEED_RAMP);
    }

    function getGap(): number {
      return Math.min(PLATFORM_GAP_MAX, PLATFORM_GAP_BASE + elapsed * GAP_RAMP);
    }

    function getPlatformWidthRange(): { min: number; max: number } {
      const t = Math.min(1, elapsed / WIDTH_RAMP_SECONDS);
      const min = PLATFORM_W_MIN_EARLY + (PLATFORM_W_MIN_LATE - PLATFORM_W_MIN_EARLY) * t;
      const max = PLATFORM_W_MAX_EARLY + (PLATFORM_W_MAX_LATE - PLATFORM_W_MAX_EARLY) * t;
      return { min, max };
    }

    function spawnPlatform() {
      const gap = getGap();
      const { min: wMin, max: wMax } = getPlatformWidthRange();
      const w = wMin + Math.random() * (wMax - wMin);
      nextPlatformX += gap + Math.random() * 60;
      const y = 250 + Math.random() * 250;

      const wantsSpikes = Math.random() < getSpikeRate();
      const plat = addPlatform(nextPlatformX, y, w, wantsSpikes);
      platforms.push(plat);

      // A spiked platform never carries a coin/powerup on top — the spikes
      // are the entire deal. Plain platforms have a 60% chance of a coin
      // and a small fraction of those are upgraded to a power-up.
      if (!wantsSpikes && Math.random() < 0.6) {
        const isPowerup = Math.random() < POWERUP_RATE;
        const coinBaseY = y - 28;
        const coin = k.add([
          k.sprite("coin"),
          k.scale(COIN_SCALE),
          k.pos(nextPlatformX + w / 2, coinBaseY),
          k.area(),
          k.anchor("center"),
          k.rotate(0),
          ...(isPowerup ? [k.opacity(0)] : []),
          isPowerup ? "powerup" : "coin",
        ]) as unknown as CoinObj;
        coin.baseY = coinBaseY;
        coin.bobOffset = Math.random() * Math.PI * 2;
        if (isPowerup) {
          coin.powerup = pickPowerup();
          (coin as unknown as { onDraw: (fn: () => void) => void }).onDraw(() => {
            drawPowerup(coin.powerup!);
          });
        }
        coinObjects.push(coin);
      }
    }

    // Draw a power-up token in the local space of a coin object. Each type
    // has a distinct color + glyph, plus a soft halo so it reads as special.
    function drawPowerup(t: PowerupType) {
      // Soft halo
      const haloColor: [number, number, number] =
        t === "double-jump" ? [100, 180, 255] :
        t === "slow-mo"     ? [180, 120, 255] :
                              [255, 215, 100];
      k.drawCircle({
        pos: k.vec2(0, 0),
        radius: 14,
        color: k.rgb(haloColor[0], haloColor[1], haloColor[2]),
        opacity: 0.4,
      });
      // Solid body
      k.drawCircle({
        pos: k.vec2(0, 0),
        radius: 9,
        color: k.rgb(haloColor[0], haloColor[1], haloColor[2]),
        outline: { color: k.rgb(20, 20, 20), width: 1.5 },
      });
      // Glyph (white)
      if (t === "double-jump") {
        // Up-chevron
        k.drawTriangle({
          p1: k.vec2(-4, 2),
          p2: k.vec2(0, -4),
          p3: k.vec2(4, 2),
          color: k.rgb(255, 255, 255),
        });
        k.drawTriangle({
          p1: k.vec2(-4, 6),
          p2: k.vec2(0, 0),
          p3: k.vec2(4, 6),
          color: k.rgb(255, 255, 255),
        });
      } else if (t === "slow-mo") {
        // Clock face: circle + two lines (hour/minute hands)
        k.drawCircle({
          pos: k.vec2(0, 0),
          radius: 5,
          color: k.rgb(255, 255, 255),
        });
        k.drawRect({
          pos: k.vec2(-0.5, -4),
          width: 1,
          height: 4,
          color: k.rgb(40, 40, 40),
        });
        k.drawRect({
          pos: k.vec2(-0.5, -0.5),
          width: 3.5,
          height: 1,
          color: k.rgb(40, 40, 40),
        });
      } else {
        // Shield: small house-shape pentagon
        k.drawPolygon({
          pts: [
            k.vec2(0, -5),
            k.vec2(4, -2),
            k.vec2(3, 4),
            k.vec2(-3, 4),
            k.vec2(-4, -2),
          ],
          color: k.rgb(255, 255, 255),
          outline: { color: k.rgb(120, 80, 0), width: 1 },
        });
      }
    }

    for (let i = 0; i < 8; i++) spawnPlatform();

    player.onCollide("coin", (coinObj) => {
      bumpMult();
      // Multiplier applies to coin reward, not to distance score (distance
      // is passive and rewarding it would let you idle for a multiplier).
      coins += mult;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);
      spawnSparkles(coinObj.pos.x, coinObj.pos.y);
      soundsRef.current.playScore();
      reportMultIfChanged();
      coinObj.destroy();
      const idx = coinObjects.findIndex((c) => !c.exists());
      if (idx !== -1) coinObjects.splice(idx, 1);
    });

    player.onCollide("powerup", (puObj) => {
      const co = puObj as unknown as CoinObj;
      if (co.powerup) activatePowerup(co.powerup);
      spawnSparkles(puObj.pos.x, puObj.pos.y);
      soundsRef.current.playLevelUp();
      puObj.destroy();
      const idx = coinObjects.findIndex((c) => !c.exists());
      if (idx !== -1) coinObjects.splice(idx, 1);
    });

    player.onCollide("spike", () => {
      if (!alive) return;
      if (consumeShield()) {
        // Soft pushback — small bounce, reset combo, audio cue.
        const playerWithVel = player as unknown as { jump: (n: number) => void };
        playerWithVel.jump(JUMP_FORCE * 0.7);
        soundsRef.current.playError();
        mult = 1;
        comboTimer = 0;
        reportMultIfChanged();
        return;
      }
      alive = false;
      soundsRef.current.playGameOver();
      onGameOverRef.current();
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

      const rawDt = k.dt();
      // Slow-mo affects world scroll, platform/coin movement, and elapsed
      // time used for distance scoring + difficulty ramp — but NOT player
      // input responsiveness (input/jump still use rawDt so controls feel
      // crisp during the slow phase).
      const slowing = hasPowerup("slow-mo");
      const dt = slowing ? rawDt * SLOWMO_FACTOR : rawDt;
      elapsed += dt;
      distance += getPlatformSpeed() * dt / 60;
      score = coins * COIN_VALUE + Math.floor(distance * DISTANCE_SCORE_RATE);
      onScoreRef.current(score);

      // Combo decay — ticks down whether or not slow-mo is on. (If you slow
      // the world AND get a longer combo window, slow-mo would be
      // unconditionally optimal; we want it to be a tactical choice.)
      if (comboTimer > 0) {
        comboTimer -= rawDt;
        if (comboTimer <= 0) {
          comboTimer = 0;
          mult = 1;
          reportMultIfChanged();
        }
      }

      // Power-up timers (use rawDt — slow-mo shouldn't extend itself).
      for (let i = activePowerups.length - 1; i >= 0; i--) {
        activePowerups[i]!.remaining -= rawDt;
        if (activePowerups[i]!.remaining <= 0) activePowerups.splice(i, 1);
      }

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

      // Movement: use rawDt so controls stay responsive in slow-mo (your
      // input rate doesn't slow down even though the world does).
      if (input.left) player.pos.x -= PLAYER_SPEED * rawDt;
      if (input.right) player.pos.x += PLAYER_SPEED * rawDt;
      if (input.jump) {
        if (player.isGrounded()) {
          player.jump(JUMP_FORCE);
          soundsRef.current.playMove();
        } else {
          // Air jump if a double-jump power-up has a charge left.
          const dj = getPowerup("double-jump");
          if (dj && (dj.charges ?? 0) > 0) {
            dj.charges = (dj.charges ?? 0) - 1;
            player.jump(JUMP_FORCE * 0.95);
            soundsRef.current.playMove();
            // Visual: spawn an upward burst at the player's feet so the
            // double-jump reads even without a HUD.
            spawnSparkles(player.pos.x, player.pos.y);
          }
        }
      }
      input.left = false;
      input.right = false;
      input.jump = false;

      // Land detection: airborne -> grounded transition fires playDrop
      const groundedNow = player.isGrounded();
      if (groundedNow && !wasGrounded) soundsRef.current.playDrop();
      wasGrounded = groundedNow;

      // Squash-and-stretch. Grounded: subtle running bob (4 Hz). Airborne:
      // vertical-velocity-driven stretch (taller going up, squat coming down).
      const vy = (player as unknown as { vel: { y: number } }).vel.y;
      if (groundedNow) {
        const bob = 1 + Math.sin(elapsed * 12) * 0.06;
        (player as unknown as { scale: { x: number; y: number } }).scale.x = PLAYER_SCALE;
        (player as unknown as { scale: { x: number; y: number } }).scale.y = PLAYER_SCALE * bob;
      } else {
        const stretch = Math.max(-0.18, Math.min(0.22, -vy / 1600));
        (player as unknown as { scale: { x: number; y: number } }).scale.x = PLAYER_SCALE * (1 - stretch * 0.5);
        (player as unknown as { scale: { x: number; y: number } }).scale.y = PLAYER_SCALE * (1 + stretch);
      }

      // World scroll: shove all gameplay objects left
      for (const plat of platforms) {
        if (plat.exists()) {
          plat.pos.x -= speed;
          if (plat.spikes && plat.spikes.exists()) plat.spikes.pos.x -= speed;
        }
      }
      for (const coin of coinObjects) {
        if (coin.exists()) {
          coin.pos.x -= speed;
          // Hover: bob 4px vertically + sway ±6° rotation, phase-offset so a row
          // of gems doesn't move in lockstep.
          const phase = elapsed * 2 + coin.bobOffset;
          coin.pos.y = coin.baseY + Math.sin(phase) * 4;
          coin.angle = Math.sin(phase) * 6;
        }
      }
      player.pos.x -= speed;

      if (player.pos.x < 40) player.pos.x = 40;
      if (player.pos.x > GAME_WIDTH - 40) player.pos.x = GAME_WIDTH - 40;

      for (let i = platforms.length - 1; i >= 0; i--) {
        const plat = platforms[i];
        if (plat && plat.exists() && plat.pos.x < -200) {
          if (plat.spikes && plat.spikes.exists()) plat.spikes.destroy();
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
        soundsRef.current.playGameOver();
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
