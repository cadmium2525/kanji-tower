import { readFileSync } from 'node:fs';
import { GlyphSource } from '../src/glyph';
import type { TowerCore } from '../src/core';

const buf = readFileSync(new URL('../public/fonts/NotoSerifJP-Black-kanji.otf', import.meta.url));
export const glyphs = GlyphSource.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** 落下中の状態が終わるまで進める（最大 limit ステップ） */
export function runUntilSettled(core: TowerCore, limit = 60 * 15): number {
  let t = 0;
  while (core.phase === 'falling' && t < limit) {
    core.tick();
    t++;
  }
  return t;
}

export function drop(core: TowerCore, ch: string, x = 300, angle = 0) {
  core.setPreview(glyphs.get(ch));
  core.previewAngle = 0;
  core.rotate(angle);
  core.moveTo(x);
  const ok = core.drop();
  const ticks = runUntilSettled(core);
  return { ok, ticks };
}
