// Matter.js の世界と、字形からの複合剛体生成
import Matter from 'matter-js';
import type { KanjiGlyph } from './glyph';
import type { Pt } from './geometry';

const { Engine, Body, Bodies, Composite } = Matter;

export const PHYS = {
  gravityY: 1,
  friction: 0.65,
  frictionStatic: 0.85,
  restitution: 0.05,
  frictionAir: 0.002,
  positionIterations: 8,
  velocityIterations: 8,
  density: 0.001,
  /** インク面積の上下限（質量の極端な差を防ぐ） */
  minArea: 1000,
  maxArea: 4500,
  step: 1000 / 60,
  /** 1フレーム(1/60秒)あたりのサブステップ数 */
  substeps: 3,
  /** 速度上限（単位 / (1/60秒)）。深い食い込みによる爆発を防ぐ */
  maxSpeed: 14,
  maxAngular: 0.25,
};

/** 固定タイムステップで1/60秒ぶん進める（サブステップ＋速度上限つき） */
export function stepWorld(engine: Matter.Engine) {
  const dt = PHYS.step / PHYS.substeps;
  for (let i = 0; i < PHYS.substeps; i++) {
    for (const b of Matter.Composite.allBodies(engine.world)) {
      if (b.isStatic || b.isSleeping) continue;
      const v = Body.getVelocity(b);
      const sp = Math.hypot(v.x, v.y);
      if (sp > PHYS.maxSpeed) Body.setVelocity(b, { x: (v.x / sp) * PHYS.maxSpeed, y: (v.y / sp) * PHYS.maxSpeed });
      const av = Body.getAngularVelocity(b);
      if (Math.abs(av) > PHYS.maxAngular) Body.setAngularVelocity(b, Math.sign(av) * PHYS.maxAngular);
    }
    Engine.update(engine, dt);
  }
}

/** 世界の寸法（ゲーム内単位。100 = 文字枠1つ = 1m） */
export const WORLD = {
  width: 600,
  pedestalWidth: 320,
  pedestalHeight: 900,
  centerX: 300,
  groundY: 0,
};

export interface KanjiBody {
  char: string;
  body: Matter.Body;
  /** 字形座標系での重心（描画時のオフセット） */
  com: Pt;
  glyph: KanjiGlyph;
  dropped: number;
  touched: boolean;
}

export function createEngine(): Matter.Engine {
  const engine = Engine.create({
    enableSleeping: true,
    positionIterations: PHYS.positionIterations,
    velocityIterations: PHYS.velocityIterations,
  });
  engine.gravity.y = PHYS.gravityY;
  const pedestal = Bodies.rectangle(
    WORLD.centerX,
    WORLD.groundY + WORLD.pedestalHeight / 2,
    WORLD.pedestalWidth,
    WORLD.pedestalHeight,
    { isStatic: true, friction: 0.9, frictionStatic: 1, label: 'pedestal' },
  );
  Composite.add(engine.world, pedestal);
  return engine;
}

function centre(vs: Pt[]): Pt {
  // 多角形の重心
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const c = vs[j].x * vs[i].y - vs[i].x * vs[j].y;
    a += c;
    cx += (vs[j].x + vs[i].x) * c;
    cy += (vs[j].y + vs[i].y) * c;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** 字形の凸パーツ群から単一の複合剛体を作る（四角形への置き換えはしない） */
export function createKanjiBody(glyph: KanjiGlyph, x: number, y: number, angle: number): KanjiBody {
  const common = {
    friction: PHYS.friction,
    frictionStatic: PHYS.frictionStatic,
    restitution: PHYS.restitution,
    frictionAir: PHYS.frictionAir,
    density: PHYS.density,
    label: 'kanji',
  };
  const parts = glyph.shape.parts.map((poly) => {
    // Matter の頂点順（atan2 昇順）にそろえる
    const c = centre(poly);
    const vs = [...poly].sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x));
    return Body.create({ ...common, position: c, vertices: vs.map((p) => ({ x: p.x, y: p.y })) });
  });
  if (parts.length === 0) throw new Error('shape');
  const body = Body.create({ ...common, parts });
  const com = { x: body.position.x, y: body.position.y };
  // 質量はインク面積に比例、ただし上下限で極端な差を抑える
  const area = Math.min(PHYS.maxArea, Math.max(PHYS.minArea, glyph.shape.area));
  Body.setMass(body, area * PHYS.density);
  Body.setPosition(body, { x, y });
  Body.setAngle(body, angle);
  return { char: glyph.char, body, com, glyph, dropped: performance.now(), touched: false };
}

/** 回転・移動後の字形のバウンディング（プレビューの当たり位置計算に使用） */
export function transformedBounds(glyph: KanjiGlyph, com: Pt, x: number, y: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of glyph.shape.parts)
    for (const p of part) {
      const lx = p.x - com.x;
      const ly = p.y - com.y;
      const wx = x + lx * cos - ly * sin;
      const wy = y + lx * sin + ly * cos;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy);
      maxY = Math.max(maxY, wy);
    }
  return { minX, minY, maxX, maxY };
}

/** 字形の重心（パーツ面積加重） */
export function glyphCom(glyph: KanjiGlyph): Pt {
  let a = 0;
  let x = 0;
  let y = 0;
  for (const p of glyph.shape.parts) {
    let pa = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) pa += p[j].x * p[i].y - p[i].x * p[j].y;
    pa = Math.abs(pa / 2);
    const c = centre(p);
    a += pa;
    x += c.x * pa;
    y += c.y * pa;
  }
  return { x: x / a, y: y / a };
}
