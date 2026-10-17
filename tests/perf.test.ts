import { expect, it } from 'vitest';
import Matter from 'matter-js';
import { TowerCore } from '../src/core';
import { createKanjiBody } from '../src/physics';
import { glyphs } from './helpers';

it('漢字30個が動いている状態でも1/60秒ぶんの物理計算が軽い', () => {
  const core = new TowerCore();
  // 何も落ちないよう広い床を足し、30文字を山積みにする（最悪ケース：全員が起きて接触中）
  Matter.Composite.add(core.engine.world, Matter.Bodies.rectangle(300, 50, 3000, 100, { isStatic: true }));
  const chars = [...'回田国固囲図園品龍森口日目困因団圧圏圓國圖團鬱囚四曜驚議護響'];
  chars.forEach((ch, i) => {
    const k = createKanjiBody(glyphs.get(ch)!, 150 + (i % 4) * 100, -150 - Math.floor(i / 4) * 110, i * 0.3);
    core.bodies.push(k);
    Matter.Composite.add(core.engine.world, k.body);
  });
  let worst = 0;
  let total = 0;
  for (let k = 0; k < 180; k++) {
    const t0 = performance.now();
    core.tick();
    const dt = performance.now() - t0;
    total += dt;
    worst = Math.max(worst, dt);
  }
  const parts = core.bodies.reduce((s, k) => s + k.body.parts.length - 1, 0);
  console.log(`bodies=${core.bodies.length} parts=${parts} avg=${(total / 180).toFixed(2)}ms worst=${worst.toFixed(2)}ms`);
  expect(total / 180).toBeLessThan(10);
});
