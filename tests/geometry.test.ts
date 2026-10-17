import { describe, expect, it } from 'vitest';
import { glyphs } from './helpers';
import { minWidth, pointInRing, type Pt } from '../src/geometry';

const TEST_CHARS = '一二三人山川田口日木凹凸品森国回囲園図固龍';

function covered(parts: Pt[][], p: Pt) {
  return parts.some((poly) => pointInRing(p, poly));
}

function isConvex(poly: Pt[]) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-6) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

describe('字形 → 凸パーツ分割', () => {
  it.each([...TEST_CHARS])('%s: 凸パーツ群が生成され、文字枠100×100に収まる', (ch) => {
    const g = glyphs.get(ch)!;
    expect(g).toBeTruthy();
    expect(g.shape.parts.length).toBeGreaterThan(0);
    for (const p of g.shape.parts) expect(isConvex(p)).toBe(true);
    const b = g.shape.bounds;
    expect(b.minX).toBeGreaterThanOrEqual(-1);
    expect(b.minY).toBeGreaterThanOrEqual(-1);
    expect(b.maxX).toBeLessThanOrEqual(101);
    expect(b.maxY).toBeLessThanOrEqual(101);
  });

  it('外周リングの内部はおおむねパーツで覆われる（三角形分割の欠落がない）', () => {
    for (const ch of TEST_CHARS) {
      const g = glyphs.get(ch)!;
      // 衝突形状の面積 ≥ インク面積（最小厚み保証で僅かに増える）
      let a = 0;
      for (const p of g.shape.parts) {
        let s = 0;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y;
        a += Math.abs(s / 2);
      }
      expect(a).toBeGreaterThanOrEqual(g.shape.area * 0.999);
      expect(a).toBeLessThan(g.shape.area * 1.6); // 細い横画の多い字（一・二・三）は厚み保証で増える
    }
  });

  it('田: 4つの穴が保持され、穴の中心は当たり判定に含まれない', () => {
    const g = glyphs.get('田')!;
    expect(g.shape.rings.length).toBe(5); // 外周1 + 穴4
    // 穴の中心（リングの重心）
    const holes = g.shape.rings.slice().sort((a, b) => a.length - b.length).slice(0, 4);
    for (const h of holes) {
      const c = { x: h.reduce((s, p) => s + p.x, 0) / h.length, y: h.reduce((s, p) => s + p.y, 0) / h.length };
      if (pointInRing(c, h)) expect(covered(g.shape.parts, c)).toBe(false);
    }
    // 中央の十字（インク）は含まれる
    expect(covered(g.shape.parts, { x: 50, y: 50 })).toBe(true);
  });

  it('凹: 上部中央のくぼみ（字形の外側）は当たり判定に含まれない', () => {
    const g = glyphs.get('凹')!;
    // 上端付近の中央：外周リングの外側であること
    const outer = g.shape.rings.reduce((a, b) => (Math.abs(area(a)) > Math.abs(area(b)) ? a : b));
    const notch = { x: 49.5, y: 30 };
    expect(pointInRing(notch, outer)).toBe(false);
    expect(covered(g.shape.parts, notch)).toBe(false);
  });

  it('回: 内側の口と外側の口の間に空間がある', () => {
    const g = glyphs.get('回')!;
    expect(g.shape.rings.length).toBe(4);
    // 外枠と内枠の間（左側）
    expect(covered(g.shape.parts, { x: 26, y: 50 })).toBe(false);
  });

  it('川: 離れた3本の画が別々のパーツ群になる', () => {
    const g = glyphs.get('川')!;
    expect(g.shape.rings.length).toBe(3);
    expect(covered(g.shape.parts, { x: 40, y: 60 })).toBe(false);
  });

  it('極細の線は最小厚み(5)を保証する', () => {
    for (const ch of '一三川') {
      for (const p of glyphs.get(ch)!.shape.parts) expect(minWidth(p).width).toBeGreaterThanOrEqual(4.99);
    }
  });

  it('フォント欠字は null（四角形にフォールバックしない）', () => {
    expect(glyphs.get('𠀋')).toBeNull();
  });
});

function area(r: Pt[]) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j].x * r[i].y - r[i].x * r[j].y;
  return s / 2;
}
