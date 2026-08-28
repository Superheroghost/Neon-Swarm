/**
 * Sprite baker — all neon glow is pre-rendered ONCE into offscreen canvases
 * (shadowBlur at bake time only). The hot loop is pure drawImage + rotate,
 * which keeps everything at 60fps even on mobile GPUs.
 */

export const PALETTE = {
  cyan: "#22d3ee",
  pink: "#ff2d95",
  green: "#3dffa0",
  amber: "#ffb020",
  blue: "#5f8cff",
  purple: "#a78bff",
  white: "#ffffff",
  gold: "#ffd24d",
} as const;

export interface Sprites {
  ship: HTMLCanvasElement;
  shipBox: number;
  bullet: HTMLCanvasElement;
  bulletW: number;
  bulletH: number;
  /** [type][0]=color [type][1]=white flash */
  enemy: HTMLCanvasElement[][];
  enemyBox: number[];
  /** soft glow dots per palette key */
  dot: Record<string, HTMLCanvasElement>;
  dotBox: number;
  nova: HTMLCanvasElement;
  novaBox: number;
}

const BAKE = 2; // supersample for retina crispness

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * BAKE);
  c.height = Math.ceil(h * BAKE);
  const ctx = c.getContext("2d")!;
  ctx.scale(BAKE, BAKE);
  return [c, ctx];
}

function neonStroke(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  color: string,
  width: number,
  glow: number
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  path();
  ctx.stroke();
  ctx.stroke(); // second pass intensifies bloom
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(0.8, width * 0.38);
  path();
  ctx.stroke();
  ctx.restore();
}

function glowDot(color: string, box: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(box, box);
  const r = box / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.22, color);
  g.addColorStop(0.55, colorWithAlpha(color, 0.28));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, box, box);
  return c;
}

function colorWithAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const ENEMY_RADII = [16, 15, 15, 24]; // chaser, wanderer, weaver, splitter
export const ENEMY_COLORS = [PALETTE.pink, PALETTE.green, PALETTE.blue, PALETTE.amber];

function enemyShape(type: number, r: number): (ctx: CanvasRenderingContext2D) => void {
  return (ctx) => {
    ctx.beginPath();
    if (type === 0) {
      // diamond chaser
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.78, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.78, 0);
      ctx.closePath();
    } else if (type === 1) {
      // square wanderer
      const s = r * 0.82;
      ctx.moveTo(-s, -s);
      ctx.lineTo(s, -s);
      ctx.lineTo(s, s);
      ctx.lineTo(-s, s);
      ctx.closePath();
    } else if (type === 2) {
      // dart weaver
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(-r * 0.7, r * 0.72);
      ctx.lineTo(-r * 0.32, 0);
      ctx.lineTo(-r * 0.7, -r * 0.72);
      ctx.closePath();
    } else {
      // hex splitter
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  };
}

function bakeEnemy(type: number, color: string): [HTMLCanvasElement, number] {
  const r = ENEMY_RADII[type];
  const pad = 20;
  const box = (r + pad) * 2;
  const [c, ctx] = makeCanvas(box, box);
  ctx.translate(box / 2, box / 2);
  const path = () => enemyShape(type, r)(ctx);
  ctx.fillStyle = colorWithAlpha(color === PALETTE.white ? "#ffffff" : color, 0.07);
  path();
  ctx.fill();
  neonStroke(ctx, path, color, 2.6, 15);
  // inner detail
  ctx.save();
  ctx.globalAlpha = 0.5;
  const inner = () => {
    ctx.beginPath();
    if (type === 1) {
      const s = r * 0.38;
      ctx.moveTo(-s, 0);
      ctx.lineTo(s, 0);
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
    } else if (type === 3) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * r * 0.5;
        const y = Math.sin(a) * r * 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    }
  };
  neonStroke(ctx, inner, color === PALETTE.white ? "#ffffff" : "#eaf6ff", 1.4, 6);
  ctx.restore();
  return [c, box];
}

function bakeShip(): [HTMLCanvasElement, number] {
  const r = 14;
  const pad = 26;
  const box = (r + pad) * 2;
  const [c, ctx] = makeCanvas(box, box);
  ctx.translate(box / 2, box / 2);

  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(r * 1.35, 0);
    ctx.lineTo(-r * 0.75, r * 0.95);
    ctx.lineTo(-r * 0.3, 0);
    ctx.lineTo(-r * 0.75, -r * 0.95);
    ctx.closePath();
  };

  // chromatic ghost passes
  ctx.save();
  ctx.translate(-1.4, 1);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PALETTE.pink;
  ctx.lineWidth = 2;
  ctx.shadowColor = PALETTE.pink;
  ctx.shadowBlur = 10;
  hull();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(34,211,238,0.10)";
  hull();
  ctx.fill();
  neonStroke(ctx, hull, PALETTE.cyan, 2.6, 16);

  // cockpit core
  const core = () => {
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0);
    ctx.lineTo(-r * 0.1, r * 0.3);
    ctx.lineTo(-r * 0.1, -r * 0.3);
    ctx.closePath();
  };
  neonStroke(ctx, core, "#eafcff", 1.6, 8);
  return [c, box];
}

function bakeBullet(): [HTMLCanvasElement, number, number] {
  const w = 30;
  const h = 14;
  const [c, ctx] = makeCanvas(w, h);
  ctx.translate(w / 2, h / 2);
  ctx.lineCap = "round";
  ctx.shadowColor = PALETTE.cyan;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = PALETTE.cyan;
  ctx.lineWidth = 4.4;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();
  return [c, w, h];
}

function bakeNova(): [HTMLCanvasElement, number] {
  const r = 15;
  const pad = 26;
  const box = (r + pad) * 2;
  const [c, ctx] = makeCanvas(box, box);
  ctx.translate(box / 2, box / 2);
  const star = (rad: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? rad : rad * 0.32;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = "rgba(255,210,77,0.18)";
  star(r);
  ctx.fill();
  neonStroke(ctx, () => star(r), PALETTE.gold, 2.4, 18);
  neonStroke(ctx, () => star(r * 0.42), "#fff6d8", 1.4, 6);
  return [c, box];
}

export function buildSprites(): Sprites {
  const dot: Record<string, HTMLCanvasElement> = {};
  for (const key of Object.keys(PALETTE)) {
    dot[key] = glowDot(PALETTE[key as keyof typeof PALETTE], 26);
  }
  const enemy: HTMLCanvasElement[][] = [];
  const enemyBox: number[] = [];
  for (let t = 0; t < 4; t++) {
    const [colorSpr, box] = bakeEnemy(t, ENEMY_COLORS[t]);
    const [whiteSpr] = bakeEnemy(t, PALETTE.white);
    enemy.push([colorSpr, whiteSpr]);
    enemyBox.push(box);
  }
  const [ship, shipBox] = bakeShip();
  const [bullet, bulletW, bulletH] = bakeBullet();
  const [nova, novaBox] = bakeNova();
  return { ship, shipBox, bullet, bulletW, bulletH, enemy, enemyBox, dot, dotBox: 26, nova, novaBox };
}
