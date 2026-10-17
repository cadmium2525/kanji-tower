// シングルモードのゲーム進行（描画やDOMに依存しない中核ロジック）
import Matter from 'matter-js';
import type { KanjiGlyph } from './glyph';
import { createEngine, createKanjiBody, glyphCom, PHYS, stepWorld, transformedBounds, WORLD, type KanjiBody } from './physics';
import type { Pt } from './geometry';

const { Composite, Events } = Matter;

export type Phase = 'aim' | 'falling' | 'over';

export interface Preview {
  glyph: KanjiGlyph;
  com: Pt;
}

export interface CoreOptions {
  allowReuse?: boolean;
}

export interface CoreEvents {
  onSettle?: (heightM: number, count: number) => void;
  onGameOver?: (reason: 'fell' | 'timeout') => void;
  onImpact?: (strength: number) => void;
}

/** 安定判定の閾値 */
const SETTLE = {
  speed: 0.12,
  angular: 0.004,
  ticks: 30, // 0.5秒継続
  timeoutMs: 10000, // 接地しない／安定しない場合の上限
};

export class TowerCore {
  engine: Matter.Engine;
  bodies: KanjiBody[] = [];
  used = new Set<string>();
  phase: Phase = 'aim';
  preview: Preview | null = null;
  previewX = WORLD.centerX;
  previewAngle = 0;
  /** 落下開始の基準（タワー最上端） */
  baseTop = 0;
  current: KanjiBody | null = null;
  /** 安定時点の最高高度（ゲーム内単位） */
  bestHeight = 0;
  /** 安定した時点の高度（現在） */
  height = 0;
  placed = 0;
  time = 0;
  overReason: 'fell' | 'timeout' | null = null;
  fallen: KanjiBody | null = null;
  private stillTicks = 0;

  constructor(
    public events: CoreEvents = {},
    public opts: CoreOptions = {},
  ) {
    this.engine = createEngine();
    Events.on(this.engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA.parent;
        const b = pair.bodyB.parent;
        const cur = this.current;
        if (cur && (a === cur.body || b === cur.body)) cur.touched = true;
        const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (rel > 1.5) this.events.onImpact?.(rel);
      }
    });
    this.updateSpawn();
  }

  /** 現在のタワー最上端（y最小、ゲーム内単位） */
  towerTop(excludeCurrent = true): number {
    let top = WORLD.groundY;
    for (const k of this.bodies) {
      if (excludeCurrent && k === this.current) continue;
      top = Math.min(top, k.body.bounds.min.y);
    }
    return top;
  }

  updateSpawn() {
    this.baseTop = this.towerTop();
  }

  /** プレビュー（重心）のy座標。字の下端がタワー最上端の少し上に来るようにする */
  get spawnY(): number {
    const gap = 45;
    if (!this.preview) return this.baseTop - gap - 50;
    const b = transformedBounds(this.preview.glyph, this.preview.com, 0, 0, this.previewAngle);
    return this.baseTop - gap - b.maxY;
  }

  setPreview(glyph: KanjiGlyph | null) {
    this.preview = glyph ? { glyph, com: glyphCom(glyph) } : null;
    this.clampPreview();
  }

  move(dx: number) {
    this.previewX += dx;
    this.clampPreview();
  }

  moveTo(x: number) {
    this.previewX = x;
    this.clampPreview();
  }

  rotate(da: number) {
    this.previewAngle += da;
    // 角度を -π〜π に保つ
    this.previewAngle = Math.atan2(Math.sin(this.previewAngle), Math.cos(this.previewAngle));
    this.clampPreview();
  }

  private clampPreview() {
    const margin = 10;
    if (!this.preview) {
      this.previewX = Math.max(margin, Math.min(WORLD.width - margin, this.previewX));
      return;
    }
    const b = transformedBounds(this.preview.glyph, this.preview.com, this.previewX, this.spawnY, this.previewAngle);
    if (b.minX < margin) this.previewX += margin - b.minX;
    if (b.maxX > WORLD.width - margin) this.previewX -= b.maxX - (WORLD.width - margin);
  }

  /** 使用済みチェック（再使用不可ルール） */
  isUsed(char: string): boolean {
    return !this.opts.allowReuse && this.used.has(char);
  }

  /** プレビュー中の漢字を落とす。成功時 true */
  drop(): boolean {
    if (this.phase !== 'aim' || !this.preview) return false;
    const { glyph } = this.preview;
    if (this.isUsed(glyph.char)) return false;
    // 字形の底がスポーン高度に来るよう配置
    const kb = createKanjiBody(glyph, this.previewX, this.spawnY, this.previewAngle);
    kb.dropped = this.time;
    this.used.add(glyph.char);
    this.bodies.push(kb);
    Composite.add(this.engine.world, kb.body);
    this.current = kb;
    this.preview = null;
    this.previewAngle = 0;
    this.phase = 'falling';
    this.stillTicks = 0;
    return true;
  }

  private isFallen(k: KanjiBody): boolean {
    const b = k.body.bounds;
    // 字全体が台の上面より下に落ちた、または左右に大きく外れた
    return b.min.y > WORLD.groundY + 20 || b.max.x < -300 || b.min.x > WORLD.width + 300;
  }

  /** 固定タイムステップで1ステップ進める */
  tick() {
    stepWorld(this.engine);
    this.time += PHYS.step;
    if (this.phase === 'over') return;

    for (const k of this.bodies) {
      if (this.isFallen(k)) {
        this.fallen = k;
        this.gameOver('fell');
        return;
      }
    }

    if (this.phase === 'falling' && this.current) {
      const cur = this.current;
      const allStill = this.bodies.every(
        (k) =>
          k.body.isSleeping ||
          (k.body.speed < SETTLE.speed && Math.abs(k.body.angularVelocity) < SETTLE.angular),
      );
      if (cur.touched && allStill) this.stillTicks++;
      else this.stillTicks = 0;

      const elapsed = this.time - cur.dropped;
      if (this.stillTicks >= SETTLE.ticks || (cur.touched && elapsed > SETTLE.timeoutMs)) {
        this.settle();
      } else if (!cur.touched && elapsed > SETTLE.timeoutMs) {
        this.fallen = cur;
        this.gameOver('timeout');
      }
    }
  }

  private settle() {
    this.current = null;
    this.placed++;
    this.height = WORLD.groundY - this.towerTop(false);
    this.bestHeight = Math.max(this.bestHeight, this.height);
    this.phase = 'aim';
    this.updateSpawn();
    this.clampPreview();
    this.events.onSettle?.(this.bestHeight / 100, this.placed);
  }

  private gameOver(reason: 'fell' | 'timeout') {
    this.phase = 'over';
    this.overReason = reason;
    this.preview = null;
    this.events.onGameOver?.(reason);
  }

  /** 使用した漢字（落とした順） */
  usedChars(): string[] {
    return this.bodies.map((k) => k.char);
  }
}
