// フォント読み込みと字形キャッシュ
import { parse, type Font } from 'opentype.js';
import { buildShape, type GlyphShape, type PathCommand } from './geometry';

export interface KanjiGlyph {
  char: string;
  shape: GlyphShape;
  commands: PathCommand[];
}

export class GlyphSource {
  private cache = new Map<string, KanjiGlyph | null>();
  private baseline: number;

  constructor(private font: Font) {
    const os2 = (font.tables as { os2?: { sTypoAscender?: number } }).os2;
    const asc = os2?.sTypoAscender ?? 880;
    // 全角の文字枠（em）を 0〜100 の論理文字枠に対応させる
    this.baseline = (asc / font.unitsPerEm) * 100;
  }

  static fromBuffer(buf: ArrayBuffer): GlyphSource {
    return new GlyphSource(parse(buf));
  }

  has(char: string): boolean {
    const g = this.font.charToGlyph(char);
    return !!g && g.index !== 0;
  }

  /** 字形を取得。欠字なら null、形状生成失敗なら例外 */
  get(char: string): KanjiGlyph | null {
    if (this.cache.has(char)) return this.cache.get(char)!;
    if (!this.has(char)) {
      this.cache.set(char, null);
      return null;
    }
    const glyph = this.font.charToGlyph(char);
    const path = glyph.getPath(0, this.baseline, 100);
    const commands = path.commands as unknown as PathCommand[];
    const shape = buildShape(commands);
    if (shape.parts.length === 0 || shape.area < 20) throw new Error('shape');
    const k: KanjiGlyph = { char, shape, commands };
    this.cache.set(char, k);
    return k;
  }
}

export async function loadFont(url: string, onProgress?: (r: number) => void): Promise<GlyphSource> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('font fetch failed: ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total && onProgress) onProgress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  onProgress?.(1);
  return GlyphSource.fromBuffer(buf.buffer);
}
