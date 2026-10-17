// 字形の輪郭（外周・穴）から、物理エンジン用の凸多角形パーツ群を作る純粋関数群。
import earcut from 'earcut';

export interface Pt {
  x: number;
  y: number;
}

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export interface GlyphShape {
  /** 凸パーツ（字形座標系、0〜100の文字枠） */
  parts: Pt[][];
  /** 外周＋穴のリング（デバッグ・描画用） */
  rings: Pt[][];
  /** インク面積（単位²） */
  area: number;
  /** 輪郭のバウンディングボックス */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** 曲線の制御多角形の長さから分割数を決める（適応サンプリング） */
function segmentsFor(len: number, step: number): number {
  return Math.max(2, Math.min(24, Math.ceil(len / step)));
}

/** パスコマンドを閉曲線のリング群へ変換する */
export function commandsToRings(cmds: PathCommand[], step = 2.5): Pt[][] {
  const rings: Pt[][] = [];
  let cur: Pt[] = [];
  let px = 0;
  let py = 0;
  const close = () => {
    if (cur.length >= 3) rings.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close();
        cur.push({ x: c.x, y: c.y });
        px = c.x;
        py = c.y;
        break;
      case 'L':
        cur.push({ x: c.x, y: c.y });
        px = c.x;
        py = c.y;
        break;
      case 'Q': {
        const len = Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1);
        const n = segmentsFor(len, step);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          cur.push({
            x: u * u * px + 2 * u * t * c.x1 + t * t * c.x,
            y: u * u * py + 2 * u * t * c.y1 + t * t * c.y,
          });
        }
        px = c.x;
        py = c.y;
        break;
      }
      case 'C': {
        const len =
          Math.hypot(c.x1 - px, c.y1 - py) +
          Math.hypot(c.x2 - c.x1, c.y2 - c.y1) +
          Math.hypot(c.x - c.x2, c.y - c.y2);
        const n = segmentsFor(len, step);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          cur.push({
            x: u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            y: u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          });
        }
        px = c.x;
        py = c.y;
        break;
      }
      case 'Z':
        close();
        break;
    }
  }
  close();
  return rings.map(cleanRing).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 0.05);
}

/** 連続重複点・始終点重複を除去 */
export function cleanRing(r: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-4) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-4) break;
    out.pop();
  }
  return out;
}

/** 符号付き面積（y下向き座標で計算） */
export function signedArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    s += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  }
  return s / 2;
}

function polyArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    s += r[j].x * r[i].y - r[i].x * r[j].y;
  }
  return s / 2;
}

export function pointInRing(p: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Ramer–Douglas–Peucker（閉曲線版） */
export function simplifyRing(r: Pt[], tol: number): Pt[] {
  if (r.length <= 4) return r;
  // 最も離れた2点で分割して開曲線2本として処理
  let far = 0;
  let farD = -1;
  for (let i = 1; i < r.length; i++) {
    const d = (r[i].x - r[0].x) ** 2 + (r[i].y - r[0].y) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(r.slice(0, far + 1), tol);
  const b = rdp([...r.slice(far), r[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : r;
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  let idx = 0;
  let maxD = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [a, b];
  const l = rdp(pts.slice(0, idx + 1), tol);
  const r = rdp(pts.slice(idx), tol);
  return [...l.slice(0, -1), ...r];
}

/** 入れ子の深さで外周と穴を分類し、外周ごとに穴をまとめる */
export function groupRings(rings: Pt[][]): { outer: Pt[]; holes: Pt[][] }[] {
  const info = rings.map((r, i) => {
    const area = Math.abs(signedArea(r));
    let depth = 0;
    let parent = -1;
    let parentArea = Infinity;
    for (let j = 0; j < rings.length; j++) {
      if (i === j) continue;
      const aj = Math.abs(signedArea(rings[j]));
      if (aj <= area) continue;
      if (pointInRing(sampleInside(r), rings[j])) {
        depth++;
        if (aj < parentArea) {
          parentArea = aj;
          parent = j;
        }
      }
    }
    return { depth, parent };
  });
  const groups = new Map<number, { outer: Pt[]; holes: Pt[][] }>();
  info.forEach((inf, i) => {
    if (inf.depth % 2 === 0) groups.set(i, { outer: rings[i], holes: [] });
  });
  info.forEach((inf, i) => {
    if (inf.depth % 2 === 1 && groups.has(inf.parent)) groups.get(inf.parent)!.holes.push(rings[i]);
  });
  return [...groups.values()];
}

/** リング上の点ではなく、辺の中点を少し内側にずらした点（境界上判定の誤差回避） */
function sampleInside(r: Pt[]): Pt {
  const a = r[0];
  const b = r[1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function isConvex(poly: Pt[]): boolean {
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]);
    if (Math.abs(c) < 1e-7) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function removeCollinear(poly: Pt[]): Pt[] {
  let out = poly;
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      if (Math.abs(cross(a, b, c)) / Math.max(ab + bc, 1e-9) < 0.02) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * 穴付きポリゴンを earcut で三角形分割し、Hertel–Mehlhorn 法で凸多角形へ統合する。
 */
export function decompose(outer: Pt[], holes: Pt[][]): Pt[][] {
  const pts: Pt[] = [...outer];
  const holeIdx: number[] = [];
  for (const h of holes) {
    holeIdx.push(pts.length);
    pts.push(...h);
  }
  const flat: number[] = [];
  for (const p of pts) flat.push(p.x, p.y);
  const tri = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);

  // 各多角形は頂点インデックス列。向きを統一する（polyArea > 0）
  const polys = new Map<number, number[]>();
  let nextId = 0;
  for (let i = 0; i < tri.length; i += 3) {
    let t = [tri[i], tri[i + 1], tri[i + 2]];
    const ar = polyArea(t.map((k) => pts[k]));
    if (Math.abs(ar) < 1e-6) continue;
    if (ar < 0) t = [t[0], t[2], t[1]];
    polys.set(nextId++, t);
  }
  const owner = new Map<string, number>();
  const key = (a: number, b: number) => a + ',' + b;
  for (const [id, p] of polys) {
    for (let i = 0; i < p.length; i++) owner.set(key(p[i], p[(i + 1) % p.length]), id);
  }
  // 内部対角線（両方向の辺が存在）を長い順に除去を試みる
  const diags: [number, number, number][] = [];
  for (const k of owner.keys()) {
    const [a, b] = k.split(',').map(Number);
    if (a < b && owner.has(key(b, a))) {
      diags.push([a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y)]);
    }
  }
  diags.sort((u, v) => v[2] - u[2]);
  for (const [a, b] of diags) {
    const pId = owner.get(key(a, b));
    const qId = owner.get(key(b, a));
    if (pId === undefined || qId === undefined || pId === qId) continue;
    const P = polys.get(pId)!;
    const Q = polys.get(qId)!;
    const ia = P.indexOf(a);
    if (P[(ia + 1) % P.length] !== b) continue;
    const jb = Q.indexOf(b);
    if (Q[(jb + 1) % Q.length] !== a) continue;
    // P を b から始めて a で終わる列に、Q を a から始めて b で終わる列に回す
    const Pr = rotate(P, (ia + 1) % P.length); // b ... a
    const Qr = rotate(Q, (jb + 1) % Q.length); // a ... b
    const merged = [...Pr, ...Qr.slice(1, -1)];
    if (!isConvex(merged.map((k) => pts[k]))) continue;
    polys.delete(qId);
    polys.set(pId, merged);
    for (let i = 0; i < merged.length; i++) owner.set(key(merged[i], merged[(i + 1) % merged.length]), pId);
    owner.delete(key(a, b));
    owner.delete(key(b, a));
  }
  const out: Pt[][] = [];
  for (const p of polys.values()) {
    const poly = removeCollinear(p.map((k) => pts[k]));
    if (poly.length >= 3 && Math.abs(polyArea(poly)) > 1e-3) out.push(poly);
  }
  return out;
}

function rotate<T>(arr: T[], start: number): T[] {
  return [...arr.slice(start), ...arr.slice(0, start)];
}

export function ringArea(r: Pt[]): number {
  return Math.abs(polyArea(r));
}

/**
 * 凸パーツの最小幅（最も薄い方向の厚み）と、その方向の単位法線を返す。
 * 凸多角形の最小幅は、いずれかの辺の法線方向で得られる。
 */
export function minWidth(poly: Pt[]): { width: number; nx: number; ny: number } {
  let best = { width: Infinity, nx: 0, ny: 1 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      const d = p.x * nx + p.y * ny;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    if (hi - lo < best.width) best = { width: hi - lo, nx, ny };
  }
  return best;
}

/**
 * 極細のパーツを、最も薄い方向にだけ引き伸ばして最小厚みを保証する（すり抜け対策）。
 * 各頂点の移動量は最大 (minThick - 幅) / 2 に収まり、凸性は保たれる。
 */
export function thicken(poly: Pt[], minThick: number): Pt[] {
  const { width, nx, ny } = minWidth(poly);
  if (width >= minThick || width < 1e-6) return poly;
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  const k = minThick / width - 1;
  return poly.map((p) => {
    const d = (p.x - cx) * nx + (p.y - cy) * ny;
    return { x: p.x + nx * d * k, y: p.y + ny * d * k };
  });
}

/** パスコマンドから物理用の形状を構築 */
export function buildShape(cmds: PathCommand[], simplifyTol = 0.35, minThick = 5): GlyphShape {
  const rings = commandsToRings(cmds).map((r) => simplifyRing(r, simplifyTol)).filter((r) => r.length >= 3);
  const groups = groupRings(rings);
  const parts: Pt[][] = [];
  for (const g of groups) parts.push(...decompose(g.outer, g.holes));
  // 面積（質量）は元の字形で計算し、衝突形状だけ最小厚みを保証する
  let area = 0;
  for (const p of parts) area += ringArea(p);
  for (let i = 0; i < parts.length; i++) parts[i] = thicken(parts[i], minThick);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const p of r) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { parts, rings, area, bounds: { minX, minY, maxX, maxY } };
}
