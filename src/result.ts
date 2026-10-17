// 結果画像（PNG）の生成と共有
import { drawKanji, drawPedestal, type DrawItem } from './render';
import { transformedBounds, WORLD } from './physics';

export interface ResultData {
  height: number; // m
  count: number;
  chars: string[];
  tower: DrawItem[];
  url: string;
}

/** タワーを指定矩形にフィットさせて描画 */
export function drawTowerFit(
  ctx: CanvasRenderingContext2D,
  items: DrawItem[],
  rx: number,
  ry: number,
  rw: number,
  rh: number,
) {
  let minX = WORLD.centerX - WORLD.pedestalWidth / 2;
  let maxX = WORLD.centerX + WORLD.pedestalWidth / 2;
  let minY = WORLD.groundY - 120;
  const maxY = WORLD.groundY + 60;
  for (const it of items) {
    const b = transformedBounds(it.glyph, it.com, it.x, it.y, it.angle);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
  }
  minX -= 30;
  maxX += 30;
  minY -= 30;
  const s = Math.min(rw / (maxX - minX), rh / (maxY - minY));
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, ry, 0, ry + rh);
  sky.addColorStop(0, '#7cb8ee');
  sky.addColorStop(1, '#e3f1fb');
  ctx.fillStyle = sky;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.translate(rx + rw / 2, ry + rh);
  ctx.scale(s, s);
  ctx.translate(-(minX + maxX) / 2, -maxY);
  drawPedestal(ctx);
  for (const it of items) drawKanji(ctx, { ...it, outline: 'rgba(255,255,255,0.8)' }, s);
  ctx.restore();
}

export function renderResultImage(d: ResultData): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fbf6ec';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1c1b22';
  ctx.textAlign = 'center';
  ctx.font = '900 110px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  ctx.fillText('漢字タワー', W / 2, 150);
  ctx.fillStyle = '#e07a3f';
  ctx.fillRect(W / 2 - 260, 175, 520, 10);

  drawTowerFit(ctx, d.tower, 60, 230, 600, 960);
  ctx.strokeStyle = '#1c1b22';
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 230, 600, 960);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#555';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText('高さ', 710, 320);
  ctx.fillStyle = '#1c1b22';
  ctx.font = '800 110px system-ui, sans-serif';
  const hs = d.height.toFixed(1);
  ctx.fillText(hs, 710, 440);
  const hw = ctx.measureText(hs).width;
  ctx.font = '700 50px system-ui, sans-serif';
  ctx.fillText('m', 710 + hw + 10, 440);
  ctx.fillStyle = '#555';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText('文字数', 710, 540);
  ctx.fillStyle = '#1c1b22';
  ctx.font = '800 90px system-ui, sans-serif';
  ctx.fillText(String(d.count), 710, 640);

  ctx.fillStyle = '#555';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText('使った漢字', 710, 740);
  ctx.fillStyle = '#1c1b22';
  ctx.font = '700 56px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  const chars = d.chars.slice(0, 24);
  chars.forEach((c, i) => ctx.fillText(c, 710 + (i % 5) * 62, 820 + Math.floor(i / 5) * 72));

  ctx.textAlign = 'center';
  ctx.fillStyle = '#777';
  ctx.font = '500 34px system-ui, sans-serif';
  ctx.fillText(`#漢字タワー  ${d.url}`, W / 2, 1270);
  return cv;
}

export function shareText(d: { height: number; count: number; chars: string[]; url: string }) {
  return `漢字タワーで ${d.height.toFixed(1)}m（${d.count}文字）積みました！\n使った漢字：${d.chars.join('')}\n#漢字タワー ${d.url}`;
}

export async function canvasToBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
