// PV 用に、実際のゲーム画面をコマ送りで撮影する（1080×1920・30fps）。
// ゲームの時計（performance.now / requestAnimationFrame / setTimeout）を差し替え、1コマずつ進めて撮るので、
// 処理の重さに関係なくなめらかで、毎回同じ結果になる。
//   使い方: node pv/capture.mjs <出力フォルダ> <ゲームのURL>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] || 'pv/footage';
const URL = process.argv[3] || 'http://localhost:4179/';
const FPS = 30;
mkdirSync(OUT, { recursive: true });

const CLOCK = () => {
  let now = 0;
  let rafs = [];
  let timers = [];
  let tid = 1;
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    rafs.push(cb);
    return rafs.length;
  };
  window.setTimeout = (fn, ms = 0, ...a) => {
    const id = tid++;
    timers.push({ id, t: now + (Number(ms) || 0), fn: () => fn(...a) });
    return id;
  };
  window.clearTimeout = (id) => {
    timers = timers.filter((x) => x.id !== id);
  };
  window.__advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.t - b.t);
      const t = timers[0];
      if (!t || t.t > end) break;
      timers.shift();
      now = t.t;
      t.fn();
    }
    now = end;
    const list = rafs;
    rafs = [];
    list.forEach((cb) => cb(now));
  };
  // 条件を満たすまで高速に進める（撮影しない）
  window.__ff = (cond, maxMs = 30000) => {
    let t = 0;
    while (t < maxMs) {
      if (cond && new Function('return ' + cond)()) return t;
      window.__advance(1000 / 60);
      t += 1000 / 60;
    }
    return t;
  };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

async function session(name, seedBest, dry = false) {
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(CLOCK);
  if (seedBest)
    await ctx.addInitScript((b) => {
      localStorage.setItem('kanjiTower.v1', JSON.stringify({ best: b, settings: { bgm: false, se: false } }));
    }, seedBest);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById('loadStatus').textContent === '', null, { timeout: 60000 });
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  let frame = 0;
  const marks = {};
  const api = {
    page,
    /** sec 秒ぶん撮影 */
    async rec(sec) {
      const n = Math.round(sec * FPS);
      for (let i = 0; i < n; i++) {
        await page.evaluate((ms) => window.__advance(ms), 1000 / FPS);
        if (dry) frame++;
        else await page.screenshot({ path: `${dir}/${String(frame++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
      }
    },
    /** 条件まで撮影（最大 maxSec） */
    async recUntil(cond, maxSec = 20, after = 0) {
      for (let i = 0; i < maxSec * FPS; i++) {
        if (await page.evaluate((c) => new Function('return ' + c)(), cond)) break;
        await api.rec(1 / FPS);
      }
      if (after) await api.rec(after);
    },
    async ff(cond, maxMs) {
      return page.evaluate(([c, m]) => window.__ff(c, m), [cond, maxMs]);
    },
    mark(label) {
      marks[label] = +(frame / FPS).toFixed(3);
    },
    async type(ch) {
      await page.evaluate((c) => {
        const el = document.getElementById('kanji');
        el.focus();
        el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
        el.value = c;
        el.dispatchEvent(new InputEvent('input', { data: c, isComposing: true }));
        el.dispatchEvent(new CompositionEvent('compositionend', { data: c }));
      }, ch);
    },
    /** IME で変換中の表示（確定前）だけを見せる */
    async composing(text) {
      await page.evaluate((t) => {
        const el = document.getElementById('kanji');
        el.focus();
        el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
        el.value = t;
        el.dispatchEvent(new InputEvent('input', { data: t, isComposing: true }));
      }, text);
    },
    async dropAt(ch, x, angle = 0) {
      await api.type(ch);
      await page.evaluate(
        ([x, a]) => {
          const c = window.__kt.core;
          c.moveTo(x);
          c.previewAngle = 0;
          c.rotate(a);
        },
        [x, angle],
      );
      await page.click('#btnDrop');
    },
    async close() {
      if (dry) return ctx.close();
      const mp4 = `${OUT}/${name}.mp4`;
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', mp4]);
      writeFileSync(`${OUT}/${name}.marks.json`, JSON.stringify(marks, null, 1));
      console.log(name, (frame / FPS).toFixed(2) + 's', marks);
      await ctx.close();
    },
  };
  return api;
}

// ---- 1. メイン：積み上げ → 重い字で崩壊 → ゲームオーバー → ランキング登録 ----
const BASE = '回田国固囲図園品龍森';
async function mainScene(v, dry) {
  const s = await session('main', { height: 2.4, count: 3, chars: '山川口' }, dry);
  await s.page.click('#btnSingle');
  await s.ff('window.__kt.core && window.__kt.core.phase === "aim"', 5000);
  await s.page.evaluate(() => document.getElementById('kanji').blur());
  await s.rec(0.3);
  s.mark('stackStart');
  let i = 0;
  for (const ch of BASE) {
    s.mark('drop_' + ch);
    const off = i < v.calm ? 0 : (i % 2 ? v.amp : -v.amp);
    i++;
    await s.dropAt(ch, 300 + off);
    await s.recUntil('window.__kt.core.phase !== "falling"', 12, 0.25);
    if (await s.page.evaluate(() => window.__kt.core.phase === 'over')) break;
  }
  if (await s.page.evaluate(() => window.__kt.core.phase !== 'over')) {
    await s.close();
    return -1;
  }
  s.mark('collapse');
  const placed = await s.page.evaluate(() => window.__kt.core.placed);
  await s.rec(1.5);
  const fallen = await s.page.evaluate(() => window.__kt.core.bodies.filter((k) => k.body.position.y > -20).length);
  // 高く積んでから、たくさん落ちるほど迫力がある
  const score = fallen * 10 + placed;
  if (dry) {
    await s.close();
    return score;
  }
  await s.recUntil('!document.getElementById("over").classList.contains("hidden")', 6, 1.2);
  s.mark('overShown');
  await s.page.fill('#rankName', '漢字マスター');
  await s.rec(0.4);
  await s.page.click('#btnRankSubmit');
  await s.recUntil('/位に登録/.test(document.getElementById("rankMsg").textContent)', 10, 0.8);
  s.mark('registered');
  await s.page.click('#btnRankView');
  await s.recUntil('!!document.querySelector("#rankList .row")', 10, 1.5);
  s.mark('rankingShown');
  await s.close();
  return score;
}

const SCENES = (process.env.SCENES || 'main,input,title').split(',');
let best = { score: -1, v: null };
if (process.env.VARIANT) best = { score: 0, v: JSON.parse(process.env.VARIANT) };
else if (SCENES.includes('main'))
search: for (const calm of [3, 4, 5])
  for (const amp of [10, 16, 22, 28]) {
    const v = { calm, amp };
    const score = await mainScene(v, true);
    console.log('try', JSON.stringify(v), 'score', score);
    if (score > best.score) best = { score, v };
    if (score >= 46) break search;
  }
if (SCENES.includes('main')) {
  console.log('best', best);
  await mainScene(best.v, false);
}

// ---- 2. 入力：かな入力 → 変換 → プレビュー → 回転 → 落下 ----
if (SCENES.includes('input')) {
  const s = await session('input');
  await s.page.click('#btnSingle');
  await s.ff('window.__kt.core && window.__kt.core.phase === "aim"', 5000);
  await s.dropAt('山', 300);
  await s.ff('window.__kt.core.phase === "aim"', 15000);
  await s.page.evaluate(() => {
    const el = document.getElementById('kanji');
    el.value = '';
    el.blur();
  });
  await s.rec(0.3);
  s.mark('typing');
  for (const t of ['り', 'りゅ', 'りゅう']) {
    await s.composing(t);
    await s.rec(0.25);
  }
  s.mark('converted');
  await s.type('龍');
  await s.rec(0.6);
  s.mark('rotate');
  for (let i = 0; i < 2; i++) {
    await s.page.locator('#btnRotR').dispatchEvent('pointerdown', { pointerId: 2 });
    await s.rec(0.12);
    await s.page.locator('#btnRotR').dispatchEvent('pointerup', { pointerId: 2 });
    await s.rec(0.15);
  }
  s.mark('drop');
  await s.page.click('#btnDrop');
  await s.recUntil('window.__kt.core.phase !== "falling"', 8, 0.4);
  s.mark('end');
  await s.close();
}

// ---- 3. タイトル画面 ----
if (SCENES.includes('title')) {
  const s = await session('title');
  await s.rec(2.5);
  await s.close();
}

await browser.close();
