// Canvas 2D 描画（背景・台座・漢字・プレビュー）
import type { KanjiGlyph } from './glyph';
import type { Pt, PathCommand } from './geometry';
import { WORLD } from './physics';

const pathCache = new Map<string, Path2D>();

export function glyphPath(g: KanjiGlyph): Path2D {
  let p = pathCache.get(g.char);
  if (p) return p;
  p = new Path2D();
  for (const c of g.commands as PathCommand[]) {
    if (c.type === 'M') p.moveTo(c.x, c.y);
    else if (c.type === 'L') p.lineTo(c.x, c.y);
    else if (c.type === 'Q') p.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
    else if (c.type === 'C') p.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else if (c.type === 'Z') p.closePath();
  }
  pathCache.set(g.char, p);
  return p;
}

export interface Camera {
  /** 画面左上のワールド座標 */
  x: number;
  y: number;
  /** px / ワールド単位 */
  scale: number;
  w: number;
  h: number;
}

export interface DrawItem {
  glyph: KanjiGlyph;
  com: Pt;
  x: number;
  y: number;
  angle: number;
  color?: string;
  alpha?: number;
  outline?: string;
}

export function drawKanji(ctx: CanvasRenderingContext2D, it: DrawItem, scale: number, showHitbox = false) {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.angle);
  ctx.translate(-it.com.x, -it.com.y);
  ctx.globalAlpha = it.alpha ?? 1;
  const path = glyphPath(it.glyph);
  if (it.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = it.outline;
    ctx.stroke(path);
  }
  ctx.fillStyle = it.color ?? '#1c1b22';
  ctx.fill(path);
  if (showHitbox) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = 'rgba(0,200,255,0.9)';
    ctx.fillStyle = 'rgba(0,200,255,0.18)';
    for (const part of it.glyph.shape.parts) {
      ctx.beginPath();
      part.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixColor(c1: number[], c2: number[], t: number) {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
}

// 高度による空の色（昼→夕→夜）
const SKY = [
  { h: 500, top: [118, 182, 238], bottom: [214, 236, 250] },
  { h: 1500, top: [92, 120, 196], bottom: [250, 190, 150] },
  { h: 2600, top: [24, 30, 70], bottom: [110, 80, 140] },
  { h: 3800, top: [6, 8, 24], bottom: [26, 30, 70] },
];

function skyAt(height: number) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i];
    const b = SKY[i + 1];
    if (height <= b.h) {
      const t = Math.max(0, (height - a.h) / (b.h - a.h));
      return { top: mixColor(a.top, b.top, t), bottom: mixColor(a.bottom, b.bottom, t), night: i >= 1 ? t + i - 1 : 0 };
    }
  }
  const l = SKY[SKY.length - 1];
  return { top: mixColor(l.top, l.top, 0), bottom: mixColor(l.bottom, l.bottom, 0), night: 2 };
}

// 星の位置は固定乱数
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = Math.sin(i * 127.1) * 43758.5453;
  const r2 = Math.sin(i * 311.7) * 12345.678;
  return { x: r - Math.floor(r), y: r2 - Math.floor(r2), s: 0.6 + ((i * 7) % 5) * 0.3 };
});

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  time: number,
  reduceMotion: boolean,
  skyHeight?: number,
) {
  const viewCenterH = skyHeight ?? -(cam.y + cam.h / cam.scale / 2);
  const sky = skyAt(viewCenterH);
  const g = ctx.createLinearGradient(0, 0, 0, cam.h);
  g.addColorStop(0, sky.top);
  g.addColorStop(1, sky.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.w, cam.h);

  // 星
  if (sky.night > 0.3) {
    ctx.fillStyle = `rgba(255,255,240,${Math.min(1, sky.night - 0.3)})`;
    for (const s of STARS) {
      const y = (s.y * cam.h * 1.4 - cam.y * cam.scale * 0.05) % cam.h;
      ctx.fillRect(s.x * cam.w, (y + cam.h) % cam.h, s.s, s.s);
    }
  }

  // 遠景の山（パララックス）
  const groundScreenY = (WORLD.groundY - cam.y) * cam.scale;
  const par = (k: number) => groundScreenY * k + cam.h * (1 - k);
  const fujiBase = par(0.15) + 40;
  if (fujiBase > -50) {
    ctx.save();
    const cx = cam.w * 0.62;
    const fw = cam.w * 0.75;
    const fh = cam.w * 0.3;
    ctx.fillStyle = sky.night > 0.5 ? '#2a3354' : '#7c8fb8';
    ctx.beginPath();
    ctx.moveTo(cx - fw, fujiBase);
    ctx.quadraticCurveTo(cx - fw * 0.3, fujiBase - fh * 0.4, cx - fw * 0.12, fujiBase - fh);
    ctx.lineTo(cx + fw * 0.12, fujiBase - fh);
    ctx.quadraticCurveTo(cx + fw * 0.3, fujiBase - fh * 0.4, cx + fw, fujiBase);
    ctx.closePath();
    ctx.fill();
    // 冠雪
    ctx.fillStyle = sky.night > 0.5 ? '#c9cfe6' : '#f4f7ff';
    ctx.beginPath();
    ctx.moveTo(cx - fw * 0.12, fujiBase - fh);
    ctx.lineTo(cx + fw * 0.12, fujiBase - fh);
    ctx.lineTo(cx + fw * 0.2, fujiBase - fh * 0.72);
    ctx.lineTo(cx + fw * 0.09, fujiBase - fh * 0.78);
    ctx.lineTo(cx, fujiBase - fh * 0.7);
    ctx.lineTo(cx - fw * 0.1, fujiBase - fh * 0.79);
    ctx.lineTo(cx - fw * 0.2, fujiBase - fh * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 近景の丘
  const hillBase = par(0.4) + 30;
  if (hillBase > -50) {
    ctx.fillStyle = sky.night > 0.5 ? '#1d3a34' : '#5f9b6e';
    ctx.beginPath();
    ctx.moveTo(0, cam.h + 10);
    for (let x = 0; x <= cam.w + 20; x += 20) {
      ctx.lineTo(x, hillBase - 30 - Math.sin(x / 60) * 14 - Math.sin(x / 23) * 5);
    }
    ctx.lineTo(cam.w, cam.h + 10);
    ctx.fill();
    ctx.fillRect(0, hillBase - 10, cam.w, Math.max(0, cam.h - hillBase + 20));
  }

  // 雲
  const drift = reduceMotion ? 0 : time * 0.006;
  ctx.fillStyle = sky.night > 0.8 ? 'rgba(200,210,240,0.25)' : 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 6; i++) {
    const wy = -200 - i * 420;
    const sy = (wy - cam.y) * cam.scale * 0.6 + cam.h * 0.25;
    if (sy < -80 || sy > cam.h + 80) continue;
    const sx = ((i * 173 + drift * (1 + (i % 3) * 0.4)) % (cam.w + 240)) - 120;
    cloud(ctx, sx, sy, 34 + (i % 3) * 10);
  }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2);
  ctx.arc(x - r * 0.9, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x + r * 0.2, y - r * 0.45, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

/** 台座（ワールド座標で描画） */
export function drawPedestal(ctx: CanvasRenderingContext2D) {
  const w = WORLD.pedestalWidth;
  const x0 = WORLD.centerX - w / 2;
  const y0 = WORLD.groundY;
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  g.addColorStop(0, '#6d6458');
  g.addColorStop(0.5, '#9a8f7e');
  g.addColorStop(1, '#5d554a');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, WORLD.pedestalHeight);
  // 石積みの目地
  ctx.strokeStyle = 'rgba(40,34,28,0.35)';
  ctx.lineWidth = 2;
  for (let row = 0; row * 40 < WORLD.pedestalHeight; row++) {
    const y = y0 + 16 + row * 40;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
    for (let c = (row % 2) * 40; c < w; c += 80) {
      ctx.beginPath();
      ctx.moveTo(x0 + c, y);
      ctx.lineTo(x0 + c, y + 40);
      ctx.stroke();
    }
  }
  // 天板
  ctx.fillStyle = '#3e3a35';
  ctx.fillRect(x0 - 6, y0, w + 12, 16);
  ctx.fillStyle = '#c9b48a';
  ctx.fillRect(x0 - 6, y0, w + 12, 4);
}

/** 高度目盛り（ワールド座標） */
export function drawRuler(ctx: CanvasRenderingContext2D, cam: Camera, bestHeight: number) {
  const top = cam.y;
  const bottom = cam.y + cam.h / cam.scale;
  ctx.save();
  ctx.font = `${12 / cam.scale}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (let m = Math.max(1, Math.floor(-bottom / 100)); m <= Math.ceil(-top / 100); m++) {
    const y = WORLD.groundY - m * 100;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5 / cam.scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(18, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${m}m`, 22, y);
  }
  if (bestHeight > 0) {
    const y = WORLD.groundY - bestHeight;
    ctx.strokeStyle = 'rgba(255,200,60,0.9)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2 / cam.scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,80,1)';
    ctx.textAlign = 'right';
    ctx.fillText(`自己ベスト ${(bestHeight / 100).toFixed(1)}m`, WORLD.width - 6, y - 10 / cam.scale);
  }
  ctx.restore();
}
