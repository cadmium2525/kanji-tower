import { describe, expect, it } from 'vitest';
import { TowerCore } from '../src/core';
import { createKanjiBody, PHYS, WORLD } from '../src/physics';
import { drop, glyphs, runUntilSettled } from './helpers';

describe('複合剛体', () => {
  it('川は1つの剛体（複数パーツ）として生成される', () => {
    const k = createKanjiBody(glyphs.get('川')!, 300, -200, 0);
    expect(k.body.parts.length).toBe(glyphs.get('川')!.shape.parts.length + 1);
    for (const p of k.body.parts.slice(1)) expect(p.parent).toBe(k.body);
  });

  it('質量はインク面積に比例し、上下限でクランプされる', () => {
    const m = (c: string) => createKanjiBody(glyphs.get(c)!, 0, 0, 0).body.mass;
    expect(m('一')).toBeCloseTo(PHYS.minArea * PHYS.density);
    expect(m('龍')).toBeCloseTo(PHYS.maxArea * PHYS.density);
    expect(m('口')).toBeLessThan(m('国'));
  });
});

describe('シングルモード進行', () => {
  it('代表字が台座に着地して安定する（永久待機しない）', () => {
    for (const ch of '一山人田凹国回龍') {
      const core = new TowerCore();
      const { ok, ticks } = drop(core, ch);
      expect(ok).toBe(true);
      expect(core.phase).toBe('aim');
      expect(ticks).toBeLessThan(60 * 11);
      expect(core.placed).toBe(1);
      expect(core.height).toBeGreaterThan(10);
    }
  });

  it('四角い字を積むと高度が上がる', () => {
    const core = new TowerCore();
    for (const ch of '回田国') drop(core, ch);
    expect(core.phase).toBe('aim');
    expect(core.placed).toBe(3);
    expect(core.bestHeight).toBeGreaterThan(220);
  });

  it('凹のくぼみに縦にした「一」の先端が入り込む', () => {
    const core = new TowerCore();
    drop(core, '凹');
    const ob = core.bodies[0].body.bounds;
    let deepest = -Infinity;
    // くぼみの位置は字形ごとに違うので数か所試す
    for (const dx of [-4, -2, 0, 2, 4]) {
      const c = new TowerCore();
      drop(c, '凹');
      const b = c.bodies[0].body.bounds;
      drop(c, '一', (b.min.x + b.max.x) / 2 + dx, Math.PI / 2);
      if (c.bodies[1].body.bounds.max.y < -20) deepest = Math.max(deepest, c.bodies[1].body.bounds.max.y - b.min.y);
    }
    expect(ob.min.y).toBeLessThan(-80);
    expect(deepest).toBeGreaterThan(5); // 凸包なら 0 以下になる
  });

  it('同じ漢字は2回落とせない（設定で許可可能）', () => {
    const core = new TowerCore();
    drop(core, '山');
    core.setPreview(glyphs.get('山'));
    expect(core.drop()).toBe(false);
    expect(core.bodies.length).toBe(1);
    const free = new TowerCore({}, { allowReuse: true });
    drop(free, '山');
    free.setPreview(glyphs.get('山'));
    expect(free.drop()).toBe(true);
  });

  it('台座の外に落とすとゲームオーバー', () => {
    let reason = '';
    const core = new TowerCore({ onGameOver: (r) => (reason = r) });
    drop(core, '木', 20);
    expect(core.phase).toBe('over');
    expect(reason).toBe('fell');
    expect(core.fallen?.char).toBe('木');
    expect(core.placed).toBe(0);
  });

  it('既存の字が崩れて落ちてもゲームオーバー', () => {
    const core = new TowerCore();
    drop(core, '口', WORLD.centerX + WORLD.pedestalWidth / 2 - 30);
    if (core.phase === 'aim') drop(core, '国', WORLD.centerX + WORLD.pedestalWidth / 2 + 10);
    expect(core.phase).toBe('over');
  });

  it('接地しないままタイムアウトすると失敗扱い', () => {
    const core = new TowerCore();
    core.engine.gravity.y = 0;
    drop(core, '山');
    expect(core.phase).toBe('over');
    expect(core.overReason).toBe('timeout');
  });

  it('ゲームオーバー後は新しいコアで即リトライできる', () => {
    const core = new TowerCore();
    drop(core, '木', 20);
    const next = new TowerCore();
    expect(next.phase).toBe('aim');
    expect(next.used.size).toBe(0);
    runUntilSettled(next);
  });
});
