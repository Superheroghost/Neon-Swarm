/**
 * NEON SWARM — core engine.
 * Canvas 2D, additive pre-baked glow sprites, pooled entities, zero per-frame
 * allocation in hot paths. Keyboard + mouse on desktop, twin virtual sticks
 * on touch. Adaptive quality keeps a locked 60fps.
 */
import { AudioEngine } from "./audio";
import { buildSprites, PALETTE, type Sprites } from "./sprites";

export type Phase = "menu" | "playing" | "paused" | "over";

export interface HudState {
  score: number;
  mult: number;
  lives: number;
}

export interface GameStats {
  kills: number;
  time: number;
  maxMult: number;
}

export interface EngineCallbacks {
  onHud: (h: HudState) => void;
  onPhase: (p: Phase) => void;
  onGameOver: (score: number, stats: GameStats) => void;
}

const TAU = Math.PI * 2;
const WALL_PAD = 10;

interface PoolItem {
  alive: boolean;
  pi: number;
}

class Pool<T extends PoolItem> {
  items: T[];
  free: number[];
  constructor(cap: number, make: (i: number) => T) {
    this.items = [];
    this.free = [];
    for (let i = 0; i < cap; i++) {
      this.items.push(make(i));
      this.free.push(cap - 1 - i);
    }
  }
  spawn(): T | null {
    const i = this.free.pop();
    if (i === undefined) return null;
    const o = this.items[i];
    o.alive = true;
    return o;
  }
  kill(o: T): void {
    if (!o.alive) return;
    o.alive = false;
    this.free.push(o.pi);
  }
  reset(): void {
    this.free.length = 0;
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].alive = false;
      this.free.push(this.items.length - 1 - i);
    }
  }
}

// ------------------------------------------------------------------ entities

interface Enemy extends PoolItem {
  type: number; // 0 chaser, 1 wanderer, 2 weaver, 3 splitter, 4 small chaser
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  r: number;
  k: number; // sprite scale vs canonical
  hp: number;
  age: number;
  seed: number;
  intro: number;
  flash: number;
  spd: number;
  score: number;
  wakeT: number;
}

interface Bullet extends PoolItem {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
}

interface Particle extends PoolItem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  spr: HTMLCanvasElement;
  stretch: boolean;
  drag: number;
  a0: number;
}

interface FloatText extends PoolItem {
  x: number;
  y: number;
  vy: number;
  t: number;
  life: number;
  str: string;
  color: string;
  size: number;
}

interface Portal extends PoolItem {
  x: number;
  y: number;
  type: number;
  t: number;
  dur: number;
}

interface Shock extends PoolItem {
  x: number;
  y: number;
  r: number;
  vr: number;
  t: number;
  life: number;
  color: string;
  w: number;
}

interface Pickup extends PoolItem {
  x: number;
  y: number;
  t: number;
  ttl: number;
  vx: number;
  vy: number;
}

interface EnemySpec {
  spd: number;
  r: number;
  hp: number;
  score: number;
}

const ENEMY_DEFS: EnemySpec[] = [
  { spd: 165, r: 15, hp: 1, score: 50 }, // chaser
  { spd: 115, r: 14, hp: 1, score: 40 }, // wanderer
  { spd: 175, r: 14, hp: 2, score: 80 }, // weaver
  { spd: 68, r: 22, hp: 3, score: 120 }, // splitter
  { spd: 235, r: 9, hp: 1, score: 30 }, // small chaser
];

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cbs: EngineCallbacks;
  private sprites: Sprites;
  readonly audio = new AudioEngine();

  private raf = 0;
  private lastT = 0;
  private wallT = 0; // unscaled time for shake/reticle anims
  private destroyed = false;

  phase: Phase = "menu";

  private w = 800;
  private h = 600;
  private dpr = 1;
  private bg: HTMLCanvasElement | null = null;
  private ro: ResizeObserver | null = null;

  // pools
  private enemies = new Pool<Enemy>(120, (i) => ({
    alive: false, pi: i, type: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0,
    r: 10, k: 1, hp: 1, age: 0, seed: 0, intro: 0, flash: 0, spd: 100, score: 10, wakeT: 0,
  }));
  private bullets = new Pool<Bullet>(110, (i) => ({
    alive: false, pi: i, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0,
  }));
  private particles = new Pool<Particle>(1400, (i) => ({
    alive: false, pi: i, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, size: 5,
    spr: null as unknown as HTMLCanvasElement, stretch: false, drag: 0, a0: 1,
  }));
  private texts = new Pool<FloatText>(26, (i) => ({
    alive: false, pi: i, x: 0, y: 0, vy: 0, t: 0, life: 1, str: "", color: "#fff", size: 14,
  }));
  private portals = new Pool<Portal>(48, (i) => ({
    alive: false, pi: i, x: 0, y: 0, type: 0, t: 0, dur: 1,
  }));
  private shocks = new Pool<Shock>(20, (i) => ({
    alive: false, pi: i, x: 0, y: 0, r: 0, vr: 0, t: 0, life: 1, color: "#fff", w: 3,
  }));
  private pickups = new Pool<Pickup>(4, (i) => ({
    alive: false, pi: i, x: 0, y: 0, t: 0, ttl: 0, vx: 0, vy: 0,
  }));

  // scheduled events (nova chains etc.)
  private events: { at: number; run: () => void }[] = [];

  // player
  private player = {
    alive: false,
    x: 0, y: 0, vx: 0, vy: 0,
    angle: -Math.PI / 2,
    fireT: 0,
    invuln: 0,
    dying: 0,
    respawnT: 0,
    wallSparkT: 0,
    thrustT: 0,
    trailX: new Float32Array(16),
    trailY: new Float32Array(16),
    trailHead: 0,
  };

  // run state
  private time = 0;
  private score = 0;
  private lives = 3;
  private kills = 0;
  private maxMult = 1;
  private streak = 0;
  private streakT = 0;
  private mult = 1;
  private overT = 0;

  // director
  private spawnT = 2;
  private surgeT = 34;
  private novaT = 17;

  // time warps
  private timeScale = 1;
  private timeScaleTarget = 1;
  private slowmoT = 0;
  private hitstopT = 0;

  // juice
  private trauma = 0;
  private flashA = 0;
  private flashColor = "#ffffff";
  private banner = { str: "", t: 0, life: 1 };
  private shakeScale = 1;

  // grid
  private gCols = 0;
  private gRows = 0;
  private gSpacing = 56;
  private gx = new Float32Array(0);
  private gy = new Float32Array(0);
  private gvx = new Float32Array(0);
  private gvy = new Float32Array(0);
  private grx = new Float32Array(0);
  private gry = new Float32Array(0);

  // input
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false, seen: false };
  private stickL = { id: -1, bx: 0, by: 0, x: 0, y: 0, vx: 0, vy: 0 };
  private stickR = { id: -1, bx: 0, by: 0, x: 0, y: 0, vx: 0, vy: 0 };

  // quality scaling (0 = full)
  private quality = 0;
  private fpsEma = 60;
  private qTimer = 0;
  private qGoodT = 0;
  private particleMul = 1;
  private ghosts = true;

  private ambientT = 1.2;

  private hudEmitT = 0;

  constructor(canvas: HTMLCanvasElement, cbs: EngineCallbacks) {
    this.canvas = canvas;
    this.cbs = cbs;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sprites = buildSprites();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.shakeScale = 0;
    }

    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("contextmenu", this.onContextMenu);

    this.ro = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.ro.observe(canvas.parentElement);
    this.resize();

    // prime attract mode
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.audio.suspend();
  }

  // ---------------------------------------------------------------- public

  start(): void {
    this.audio.ensure();
    this.audio.resume();
    this.audio.duck(false);
    this.resetRun();
    this.phase = "playing";
    this.cbs.onPhase("playing");
    this.emitHud(true);
    this.audio.startMusic();
  }

  restart(): void {
    this.start();
  }

  pause(): void {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.trauma = 0;
    this.audio.duck(true);
    this.cbs.onPhase("paused");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.audio.ensure();
    this.audio.resume();
    this.phase = "playing";
    this.lastT = performance.now();
    this.audio.duck(false);
    this.cbs.onPhase("playing");
  }

  togglePause(): void {
    if (this.phase === "playing") this.pause();
    else if (this.phase === "paused") this.resume();
  }

  quitToMenu(): void {
    this.phase = "menu";
    this.audio.stopMusic();
    this.audio.duck(false);
    this.player.alive = false;
    this.clearWorld();
    this.ambientT = 0.4;
    this.cbs.onPhase("menu");
  }

  setMuted(m: boolean): void {
    this.audio.setMuted(m);
  }

  uiBlip(): void {
    this.audio.ensure();
    this.audio.ui();
  }

  // ---------------------------------------------------------------- input

  private onContextMenu = (e: Event): void => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent): void => {
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
      e.code === "KeyW" ||
      e.code === "KeyA" ||
      e.code === "KeyS" ||
      e.code === "KeyD"
    ) {
      if (this.phase === "playing") e.preventDefault();
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouse.down = false;
    if (this.phase === "playing") this.pause();
  };

  private onVisibility = (): void => {
    if (document.hidden && this.phase === "playing") this.pause();
  };

  private pointerPos(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.audio.ensure();
    if (this.phase !== "playing") return;
    e.preventDefault();
    const [x, y] = this.pointerPos(e);
    if (e.pointerType === "mouse") {
      if (e.button === 0) this.mouse.down = true;
      this.mouse.x = x;
      this.mouse.y = y;
      this.mouse.seen = true;
      return;
    }
    // touch / pen → virtual sticks
    if (x < this.w / 2 && this.stickL.id === -1) {
      this.stickL.id = e.pointerId;
      this.stickL.bx = x; this.stickL.by = y;
      this.stickL.x = x; this.stickL.y = y;
      this.stickL.vx = 0; this.stickL.vy = 0;
    } else if (x >= this.w / 2 && this.stickR.id === -1) {
      this.stickR.id = e.pointerId;
      this.stickR.bx = x; this.stickR.by = y;
      this.stickR.x = x; this.stickR.y = y;
      this.stickR.vx = 0; this.stickR.vy = 0;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const [x, y] = this.pointerPos(e);
    if (e.pointerType === "mouse") {
      this.mouse.x = x;
      this.mouse.y = y;
      this.mouse.seen = true;
      return;
    }
    const R = 72;
    const updateStick = (s: typeof this.stickL): void => {
      s.x = x; s.y = y;
      let dx = x - s.bx;
      let dy = y - s.by;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      s.vx = dx / R;
      s.vy = dy / R;
    };
    if (this.stickL.id === e.pointerId) updateStick(this.stickL);
    if (this.stickR.id === e.pointerId) updateStick(this.stickR);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      if (e.button === 0) this.mouse.down = false;
      return;
    }
    if (this.stickL.id === e.pointerId) {
      this.stickL.id = -1;
      this.stickL.vx = 0; this.stickL.vy = 0;
    }
    if (this.stickR.id === e.pointerId) {
      this.stickR.id = -1;
      this.stickR.vx = 0; this.stickR.vy = 0;
    }
  };

  // ---------------------------------------------------------------- sizing

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.w = Math.max(320, rect.width);
    this.h = Math.max(320, rect.height);
    const maxDpr = this.quality >= 2 ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.buildBackground();
    this.buildGrid();
    // clamp entities
    const p = this.player;
    p.x = Math.min(Math.max(p.x, WALL_PAD), this.w - WALL_PAD);
    p.y = Math.min(Math.max(p.y, WALL_PAD), this.h - WALL_PAD);
  }

  private buildBackground(): void {
    const c = document.createElement("canvas");
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(this.dpr, this.dpr);
    const g = ctx.createRadialGradient(
      this.w / 2, this.h / 2, 0,
      this.w / 2, this.h / 2, Math.hypot(this.w, this.h) / 2
    );
    g.addColorStop(0, "#0a0f24");
    g.addColorStop(0.55, "#060a1a");
    g.addColorStop(1, "#02030a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // nebula blobs
    const blobs: [string, number][] = [
      ["#5f8cff", 0.05], ["#ff2d95", 0.04], ["#22d3ee", 0.045], ["#a78bff", 0.035],
    ];
    blobs.forEach(([color, alpha], i) => {
      const bx = this.w * (0.2 + 0.6 * ((i * 0.37 + 0.13) % 1));
      const by = this.h * (0.25 + 0.55 * ((i * 0.53 + 0.29) % 1));
      const br = Math.min(this.w, this.h) * (0.35 + 0.15 * (i % 2));
      const rg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      rg.addColorStop(0, this.hexA(color, alpha));
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    });

    // stars
    for (let i = 0; i < 130; i++) {
      const x = Math.random() * this.w;
      const y = Math.random() * this.h;
      const r = Math.random() < 0.85 ? 0.7 : 1.4;
      const a = 0.12 + Math.random() * 0.5;
      ctx.fillStyle = `rgba(190,220,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    this.bg = c;
  }

  private hexA(hex: string, a: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  private buildGrid(): void {
    this.gSpacing = Math.max(48, Math.min(72, this.w / 22));
    this.gCols = Math.ceil(this.w / this.gSpacing) + 1;
    this.gRows = Math.ceil(this.h / this.gSpacing) + 1;
    const n = this.gCols * this.gRows;
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.gvx = new Float32Array(n);
    this.gvy = new Float32Array(n);
    this.grx = new Float32Array(n);
    this.gry = new Float32Array(n);
    for (let r = 0; r < this.gRows; r++) {
      for (let c = 0; c < this.gCols; c++) {
        const i = r * this.gCols + c;
        this.grx[i] = c * this.gSpacing;
        this.gry[i] = r * this.gSpacing;
        this.gx[i] = this.grx[i];
        this.gy[i] = this.gry[i];
      }
    }
  }

  private gridImpulse(x: number, y: number, radius: number, strength: number): void {
    const r2 = radius * radius;
    const n = this.gx.length;
    for (let i = 0; i < n; i++) {
      const dx = this.gx[i] - x;
      const dy = this.gy[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (1 - d / radius) * strength;
        this.gvx[i] += (dx / d) * f;
        this.gvy[i] += (dy / d) * f;
      }
    }
  }

  // ---------------------------------------------------------------- run setup

  private clearWorld(): void {
    this.enemies.reset();
    this.bullets.reset();
    this.particles.reset();
    this.texts.reset();
    this.portals.reset();
    this.shocks.reset();
    this.pickups.reset();
    this.events.length = 0;
    this.banner.t = 0;
    this.trauma = 0;
    this.flashA = 0;
    this.hitstopT = 0;
    this.slowmoT = 0;
    this.timeScale = 1;
    this.timeScaleTarget = 1;
  }

  private resetRun(): void {
    this.clearWorld();
    const p = this.player;
    p.alive = true;
    p.x = this.w / 2;
    p.y = this.h / 2;
    p.vx = 0; p.vy = 0;
    p.angle = -Math.PI / 2;
    p.invuln = 2;
    p.dying = 0;
    p.respawnT = 0;
    for (let i = 0; i < p.trailX.length; i++) {
      p.trailX[i] = p.x;
      p.trailY[i] = p.y;
    }
    this.time = 0;
    this.score = 0;
    this.lives = 3;
    this.kills = 0;
    this.maxMult = 1;
    this.streak = 0;
    this.streakT = 0;
    this.mult = 1;
    this.spawnT = 2.1;
    this.surgeT = 34;
    this.novaT = 16;
    this.overT = 0;
    this.setBanner("GOOD HUNTING", 1.6);

    // welcoming committee
    const n = Math.min(this.w, this.h) > 540 ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.6;
      this.queuePortal(this.pxCl(p.x + Math.cos(a) * 340), this.pyCl(p.y + Math.sin(a) * 340), i % 3 === 2 ? 1 : 0, 0.3 + i * 0.12);
    }
    this.queuePortal(this.pxCl(p.x - 260), this.pyCl(p.y - 200), 1, 0.9);
  }

  private pxCl(x: number): number {
    return Math.min(Math.max(x, 40), this.w - 40);
  }
  private pyCl(y: number): number {
    return Math.min(Math.max(y, 40), this.h - 40);
  }

  private setBanner(str: string, life: number): void {
    this.banner.str = str;
    this.banner.t = 0;
    this.banner.life = life;
  }

  // ---------------------------------------------------------------- main loop

  private loop = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dtRaw = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dtRaw > 0.1) dtRaw = 0.1;
    if (dtRaw <= 0) dtRaw = 0.0001;
    this.wallT += dtRaw;

    // fps monitor / adaptive quality
    const fps = 1 / dtRaw;
    this.fpsEma += (fps - this.fpsEma) * 0.04;
    this.qTimer += dtRaw;
    if (this.qTimer > 1) {
      this.qTimer = 0;
      this.adaptQuality();
    }

    // time warp
    if (this.hitstopT > 0) {
      this.hitstopT -= dtRaw;
    } else {
      if (this.slowmoT > 0) {
        this.slowmoT -= dtRaw;
        this.timeScaleTarget = 0.22;
      } else {
        this.timeScaleTarget = 1;
      }
      this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dtRaw * 10);
    }

    if (this.phase === "playing") {
      const dt = this.hitstopT > 0 ? 0 : dtRaw * this.timeScale;
      this.update(dt);
    } else if (this.phase === "menu" || this.phase === "over") {
      this.ambientUpdate(dtRaw);
    }

    this.render(dtRaw);
  };

  private adaptQuality(): void {
    if (this.fpsEma < 52 && this.quality < 3) {
      this.quality++;
      this.applyQuality();
      this.qGoodT = 0;
    } else if (this.fpsEma > 58.5 && this.quality > 0) {
      this.qGoodT++;
      if (this.qGoodT >= 5) {
        this.quality--;
        this.applyQuality();
        this.qGoodT = 0;
      }
    } else {
      this.qGoodT = 0;
    }
  }

  private applyQuality(): void {
    this.particleMul = this.quality === 0 ? 1 : this.quality === 1 ? 0.65 : this.quality === 2 ? 0.45 : 0.3;
    this.ghosts = this.quality === 0;
    this.resize();
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.time += dt;
    this.hudEmitT -= dt;

    this.updatePlayer(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePortals(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateTexts(dt);
    this.updateShocks(dt);
    this.updateGrid(dt);
    this.runEvents();
    this.director(dt);
    this.collide();

    // combo decay
    if (this.streak > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) {
        this.streak = 0;
        if (this.mult !== 1) {
          this.mult = 1;
          this.emitHud(true);
        }
      }
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    this.flashA = Math.max(0, this.flashA - dt * 2.6);
    this.banner.t += dt;

    // game over sequencing
    if (this.lives <= 0 && !this.player.alive) {
      this.overT += dtRawSafe(dt);
      if (this.overT > 1.5) {
        this.finishGameOver();
      }
    }

    if (this.hudEmitT <= 0) this.emitHud(false);
  }

  private finishGameOver(): void {
    this.phase = "over";
    this.audio.stopMusic();
    this.ambientT = 2;
    this.cbs.onPhase("over");
    const stats: GameStats = { kills: this.kills, time: this.time, maxMult: this.maxMult };
    this.cbs.onGameOver(this.score, stats);
  }

  private emitHud(force: boolean): void {
    this.hudEmitT = 0.09;
    if (force) this.hudEmitT = 0.2;
    this.cbs.onHud({ score: this.score, mult: this.mult, lives: this.lives });
  }

  private runEvents(): void {
    if (this.events.length === 0) return;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].at <= this.time) {
        const ev = this.events[i];
        this.events.splice(i, 1);
        ev.run();
      }
    }
  }

  // ---------------- player

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (!p.alive) {
      if (this.lives > 0) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn();
      }
      return;
    }

    // movement
    let mx = 0;
    let my = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) my -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) my += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
    if (this.stickL.id !== -1) {
      const mag = Math.hypot(this.stickL.vx, this.stickL.vy);
      if (mag > 0.16) {
        mx = this.stickL.vx;
        my = this.stickL.vy;
      }
    }
    const mLen = Math.hypot(mx, my);
    if (mLen > 1) {
      mx /= mLen;
      my /= mLen;
    }
    const SPD = 335;
    const k = Math.min(1, 13 * dt);
    p.vx += (mx * SPD - p.vx) * k;
    p.vy += (my * SPD - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // walls
    p.wallSparkT -= dt;
    const r = 13;
    let hitWall = false;
    if (p.x < WALL_PAD + r) { p.x = WALL_PAD + r; p.vx = Math.abs(p.vx) * 0.4; hitWall = true; }
    if (p.x > this.w - WALL_PAD - r) { p.x = this.w - WALL_PAD - r; p.vx = -Math.abs(p.vx) * 0.4; hitWall = true; }
    if (p.y < WALL_PAD + r) { p.y = WALL_PAD + r; p.vy = Math.abs(p.vy) * 0.4; hitWall = true; }
    if (p.y > this.h - WALL_PAD - r) { p.y = this.h - WALL_PAD - r; p.vy = -Math.abs(p.vy) * 0.4; hitWall = true; }
    if (hitWall && p.wallSparkT <= 0 && Math.hypot(p.vx, p.vy) > 60) {
      p.wallSparkT = 0.18;
      this.burst(p.x, p.y, 6, 160, 0.3, 4, this.sprites.dot.cyan, false);
    }

    // aiming
    let firing = false;
    let aimX = Math.cos(p.angle);
    let aimY = Math.sin(p.angle);
    if (this.stickR.id !== -1 && Math.hypot(this.stickR.vx, this.stickR.vy) > 0.3) {
      const m = Math.hypot(this.stickR.vx, this.stickR.vy);
      aimX = this.stickR.vx / m;
      aimY = this.stickR.vy / m;
      firing = true;
    } else if (this.mouse.seen) {
      const dx = this.mouse.x - p.x;
      const dy = this.mouse.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        aimX = dx / d;
        aimY = dy / d;
      }
      firing = this.mouse.down || this.keys.has("Space");
    } else {
      firing = this.keys.has("Space");
    }

    const targetAngle = Math.atan2(aimY, aimX);
    let da = targetAngle - p.angle;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    p.angle += da * Math.min(1, 22 * dt);

    // firing
    p.fireT -= dt;
    if (firing && p.fireT <= 0) {
      p.fireT = 0.115;
      this.fireBullet(p);
    }

    // thruster
    const speed = Math.hypot(p.vx, p.vy);
    p.thrustT -= dt;
    if (speed > 60 && p.thrustT <= 0) {
      p.thrustT = 0.016;
      const bx = p.x - (p.vx / speed) * 12;
      const by = p.y - (p.vy / speed) * 12;
      const pt = this.particles.spawn();
      if (pt) {
        pt.x = bx; pt.y = by;
        pt.vx = -(p.vx / speed) * 130 + (Math.random() - 0.5) * 60;
        pt.vy = -(p.vy / speed) * 130 + (Math.random() - 0.5) * 60;
        pt.t = 0;
        pt.life = 0.3 + Math.random() * 0.15;
        pt.size = 5 + Math.random() * 4;
        pt.spr = Math.random() < 0.3 ? this.sprites.dot.white : this.sprites.dot.cyan;
        pt.stretch = false;
        pt.drag = 3.5;
        pt.a0 = 0.85;
      }
    }

    // trail ring buffer
    const head = (p.trailHead + 1) % p.trailX.length;
    p.trailHead = head;
    p.trailX[head] = p.x;
    p.trailY[head] = p.y;

    if (p.invuln > 0) p.invuln -= dt;

    // ship ripple on grid (always alive = subtle energy)
    if (speed > 50) {
      this.gridPushPoint(p.x, p.y, (speed / 335) * 26 * dt * 60 * 0.05);
    }
  }

  private gridPushPoint(x: number, y: number, strength: number): void {
    // single nearest point nudge — cheap constant energy
    const c = Math.round(x / this.gSpacing);
    const r = Math.round(y / this.gSpacing);
    if (c < 0 || r < 0 || c >= this.gCols || r >= this.gRows) return;
    const i = r * this.gCols + c;
    const dx = this.gx[i] - x;
    const dy = this.gy[i] - y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < this.gSpacing) {
      this.gvx[i] += (dx / d) * strength;
      this.gvy[i] += (dy / d) * strength;
    }
  }

  private fireBullet(p: typeof this.player): void {
    const b = this.bullets.spawn();
    if (!b) return;
    const spread = (Math.random() - 0.5) * 0.09;
    const ca = Math.cos(p.angle + spread);
    const sa = Math.sin(p.angle + spread);
    const nose = 16;
    b.x = p.x + ca * nose;
    b.y = p.y + sa * nose;
    b.px = b.x;
    b.py = b.y;
    b.vx = ca * 960 + p.vx * 0.3;
    b.vy = sa * 960 + p.vy * 0.3;
    b.life = 0.8;
    this.audio.shoot();
    // muzzle flash
    const pt = this.particles.spawn();
    if (pt) {
      pt.x = b.x; pt.y = b.y;
      pt.vx = ca * 60; pt.vy = sa * 60;
      pt.t = 0; pt.life = 0.09; pt.size = 13;
      pt.spr = this.sprites.dot.white;
      pt.stretch = false; pt.drag = 0; pt.a0 = 0.9;
    }
  }

  private respawn(): void {
    const p = this.player;
    p.alive = true;
    p.x = this.w / 2;
    p.y = this.h / 2;
    p.vx = 0; p.vy = 0;
    p.invuln = 2.6;
    for (let i = 0; i < p.trailX.length; i++) {
      p.trailX[i] = p.x;
      p.trailY[i] = p.y;
    }
    // mercy clear
    this.clearAround(p.x, p.y, 300);
    this.shock(p.x, p.y, PALETTE.cyan, 420, 0.5, 5);
    this.burst(p.x, p.y, 26, 320, 0.7, 6, this.sprites.dot.cyan, true);
    this.gridImpulse(p.x, p.y, 260, 320);
    this.audio.tierUp(3);
  }

  private playerDie(): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    p.alive = false;
    p.dying = 1;
    this.lives--;
    this.streak = 0;
    this.mult = 1;
    this.emitHud(true);

    this.hitstopT = 0.09;
    this.slowmoT = 0.85;
    this.trauma = 1;
    this.flashA = 0.55;
    this.flashColor = "#ff4d6d";
    this.shock(p.x, p.y, PALETTE.pink, 620, 0.7, 6);
    this.burst(p.x, p.y, 46, 460, 1, 8, this.sprites.dot.cyan, true);
    this.burst(p.x, p.y, 26, 300, 0.9, 7, this.sprites.dot.white, false);
    this.burst(p.x, p.y, 18, 240, 1.1, 6, this.sprites.dot.pink, true);
    this.gridImpulse(p.x, p.y, 420, 560);
    this.audio.hurt();

    if (this.lives > 0) {
      this.clearAround(p.x, p.y, 260);
      p.respawnT = 1.25;
    } else {
      this.overT = 0;
      // grand finale — chain detonate everything
      this.chainKillAll(0.4);
    }
  }

  private clearAround(x: number, y: number, radius: number): void {
    for (const e of this.enemies.items) {
      if (!e.alive || e.intro > 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy < radius * radius) this.killEnemy(e, false);
    }
    for (const po of this.portals.items) {
      if (!po.alive) continue;
      const dx = po.x - x;
      const dy = po.y - y;
      if (dx * dx + dy * dy < radius * radius) this.portals.kill(po);
    }
  }

  private chainKillAll(baseDelay: number): void {
    const alive = this.enemies.items
      .filter((e) => e.alive && e.intro <= 0)
      .sort((a, b) => {
        const pa = Math.hypot(a.x - this.player.x, a.y - this.player.y);
        const pb = Math.hypot(b.x - this.player.x, b.y - this.player.y);
        return pa - pb;
      });
    alive.forEach((e, i) => {
      this.events.push({ at: this.time + baseDelay + i * 0.03, run: () => this.killEnemy(e, false) });
    });
    for (const po of this.portals.items) if (po.alive) this.portals.kill(po);
  }

  // ---------------- bullets

  private updateBullets(dt: number): void {
    for (const b of this.bullets.items) {
      if (!b.alive) continue;
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (
        b.life <= 0 ||
        b.x < WALL_PAD || b.x > this.w - WALL_PAD ||
        b.y < WALL_PAD || b.y > this.h - WALL_PAD
      ) {
        if (b.life > 0) {
          this.burst(b.x, b.y, 3, 120, 0.22, 3.5, this.sprites.dot.cyan, false);
        }
        this.bullets.kill(b);
      }
    }
  }

  // ---------------- enemies

  private spawnEnemyFromType(type: number, x: number, y: number): void {
    const e = this.enemies.spawn();
    if (!e) return;
    const def = ENEMY_DEFS[type];
    const diff = 1 + Math.min(0.85, this.time / 210);
    e.type = type;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.rot = Math.random() * TAU;
    e.spin = type === 1 ? (Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.6) : 0;
    e.r = def.r;
    e.k = def.r / [16, 15, 15, 24][Math.min(type, 3)] || def.r / 16;
    e.hp = def.hp;
    e.age = 0;
    e.seed = Math.random() * 100;
    e.intro = 0.3;
    e.flash = 0;
    e.spd = def.spd * diff * (0.9 + Math.random() * 0.2);
    e.score = def.score;
    e.wakeT = Math.random() * 0.09;
    if (type === 1) {
      const a = Math.random() * TAU;
      e.vx = Math.cos(a) * e.spd;
      e.vy = Math.sin(a) * e.spd;
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    const items = this.enemies.items;

    for (const e of items) {
      if (!e.alive) continue;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.intro > 0) {
        e.intro -= dt;
        continue;
      }

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (e.type === 0 || e.type === 4) {
        // chaser
        const acc = e.type === 4 ? 900 : 620;
        e.vx += (dx / dist) * acc * dt;
        e.vy += (dy / dist) * acc * dt;
        const sp = Math.hypot(e.vx, e.vy) || 1;
        const max = e.spd;
        if (sp > max) {
          e.vx = (e.vx / sp) * max;
          e.vy = (e.vy / sp) * max;
        }
        e.rot = Math.atan2(e.vy, e.vx) + Math.PI / 2;
      } else if (e.type === 1) {
        // wanderer — bounce
        e.rot += e.spin * dt;
        if (e.x < WALL_PAD + e.r && e.vx < 0) e.vx = -e.vx;
        if (e.x > this.w - WALL_PAD - e.r && e.vx > 0) e.vx = -e.vx;
        if (e.y < WALL_PAD + e.r && e.vy < 0) e.vy = -e.vy;
        if (e.y > this.h - WALL_PAD - e.r && e.vy > 0) e.vy = -e.vy;
      } else if (e.type === 2) {
        // weaver — approach + sinusoidal strafe
        const px = -dy / dist;
        const py = dx / dist;
        const wob = Math.sin(e.age * 3.6 + e.seed) * 0.85;
        const ax = (dx / dist) * 480 + px * wob * 520;
        const ay = (dy / dist) * 480 + py * wob * 520;
        e.vx += ax * dt;
        e.vy += ay * dt;
        const sp = Math.hypot(e.vx, e.vy) || 1;
        if (sp > e.spd) {
          e.vx = (e.vx / sp) * e.spd;
          e.vy = (e.vy / sp) * e.spd;
        }
        e.rot = Math.atan2(e.vy, e.vx);
      } else {
        // splitter — slow menace
        e.vx += (dx / dist) * 240 * dt;
        e.vy += (dy / dist) * 240 * dt;
        const sp = Math.hypot(e.vx, e.vy) || 1;
        if (sp > e.spd) {
          e.vx = (e.vx / sp) * e.spd;
          e.vy = (e.vy / sp) * e.spd;
        }
        e.rot += 0.5 * dt;
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.x = Math.min(Math.max(e.x, WALL_PAD + e.r * 0.5), this.w - WALL_PAD - e.r * 0.5);
      e.y = Math.min(Math.max(e.y, WALL_PAD + e.r * 0.5), this.h - WALL_PAD - e.r * 0.5);

      // ghost wake
      if (this.ghosts) {
        e.wakeT -= dt;
        if (e.wakeT <= 0 && Math.hypot(e.vx, e.vy) > 40) {
          e.wakeT = 0.1;
          const g = this.particles.spawn();
          if (g) {
            g.x = e.x; g.y = e.y;
            g.vx = 0; g.vy = 0;
            g.t = 0; g.life = 0.3;
            g.size = this.sprites.enemyBox[Math.min(e.type, 3)] * e.k;
            g.spr = this.sprites.enemy[Math.min(e.type, 3)][0];
            g.stretch = false; g.drag = 0; g.a0 = 0.16;
          }
        }
      }
    }

    // separation (chasers & smalls only)
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!a.alive || a.intro > 0 || (a.type !== 0 && a.type !== 4)) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (!b.alive || b.intro > 0 || (b.type !== 0 && b.type !== 4)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((rr - d) / rr) * 130 * dt;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  private killEnemy(e: Enemy, awardScore: boolean): void {
    if (!e.alive) return;
    this.enemies.kill(e);

    const colorKeys = ["pink", "green", "blue", "amber", "pink"] as const;
    const ck = colorKeys[Math.min(e.type, 4)];
    const dot = this.sprites.dot[ck];
    const big = e.type === 3;

    this.burst(e.x, e.y, Math.round((10 + e.r * 0.9) * this.particleMul), 120 + e.r * 14, 0.55 + e.r * 0.014, 6.2, dot, true);
    this.burst(e.x, e.y, Math.round(6 * this.particleMul), 200 + e.r * 8, 0.4, 5, this.sprites.dot.white, false);
    if (big) {
      this.shock(e.x, e.y, PALETTE.amber, 380, 0.45, 4);
      // split into small chasers
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.random();
        this.events.push({
          at: this.time,
          run: () => {
            this.spawnEnemyFromType(4, this.pxCl(e.x + Math.cos(a) * 14), this.pyCl(e.y + Math.sin(a) * 14));
          },
        });
      }
    }
    this.gridImpulse(e.x, e.y, 90 + e.r * 7, 120 + e.r * 12);
    this.trauma = Math.min(1, this.trauma + e.r / 800);
    this.audio.explode(e.r / 30);

    if (awardScore) {
      this.kills++;
      const gained = e.score * this.mult;
      this.score += gained;
      this.floatText(e.x, e.y, `+${gained}`, ck === "amber" ? PALETTE.amber : "#cfe9ff", big ? 17 : 13);
      this.streak++;
      this.streakT = 2.8;
      const newMult = Math.min(10, 1 + Math.floor(this.streak / 6));
      if (newMult > this.mult) {
        this.mult = newMult;
        this.maxMult = Math.max(this.maxMult, newMult);
        this.floatText(this.player.x, this.player.y - 34, `x${newMult}`, PALETTE.cyan, 22);
        this.shock(this.player.x, this.player.y, PALETTE.cyan, 200, 0.35, 3);
        this.audio.tierUp(newMult);
        this.emitHud(true);
      }
    }
  }

  // ---------------- portals

  private queuePortal(x: number, y: number, type: number, delay: number): void {
    this.events.push({
      at: this.time + delay,
      run: () => {
        const po = this.portals.spawn();
        if (!po) return;
        po.x = x; po.y = y; po.type = type; po.t = 0;
        po.dur = type === 3 ? 0.9 : 0.65;
      },
    });
  }

  private updatePortals(dt: number): void {
    for (const po of this.portals.items) {
      if (!po.alive) continue;
      po.t += dt;
      // inward swirl particles
      if (Math.random() < dt * 26 && this.particleMul > 0.4) {
        const a = Math.random() * TAU;
        const rr = 34;
        const pt = this.particles.spawn();
        if (pt) {
          pt.x = po.x + Math.cos(a) * rr;
          pt.y = po.y + Math.sin(a) * rr;
          pt.vx = -Math.cos(a) * 130;
          pt.vy = -Math.sin(a) * 130;
          pt.t = 0; pt.life = 0.26; pt.size = 5;
          pt.spr = this.sprites.dot[colorForType(po.type)];
          pt.stretch = false; pt.drag = 0; pt.a0 = 0.7;
        }
      }
      if (po.t >= po.dur) {
        this.portals.kill(po);
        this.spawnEnemyFromType(po.type, po.x, po.y);
        const pt = this.particles.spawn();
        if (pt) {
          pt.x = po.x; pt.y = po.y;
          pt.vx = 0; pt.vy = 0;
          pt.t = 0; pt.life = 0.16; pt.size = 26;
          pt.spr = this.sprites.dot[colorForType(po.type)];
          pt.stretch = false; pt.drag = 0; pt.a0 = 0.9;
        }
      }
    }
  }

  // ---------------- pickups (nova)

  private updatePickups(dt: number): void {
    const p = this.player;
    for (const pk of this.pickups.items) {
      if (!pk.alive) continue;
      pk.t += dt;
      pk.ttl -= dt;
      // drift + magnet
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 150 && p.alive) {
        pk.vx += (dx / d) * 900 * dt;
        pk.vy += (dy / d) * 900 * dt;
      } else {
        pk.vx *= Math.exp(-0.8 * dt);
        pk.vy *= Math.exp(-0.8 * dt);
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.x = Math.min(Math.max(pk.x, WALL_PAD + 16), this.w - WALL_PAD - 16);
      pk.y = Math.min(Math.max(pk.y, WALL_PAD + 16), this.h - WALL_PAD - 16);

      if (pk.ttl <= 0) {
        this.burst(pk.x, pk.y, 10, 140, 0.4, 5, this.sprites.dot.gold, false);
        this.pickups.kill(pk);
        continue;
      }
      if (p.alive && d < 30) {
        this.pickups.kill(pk);
        this.nova(pk.x, pk.y);
      }
    }
  }

  private nova(x: number, y: number): void {
    this.flashA = 0.75;
    this.flashColor = "#fff3c4";
    this.hitstopT = 0.05;
    this.slowmoT = 0.7;
    this.trauma = 1;
    this.shock(x, y, PALETTE.gold, 900, 0.8, 7);
    this.shock(x, y, "#ffffff", 640, 0.6, 4);
    this.burst(x, y, Math.round(50 * this.particleMul), 700, 1.1, 7, this.sprites.dot.gold, true);
    this.burst(x, y, Math.round(24 * this.particleMul), 460, 0.9, 6, this.sprites.dot.white, false);
    this.gridImpulse(x, y, 560, 900);
    this.audio.nova();
    this.floatText(x, y - 26, "NOVA!", PALETTE.gold, 26);
    this.audio.pickup();

    const alive = this.enemies.items
      .filter((e) => e.alive && e.intro <= 0)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    alive.forEach((e, i) => {
      this.events.push({ at: this.time + 0.12 + i * 0.026, run: () => this.killEnemy(e, true) });
    });
    for (const po of this.portals.items) if (po.alive) this.portals.kill(po);
  }

  // ---------------- fx helpers

  private burst(
    x: number, y: number, count: number, speed: number, life: number,
    size: number, spr: HTMLCanvasElement, stretch: boolean
  ): void {
    for (let i = 0; i < count; i++) {
      const pt = this.particles.spawn();
      if (!pt) return;
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.95);
      pt.x = x;
      pt.y = y;
      pt.vx = Math.cos(a) * s;
      pt.vy = Math.sin(a) * s;
      pt.t = 0;
      pt.life = life * (0.6 + Math.random() * 0.7);
      pt.size = size * (0.6 + Math.random() * 0.9);
      pt.spr = spr;
      pt.stretch = stretch;
      pt.drag = 2.6 + Math.random() * 1.6;
      pt.a0 = 0.95;
    }
  }

  private shock(x: number, y: number, color: string, vr: number, life: number, w: number): void {
    const s = this.shocks.spawn();
    if (!s) return;
    s.x = x; s.y = y;
    s.r = 6; s.vr = vr;
    s.t = 0; s.life = life;
    s.color = color; s.w = w;
  }

  private floatText(x: number, y: number, str: string, color: string, size: number): void {
    const t = this.texts.spawn();
    if (!t) return;
    t.x = x + (Math.random() - 0.5) * 10;
    t.y = y;
    t.vy = -66;
    t.t = 0;
    t.life = 0.8;
    t.str = str;
    t.color = color;
    t.size = size;
  }

  private updateParticles(dt: number): void {
    for (const pt of this.particles.items) {
      if (!pt.alive) continue;
      pt.t += dt;
      if (pt.t >= pt.life) {
        this.particles.kill(pt);
        continue;
      }
      if (pt.drag > 0) {
        const d = Math.exp(-pt.drag * dt);
        pt.vx *= d;
        pt.vy *= d;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
  }

  private updateTexts(dt: number): void {
    for (const t of this.texts.items) {
      if (!t.alive) continue;
      t.t += dt;
      if (t.t >= t.life) {
        this.texts.kill(t);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.4 * dt);
    }
  }

  private updateShocks(dt: number): void {
    for (const s of this.shocks.items) {
      if (!s.alive) continue;
      s.t += dt;
      if (s.t >= s.life) {
        this.shocks.kill(s);
        continue;
      }
      s.r += s.vr * dt;
      s.vr *= Math.exp(-2.2 * dt);
    }
  }

  private updateGrid(dt: number): void {
    const n = this.gx.length;
    const damp = Math.exp(-5.2 * dt);
    const k = 120;
    for (let i = 0; i < n; i++) {
      this.gvx[i] += (this.grx[i] - this.gx[i]) * k * dt;
      this.gvy[i] += (this.gry[i] - this.gy[i]) * k * dt;
      this.gvx[i] *= damp;
      this.gvy[i] *= damp;
      this.gx[i] += this.gvx[i] * dt;
      this.gy[i] += this.gvy[i] * dt;
    }
  }

  // ---------------- director

  private director(dt: number): void {
    if (this.lives <= 0) return;
    const t = this.time;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const interval = Math.max(0.55, 2.05 - t * 0.011);
      this.spawnT = interval * (0.75 + Math.random() * 0.5);
      const aliveCount = this.enemies.items.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
      const maxAlive = Math.min(this.quality >= 3 ? 62 : 92, 20 + Math.floor(t / 4.2));
      if (aliveCount < maxAlive) {
        const batch = 1 + Math.floor(Math.random() * Math.min(5, 1 + t / 40));
        for (let i = 0; i < batch; i++) {
          this.spawnOneDirected(t);
        }
      }
    }

    this.surgeT -= dt;
    if (this.surgeT <= 0) {
      this.surgeT = 34 + Math.random() * 8;
      this.surge();
    }

    this.novaT -= dt;
    if (this.novaT <= 0) {
      this.novaT = 26 + Math.random() * 14;
      const pk = this.pickups.spawn();
      if (pk) {
        const p = this.player;
        let x = 0, y = 0, tries = 0;
        do {
          x = 60 + Math.random() * (this.w - 120);
          y = 60 + Math.random() * (this.h - 120);
          tries++;
        } while (Math.hypot(x - p.x, y - p.y) < 200 && tries < 12);
        pk.x = x; pk.y = y;
        pk.t = 0; pk.ttl = 9;
        const a = Math.random() * TAU;
        pk.vx = Math.cos(a) * 40;
        pk.vy = Math.sin(a) * 40;
        this.floatText(x, y - 22, "NOVA ONLINE", PALETTE.gold, 12);
      }
    }
  }

  private spawnOneDirected(t: number): void {
    // unlock schedule
    let type = 0;
    const roll = Math.random();
    if (t > 50 && roll < 0.12) type = 3;
    else if (t > 26 && roll < 0.32) type = 2;
    else if (t > 8 && roll < 0.55) type = 1;
    else type = 0;

    const p = this.player;
    let x = this.w / 2, y = this.h / 2;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      const rad = 300 + Math.random() * 340;
      x = this.pxCl(p.x + Math.cos(a) * rad);
      y = this.pyCl(p.y + Math.sin(a) * rad);
      if (Math.hypot(x - p.x, y - p.y) >= 250) break;
    }
    this.queuePortal(x, y, type, Math.random() * 0.3);
  }

  private surge(): void {
    const p = this.player;
    const radius = Math.min(430, Math.min(this.w, this.h) * 0.44);
    const count = Math.min(14, 8 + Math.floor(this.time / 30));
    const t = this.time;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.random() * 0.3;
      const x = this.pxCl(p.x + Math.cos(a) * radius);
      const y = this.pyCl(p.y + Math.sin(a) * radius);
      let type = 0;
      if (t > 26 && i % 4 === 3) type = 2;
      else if (i % 3 === 1) type = 1;
      this.queuePortal(x, y, type, i * 0.05);
    }
    this.setBanner("!! SURGE !!", 1.4);
    this.audio.surge();
    this.trauma = Math.min(1, this.trauma + 0.25);
  }

  // ---------------- collisions

  private collide(): void {
    const p = this.player;
    // bullets × enemies
    for (const b of this.bullets.items) {
      if (!b.alive) continue;
      for (const e of this.enemies.items) {
        if (!e.alive || e.intro > 0) continue;
        const rr = e.r + 7;
        if (segDist2(b.px, b.py, b.x, b.y, e.x, e.y) < rr * rr) {
          this.bullets.kill(b);
          e.hp--;
          e.flash = 0.07;
          // knockback
          const kb = 60 / Math.max(1, e.r / 12);
          const bv = Math.hypot(b.vx, b.vy) || 1;
          e.vx += (b.vx / bv) * kb;
          e.vy += (b.vy / bv) * kb;
          this.burst(
            b.x - (b.vx / bv) * e.r * 0.6, b.y - (b.vy / bv) * e.r * 0.6,
            Math.round(4 * this.particleMul), 220, 0.3, 4.5,
            this.sprites.dot[colorForType(e.type)], true
          );
          this.audio.hit();
          if (e.hp <= 0) {
            this.killEnemy(e, true);
          }
          break;
        }
      }
    }

    // enemies × player
    if (p.alive) {
      for (const e of this.enemies.items) {
        if (!e.alive || e.intro > 0) continue;
        const rr = e.r * 0.82 + 12;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy < rr * rr) {
          this.playerDie();
          break;
        }
      }
    }
  }

  // ---------------- ambient (menu / gameover backdrop)

  private ambientUpdate(dt: number): void {
    this.updateParticles(dt);
    this.updateTexts(dt);
    this.updateShocks(dt);
    this.updateGrid(dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.flashA = Math.max(0, this.flashA - dt * 2.6);
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 1.4 + Math.random() * 2.4;
      const x = 60 + Math.random() * (this.w - 120);
      const y = 60 + Math.random() * (this.h - 120);
      const keys = ["cyan", "pink", "purple", "blue"] as const;
      const ck = keys[Math.floor(Math.random() * keys.length)];
      this.burst(x, y, 16, 260, 0.8, 6, this.sprites.dot[ck], true);
      this.shock(x, y, PALETTE[ck], 240, 0.5, 3);
      this.gridImpulse(x, y, 200, 240);
    }
  }

  // ---------------------------------------------------------------- render

  private render(dtRaw: number): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.bg) ctx.drawImage(this.bg, 0, 0, w, h);
    else {
      ctx.fillStyle = "#04050c";
      ctx.fillRect(0, 0, w, h);
    }

    // camera shake
    const tr = this.trauma * this.trauma * this.shakeScale;
    const ox = (Math.random() * 2 - 1) * 22 * tr;
    const oy = (Math.random() * 2 - 1) * 22 * tr;
    const orot = (Math.random() * 2 - 1) * 0.02 * tr;

    ctx.save();
    ctx.translate(w / 2 + ox, h / 2 + oy);
    ctx.rotate(orot);
    ctx.translate(-w / 2, -h / 2);

    this.renderGrid(ctx);
    this.renderWalls(ctx);
    this.renderShocks(ctx);
    this.renderPortals(ctx);
    this.renderPickups(ctx);
    this.renderEnemies(ctx);
    this.renderBullets(ctx);
    this.renderPlayer(ctx);
    this.renderParticles(ctx);
    this.renderTexts(ctx);
    this.renderBanner(ctx);

    ctx.restore();

    // full-screen flash
    if (this.flashA > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.8, this.flashA);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    if (this.phase === "playing") {
      this.renderSticks(ctx);
      this.renderReticle(ctx);
    }
    void dtRaw;
  }

  private renderGrid(ctx: CanvasRenderingContext2D): void {
    const cols = this.gCols;
    const rows = this.gRows;
    if (cols === 0) return;
    ctx.lineWidth = 1;

    // minor
    if (this.quality < 2) {
      ctx.strokeStyle = "rgba(88,120,255,0.09)";
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const base = r * cols;
        ctx.moveTo(this.gx[base], this.gy[base]);
        for (let c = 1; c < cols; c++) ctx.lineTo(this.gx[base + c], this.gy[base + c]);
      }
      for (let c = 0; c < cols; c++) {
        ctx.moveTo(this.gx[c], this.gy[c]);
        for (let r = 1; r < rows; r++) ctx.lineTo(this.gx[r * cols + c], this.gy[r * cols + c]);
      }
      ctx.stroke();
    }

    // major (every 4th)
    ctx.strokeStyle = "rgba(110,150,255,0.16)";
    ctx.beginPath();
    for (let r = 0; r < rows; r += 4) {
      const base = r * cols;
      ctx.moveTo(this.gx[base], this.gy[base]);
      for (let c = 1; c < cols; c++) ctx.lineTo(this.gx[base + c], this.gy[base + c]);
    }
    for (let c = 0; c < cols; c += 4) {
      ctx.moveTo(this.gx[c], this.gy[c]);
      for (let r = 1; r < rows; r++) ctx.lineTo(this.gx[r * cols + c], this.gy[r * cols + c]);
    }
    ctx.stroke();
  }

  private renderWalls(ctx: CanvasRenderingContext2D): void {
    const pulse = 0.22 + 0.07 * Math.sin(this.wallT * 2.4);
    ctx.strokeStyle = `rgba(34,211,238,${pulse})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL_PAD, WALL_PAD, this.w - WALL_PAD * 2, this.h - WALL_PAD * 2);
    // corner accents
    ctx.strokeStyle = "rgba(120,240,255,0.6)";
    ctx.lineWidth = 2.6;
    const L = 22;
    const x0 = WALL_PAD, y0 = WALL_PAD, x1 = this.w - WALL_PAD, y1 = this.h - WALL_PAD;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
    ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
    ctx.stroke();
  }

  private renderEnemies(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.enemies.items) {
      if (!e.alive) continue;
      const type = Math.min(e.type, 3);
      const box = this.sprites.enemyBox[type] * e.k;
      let scale = 1 + 0.05 * Math.sin(e.age * 4 + e.seed);
      if (e.intro > 0) {
        const it = 1 - e.intro / 0.3;
        scale *= easeOutBack(it);
      }
      const spr = e.flash > 0 ? this.sprites.enemy[type][1] : this.sprites.enemy[type][0];
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot);
      const s = box * scale;
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private renderBullets(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    const bw = this.sprites.bulletW * 1.35;
    const bh = this.sprites.bulletH * 1.35;
    for (const b of this.bullets.items) {
      if (!b.alive) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.drawImage(this.sprites.bullet, -bw / 2, -bh / 2, bw, bh);
      ctx.restore();
      // faint trail slice
      ctx.globalAlpha = 0.4;
      ctx.save();
      ctx.translate((b.x + b.px) / 2, (b.y + b.py) / 2);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.drawImage(this.sprites.bullet, -bw / 2, -bh / 2, bw * 0.9, bh * 0.9);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    if (!p.alive) return;
    const ctxOp: GlobalCompositeOperation = "lighter";
    ctx.globalCompositeOperation = ctxOp;

    // trail
    const speed = Math.hypot(p.vx, p.vy);
    const speedK = Math.min(1, speed / 300);
    const n = p.trailX.length;
    for (let i = 1; i < n; i++) {
      const idx = (p.trailHead - i + n * 2) % n;
      const a = (1 - i / n) * 0.3 * speedK;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      const s = 9 * (1 - i / n) + 3;
      ctx.drawImage(this.sprites.dot.cyan, p.trailX[idx] - s / 2, p.trailY[idx] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // blink during invulnerability
    let alpha = 1;
    if (p.invuln > 0) alpha = Math.floor(this.wallT * 14) % 2 === 0 ? 1 : 0.3;
    ctx.globalAlpha = alpha;

    const box = this.sprites.shipBox * 0.82;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    // engine flame
    if (speedK > 0.1) {
      const fl = 14 * speedK * (0.8 + 0.4 * Math.sin(this.wallT * 40));
      ctx.drawImage(this.sprites.dot.cyan, -16 - fl / 2, -fl / 4, fl * 1.1, fl / 2);
    }
    ctx.drawImage(this.sprites.ship, -box / 2, -box / 2, box, box);
    ctx.restore();
    ctx.globalAlpha = 1;

    // invuln shield
    if (p.invuln > 0) {
      ctx.strokeStyle = "rgba(34,211,238,0.65)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -this.wallT * 40;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (const pt of this.particles.items) {
      if (!pt.alive) continue;
      const lt = pt.t / pt.life;
      const alpha = pt.a0 * (lt < 0.15 ? lt / 0.15 : 1 - (lt - 0.15) / 0.85);
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      const size = pt.size * (1 - lt * 0.65);
      if (pt.stretch) {
        const sp = Math.hypot(pt.vx, pt.vy);
        if (sp > 30) {
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate(Math.atan2(pt.vy, pt.vx));
          const len = size + Math.min(size * 2.2, sp * 0.022);
          ctx.drawImage(pt.spr, -len / 2, -size / 2.4, len, size / 1.2);
          ctx.restore();
          continue;
        }
      }
      ctx.drawImage(pt.spr, pt.x - size / 2, pt.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private renderTexts(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of this.texts.items) {
      if (!t.alive) continue;
      const lt = t.t / t.life;
      const alpha = 1 - lt * lt;
      const scale = lt < 0.18 ? easeOutBack(lt / 0.18) : 1;
      ctx.globalAlpha = alpha;
      ctx.font = `700 ${Math.round(t.size * scale)}px Orbitron, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private renderShocks(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.shocks.items) {
      if (!s.alive) continue;
      const lt = s.t / s.life;
      ctx.globalAlpha = (1 - lt) * 0.8;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.w * (1 - lt) + 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private renderPortals(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (const po of this.portals.items) {
      if (!po.alive) continue;
      const lt = po.t / po.dur;
      const color = PALETTE_KEY_FOR_TYPE[Math.min(po.type, 3)];
      const hex = PALETTE[color];
      const rr = 30 * (1 - lt) + 8;
      ctx.globalAlpha = 0.35 + lt * 0.6;
      ctx.strokeStyle = hex;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(po.x, po.y, rr, 0, TAU);
      ctx.stroke();
      // rotating arcs
      for (let i = 0; i < 3; i++) {
        const a0 = this.wallT * 5 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(po.x, po.y, rr * 0.6, a0, a0 + 1.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private renderPickups(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = "lighter";
    for (const pk of this.pickups.items) {
      if (!pk.alive) continue;
      const blink = pk.ttl < 2.5 ? (Math.floor(this.wallT * 8) % 2 === 0 ? 1 : 0.35) : 1;
      const pulse = 1 + 0.12 * Math.sin(pk.t * 6);
      const box = this.sprites.novaBox * 0.8 * pulse;
      ctx.globalAlpha = blink;
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.rotate(pk.t * 1.4);
      ctx.drawImage(this.sprites.nova, -box / 2, -box / 2, box, box);
      ctx.restore();
      // orbit ring
      ctx.strokeStyle = "rgba(255,210,77,0.4)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 9]);
      ctx.lineDashOffset = pk.t * 26;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, 26 + 4 * Math.sin(pk.t * 3), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private renderBanner(ctx: CanvasRenderingContext2D): void {
    if (this.banner.t >= this.banner.life || !this.banner.str) return;
    const lt = this.banner.t / this.banner.life;
    const alpha = lt < 0.15 ? lt / 0.15 : 1 - Math.max(0, (lt - 0.6) / 0.4);
    const scale = lt < 0.18 ? easeOutBack(lt / 0.18) : 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    try {
      (ctx as unknown as { letterSpacing: string }).letterSpacing = "10px";
    } catch {
      /* unsupported */
    }
    ctx.font = `800 ${Math.round(30 * scale)}px Orbitron, sans-serif`;
    ctx.fillStyle = "#eafcff";
    ctx.shadowColor = "rgba(34,211,238,0.9)";
    ctx.shadowBlur = 24;
    ctx.fillText(this.banner.str, this.w / 2, this.h * 0.3);
    ctx.restore();
  }

  private renderSticks(ctx: CanvasRenderingContext2D): void {
    const draw = (s: typeof this.stickL, color: string, label: string): void => {
      if (s.id === -1) return;
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.bx, s.by, 52, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.bx + s.vx * 52, s.by + s.vy * 52, 20, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.font = "600 10px Rajdhani, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      ctx.fillText(label, s.bx, s.by - 64);
      ctx.globalAlpha = 1;
    };
    draw(this.stickL, PALETTE.cyan, "MOVE");
    draw(this.stickR, PALETTE.pink, "FIRE");
  }

  private renderReticle(ctx: CanvasRenderingContext2D): void {
    if (!this.mouse.seen || this.stickR.id !== -1) return;
    if (this.stickL.id !== -1) return; // touch mode active
    const x = this.mouse.x;
    const y = this.mouse.y;
    if (x < 0 || y < 0 || x > this.w || y > this.h) return;
    const firing = this.mouse.down || this.keys.has("Space");
    const rr = firing ? 12 : 9;
    const rot = this.wallT * 2.2;
    ctx.strokeStyle = firing ? "rgba(255,45,149,0.95)" : "rgba(255,45,149,0.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a0 = rot + (i / 4) * TAU;
      ctx.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr);
      ctx.arc(x, y, rr, a0, a0 + TAU / 8);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,120,190,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- helpers

const PALETTE_KEY_FOR_TYPE = ["pink", "green", "blue", "amber"] as const;

function colorForType(type: number): keyof typeof PALETTE {
  return PALETTE_KEY_FOR_TYPE[Math.min(type, 3)];
}

function dtRawSafe(dt: number): number {
  return dt > 0 ? dt : 0.0001;
}

function segDist2(
  x1: number, y1: number, x2: number, y2: number,
  px: number, py: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0.0001) {
    t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return ddx * ddx + ddy * ddy;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.max(0, Math.min(1, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
