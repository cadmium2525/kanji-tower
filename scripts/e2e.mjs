// ブラウザでの動作テスト（Playwright + Chromium）。`npm run build` 後に `npm run test:e2e`。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || 'screenshots';
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r, j) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && r());
  server.on('exit', () => j(new Error('preview server exited (port in use?)')));
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const launch = { executablePath: process.env.CHROMIUM || undefined };
launch.args = ['--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, executablePath: '/opt/pw-browsers/chromium' }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const BASE = `http://localhost:${PORT}/`;
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById('loadStatus').textContent === '', null, { timeout: 30000 });
await page.screenshot({ path: `${OUT}/01-title.png` });
await page.click('#btnSingle');
await page.waitForFunction(() => window.__kt.core);

await page.waitForFunction(() => window.__kt.sound.loaded === 12, null, { timeout: 20000 }).catch(() => {});
check('BGM・効果音を読み込む', await page.evaluate(() => window.__kt.sound.loaded === 12), `${await page.evaluate(() => window.__kt.sound.loaded)}/12`);
check('ゲーム開始でBGMが流れる', await page.evaluate(() => window.__kt.sound.bgmPlaying));

const phase = () => page.evaluate(() => window.__kt.core.phase);
async function waitAim(timeout = 20000) {
  await page.waitForFunction(() => window.__kt.core.phase !== 'falling', null, { timeout });
  return phase();
}
/** IME 確定を模擬して1文字入力 */
async function typeKanji(ch) {
  await page.evaluate((c) => {
    const el = document.getElementById('kanji');
    el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    el.value = c;
    el.dispatchEvent(new InputEvent('input', { data: c, isComposing: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: c }));
  }, ch);
}
async function dropAt(ch, x, rotSteps = 0) {
  await typeKanji(ch);
  await page.evaluate(([x, r]) => {
    const c = window.__kt.core;
    c.moveTo(x);
    c.rotate((r * Math.PI) / 12);
  }, [x, rotSteps]);
  await page.click('#btnDrop');
  return waitAim();
}

// 1. 入力検証
await typeKanji('あ');
check('ひらがなを拒否', await page.evaluate(() => window.__kt.core.preview === null && document.getElementById('kanji').classList.contains('invalid')));
await typeKanji('山川');
check('複数文字を拒否', await page.evaluate(() => window.__kt.core.preview === null));
await typeKanji('😀');
check('絵文字を拒否', await page.evaluate(() => window.__kt.core.preview === null));
await typeKanji('𠀋'); // サブセット外（欠字）
await page.click('#btnDrop');
check('フォント欠字を検知', (await page.textContent('#toast')).includes('収録されていません'));

// 2. 凹のくぼみに「一」以外の小さめの字が入る
await typeKanji('凹');
await page.screenshot({ path: `${OUT}/02-preview.png` });
check('凹 プレビュー', await page.evaluate(() => window.__kt.core.preview?.glyph.char === '凹'));
let p = await dropAt('凹', 300);
check('凹 が台に着地して安定', p === 'aim');
await page.screenshot({ path: `${OUT}/03-ou.png` });

// 3. 同じ字の再使用を拒否
await typeKanji('凹');
await page.click('#btnDrop');
check('同一漢字の再使用を拒否', (await page.textContent('#toast')).includes('もう使いました') && (await page.evaluate(() => window.__kt.core.bodies.length)) === 1);

// 凹のくぼみに、90°回転させた「一」（細い縦棒）を落とすと、くぼみの中まで沈む
const ou = await page.evaluate(() => {
  const b = window.__kt.core.bodies[0].body.bounds;
  return { top: b.min.y, cx: (b.min.x + b.max.x) / 2 };
});
p = await dropAt('一', ou.cx, 6);
const ichi = await page.evaluate(() => window.__kt.core.bodies[1].body.bounds.max.y);
check('凹のくぼみに他の字が入る', p === 'aim' && ichi > ou.top + 5, `凹上端=${ou.top.toFixed(1)} 一の下端=${ichi.toFixed(1)}`);
await page.screenshot({ path: `${OUT}/04-ou-hito.png` });

// 4. 代表文字を積む（新しいゲームで）
await page.click('#btnRetry');
check('リトライボタンで新規ゲーム', await page.evaluate(() => window.__kt.core.bodies.length === 0));
for (const [ch, x] of [['回', 300], ['田', 300], ['国', 300], ['山', 300], ['固', 300], ['龍', 300], ['森', 300]]) {
  p = await dropAt(ch, x);
  if (p === 'over') break;
}
const st = await page.evaluate(() => ({ h: window.__kt.core.bestHeight, n: window.__kt.core.placed, phase: window.__kt.core.phase }));
check('積み上げで高度が記録される', st.h > 150, `高さ=${(st.h / 100).toFixed(2)}m 文字数=${st.n} phase=${st.phase}`);
await page.screenshot({ path: `${OUT}/05-stack.png` });

// 5. ゲームオーバー：台の外に落とす
if (st.phase !== 'over') {
  await typeKanji('川');
  await page.evaluate(() => window.__kt.core.moveTo(20));
  await page.click('#btnDrop');
}
await page.waitForSelector('#over:not(.hidden)', { timeout: 20000 });
check('台から落ちるとゲームオーバー', true);
check('ゲームオーバーでBGMが止まる', await page.evaluate(() => !window.__kt.sound.bgmPlaying));
await page.screenshot({ path: `${OUT}/06-gameover.png` });

// 6. 結果画像PNG
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
await dl.saveAs(`${OUT}/07-result.png`);
check('結果PNGを保存できる', dl.suggestedFilename().endsWith('.png'));

// 7. 1タップでリトライ
await page.click('#btnAgain');
check('リトライでBGMが再開', await page.evaluate(() => window.__kt.sound.bgmPlaying));
check('1タップでリトライ', await page.evaluate(() => window.__kt.core.phase === 'aim' && window.__kt.core.bodies.length === 0 && document.getElementById('over').classList.contains('hidden')));

// 8. 自己ベストがリロード後も残る
await page.reload();
await page.waitForFunction(() => document.getElementById('loadStatus').textContent === '', null, { timeout: 30000 });
check('自己ベストがリロード後も残る', (await page.textContent('#titleBest')).includes('自己ベスト'));

// 9. PCキーボード操作（←→/Q/E/Space）
const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desk.goto(BASE);
await desk.waitForFunction(() => document.getElementById('loadStatus').textContent === '', null, { timeout: 30000 });
await desk.click('#btnSingle');
await desk.waitForFunction(() => window.__kt.core);
await desk.evaluate(() => {
  const el = document.getElementById('kanji');
  el.value = '木';
  el.dispatchEvent(new InputEvent('input', { data: '木' }));
});
await desk.keyboard.press('Escape');
const x0 = await desk.evaluate(() => window.__kt.core.previewX);
await desk.keyboard.down('ArrowRight');
await desk.waitForTimeout(400);
await desk.keyboard.up('ArrowRight');
await desk.keyboard.press('e');
await desk.keyboard.press('e');
const kb = await desk.evaluate(() => ({ x: window.__kt.core.previewX, a: window.__kt.core.previewAngle }));
check('キーボードで移動・回転', kb.x > x0 + 20 && Math.abs(kb.a - Math.PI / 6) < 1e-6, `dx=${(kb.x - x0).toFixed(0)} angle=${((kb.a * 180) / Math.PI).toFixed(0)}°`);
await desk.screenshot({ path: `${OUT}/08-desktop.png` });
await desk.keyboard.press('Space');
await desk.waitForFunction(() => window.__kt.core.phase !== 'falling', null, { timeout: 20000 });
check('Spaceで落下', await desk.evaluate(() => window.__kt.core.bodies.length === 1));

// 10. タブ非表示からの復帰・画面サイズ変更
await page.click('#btnSingle');
await page.waitForFunction(() => window.__kt.core);
await page.setViewportSize({ width: 700, height: 420 });
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.setViewportSize({ width: 390, height: 780 });
p = await dropAt('口', 300);
check('リサイズ・タブ復帰後も継続', p === 'aim');

check('ページエラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
