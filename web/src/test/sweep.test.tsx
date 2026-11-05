import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// kaplay needs WebGL, so stand in a catch-all fake whose only real piece is
// the scene root the pause wiring writes to.
const root = vi.hoisted(() => ({ paused: false }));
vi.mock("kaplay", () => {
  const any: object = new Proxy(function () {}, {
    get: (_t, key) => (key === "then" ? undefined : any),
    apply: () => any,
  });
  const k = new Proxy({}, { get: (_t, key) => (key === "getTreeRoot" ? () => root : any) });
  return { default: () => k };
});

import { Game, shieldLanding } from "../components/Game";

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("pause freezes the kaplay scene root", () => {
  beforeEach(() => { root.paused = false; });

  it("mirrors the paused prop onto the root, including when mounted paused", async () => {
    const noop = () => {};
    const { rerender, unmount } = render(<Game onScore={noop} onGameOver={noop} paused />);
    await flush();
    expect(root.paused).toBe(true);

    rerender(<Game onScore={noop} onGameOver={noop} paused={false} />);
    expect(root.paused).toBe(false);

    rerender(<Game onScore={noop} onGameOver={noop} paused />);
    expect(root.paused).toBe(true);
    unmount();
  });
});

describe("shieldLanding", () => {
  const plat = (x: number, y: number, width: number, opts: { spikes?: boolean; gone?: boolean } = {}) => ({
    pos: { x, y },
    width,
    exists: () => !opts.gone,
    spikes: opts.spikes ? ({} as never) : undefined,
  });

  it("lands on the first safe platform, keeping x when it is already above it", () => {
    expect(shieldLanding([plat(100, 300, 200)], 150)).toEqual({ x: 150, y: 300 });
  });

  it("moves the player onto a platform ahead, one tile in from its left edge", () => {
    expect(shieldLanding([plat(400, 420, 120)], 150)).toEqual({ x: 418, y: 420 });
  });

  it("skips spiked, destroyed, passed and off-screen platforms", () => {
    const platforms = [
      plat(-300, 300, 200),           // already scrolled past the player
      plat(200, 300, 100, { spikes: true }),
      plat(300, 300, 100, { gone: true }),
      plat(745, 300, 100),            // starts beyond the right clamp
    ];
    expect(shieldLanding(platforms, 150)).toBeNull();
    expect(shieldLanding([...platforms, plat(500, 260, 90)], 150)).toEqual({ x: 518, y: 260 });
  });

  it("needs a tile of room to the player's right", () => {
    expect(shieldLanding([plat(0, 300, 160)], 150)).toBeNull();
    expect(shieldLanding([plat(0, 300, 169)], 150)).toEqual({ x: 150, y: 300 });
  });
});
