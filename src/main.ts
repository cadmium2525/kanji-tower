import './style.css';
import { loadFont, type GlyphSource } from './glyph';
import { TowerCore } from './core';
import { INPUT_ERRORS, validateKanji } from './kanjiInput';
import { drawBackground, drawKanji, drawPedestal, drawRuler, type Camera, type DrawItem } from './render';
import { transformedBounds, WORLD } from './physics';
import { Sound } from './audio';
import { loadBest, loadName, loadSettings, saveBest, saveName, saveSettings, type BestRecord, type Settings } from './storage';
import { cleanName, rankingFromEnv, type SubmitResult } from './ranking';
import { canvasToBlob, downloadBlob, drawTowerFit, renderResultImage, shareText } from './result';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- 状態 ----------
let glyphs: GlyphSource | null = null;
let fontPromise: Promise<GlyphSource> | null = null;
let core: TowerCore | null = null;
let settings: Settings = loadSettings();
let best: BestRecord | null = loadBest();
let bestSnapshot: DrawItem[] = [];
let composing = false;
let overTimer = 0;
let shake = 0;
let newRecordToasted = false;
const ranking = rankingFromEnv();
const sfx = new Sound(import.meta.env.BASE_URL);
sfx.seOn = settings.se;
sfx.bgmOn = settings.bgm;

const ROT_STEP = Math.PI / 12; // 15°
const MOVE_SPEED = 260; // 単位/秒
const held = { left: false, right: false, rotL: false, rotR: false };
let holdRotTimer = 0;

const cam: Camera = { x: 0, y: -600, scale: 1, w: 1, h: 1 };
let dpr = Math.min(2, window.devicePixelRatio || 1);
let dprLimit = 2;

const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;
const input = $<HTMLInputElement>('kanji');
const stage = $('stage');
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- フォント ----------
function ensureFont(): Promise<GlyphSource> {
  if (!fontPromise) {
    const status = $('loadStatus');
    fontPromise = loadFont(`${import.meta.env.BASE_URL}fonts/NotoSerifJP-Black-kanji.otf`, (r) => {
      status.textContent = `フォント読み込み中… ${Math.round(r * 100)}%`;
    })
      .then((g) => {
        glyphs = g;
        status.textContent = '';
        drawTitle();
        return g;
      })
      .catch((e) => {
        status.textContent = 'フォントを読み込めませんでした。再読み込みしてください。';
        fontPromise = null;
        throw e;
      });
  }
  return fontPromise;
}

// ---------- 画面遷移 ----------
function showScreen(id: 'title' | 'game') {
  $('title').classList.toggle('hidden', id !== 'title');
  $('game').classList.toggle('hidden', id !== 'game');
  if (id === 'title') {
    updateTitleBest();
    drawTitle();
  }
}

/** タイトル背景：空・富士山・台座と、積まれた漢字 */
function drawTitle() {
  const tc = $<HTMLCanvasElement>('titleCv');
  const r = tc.getBoundingClientRect();
  if (!r.width) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  tc.width = Math.round(r.width * d);
  tc.height = Math.round(r.height * d);
  const t = tc.getContext('2d')!;
  t.setTransform(d, 0, 0, d, 0, 0);
  const scale = r.width / WORLD.width;
  const c: Camera = { x: 0, y: WORLD.groundY - (r.height / scale) * 0.93, scale, w: r.width, h: r.height };
  drawBackground(t, c, 0, true, 0);
  t.save();
  t.scale(scale, scale);
  t.translate(-c.x, -c.y);
  drawPedestal(t);
  if (glyphs) {
    const stack: [string, number, number, number][] = [
      ['山', 255, -48, -0.05],
      ['田', 352, -50, 0.03],
      ['木', 300, -140, 0.12],
    ];
    for (const [ch, x, y, a] of stack) {
      const g = glyphs.get(ch);
      if (g) drawKanji(t, { glyph: g, com: { x: 50, y: 50 }, x, y, angle: a, outline: 'rgba(255,255,255,0.8)' }, scale);
    }
  }
  t.restore();
}

function updateTitleBest() {
  $('titleBest').textContent = best ? `👑 自己ベスト ${best.height.toFixed(1)}m（${best.count}文字）` : '';
}

async function startGame() {
  sfx.unlock();
  sfx.start();
  showScreen('game');
  resize();
  setStatus('フォント読み込み中…');
  try {
    await ensureFont();
  } catch {
    setStatus('フォントを読み込めませんでした');
    return;
  }
  newGame();
}

function newGame() {
  clearTimeout(overTimer);
  core = new TowerCore(
    {
      onSettle: onSettle,
      onGameOver: onGameOver,
      onImpact: (s) => {
        sfx.impact(s);
      },
    },
    { allowReuse: settings.allowReuse },
  );
  bestSnapshot = [];
  shake = 0;
  newRecordToasted = false;
  sfx.bgm(true);
  $('over').classList.add('hidden');
  input.value = '';
  input.classList.remove('invalid');
  cam.y = targetCamY();
  updateHud();
  updateUsed();
  setStatus('漢字を1文字入力してください');
  if (!coarse) input.focus();
}

// ---------- 入力 ----------
type InputErr = keyof typeof INPUT_ERRORS;

/** 入力欄の内容からプレビューを更新。問題があればエラーキーを返す */
function refreshPreview(): InputErr | null {
  if (!core || !glyphs || composing) return null;
  const v = input.value;
  if (!v.trim()) {
    core.setPreview(null);
    input.classList.remove('invalid');
    return 'empty';
  }
  const r = validateKanji(v);
  let err: InputErr | null = null;
  if (!r.ok) err = r.reason;
  else {
    try {
      const g = glyphs.get(r.char);
      if (!g) err = 'missing';
      else if (core.isUsed(r.char)) err = 'used';
      else core.setPreview(g);
    } catch {
      err = 'shape';
    }
  }
  if (err) core.setPreview(null);
  input.classList.toggle('invalid', !!err);
  return err;
}

function tryDrop() {
  sfx.unlock();
  if (!core) return;
  if (core.phase === 'over') return;
  if (core.phase === 'falling') {
    toast('落下中です。止まるまで待ってね', true);
    return;
  }
  const err = refreshPreview();
  if (err) {
    toast(INPUT_ERRORS[err]);
    sfx.error();
    return;
  }
  if (!core.drop()) return;
  sfx.drop();
  input.value = '';
  input.classList.remove('invalid');
  updateUsed();
  setStatus('落下中…');
  if (coarse) input.blur();
}

input.addEventListener('compositionstart', () => {
  composing = true;
});
input.addEventListener('compositionend', () => {
  composing = false;
  onInputChanged();
});
input.addEventListener('input', (e) => {
  if ((e as InputEvent).isComposing || composing) return;
  onInputChanged();
});
input.addEventListener('focus', () => input.select());

function onInputChanged() {
  const err = refreshPreview();
  if (core?.phase === 'aim') setStatus(core.preview ? '位置と角度を決めて「落とす」' : '漢字を1文字入力してください');
  if (err && err !== 'empty' && err !== 'multiple') toast(INPUT_ERRORS[err]);
  else hideToast();
}

// ---------- ボタン ----------
function bindHold(id: string, key: keyof typeof held, onTap: () => void) {
  const el = $(id);
  const release = () => {
    held[key] = false;
    el.classList.remove('held');
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 入力欄のフォーカス（キーボード）を維持
    sfx.unlock();
    el.setPointerCapture(e.pointerId);
    onTap();
    held[key] = true;
    holdRotTimer = 0;
    el.classList.add('held');
  });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHold('btnLeft', 'left', () => core?.move(-8));
bindHold('btnRight', 'right', () => core?.move(8));
bindHold('btnRotL', 'rotL', () => rotateStep(-1));
bindHold('btnRotR', 'rotR', () => rotateStep(1));

function rotateStep(dir: number) {
  if (!core || core.phase !== 'aim') return;
  core.rotate(dir * ROT_STEP);
  sfx.rotate();
}

const btnDrop = $('btnDrop');
btnDrop.addEventListener('pointerdown', (e) => e.preventDefault());
btnDrop.addEventListener('click', tryDrop);
$('btnRetry').addEventListener('pointerdown', (e) => e.preventDefault());
$('btnRetry').addEventListener('click', () => {
  sfx.tap();
  newGame();
});
$('btnAgain').addEventListener('click', () => {
  sfx.tap();
  newGame();
});
$('btnHome').addEventListener('click', () => {
  sfx.tap();
  sfx.bgm(false);
  clearTimeout(overTimer);
  core = null;
  showScreen('title');
});
$('btnToTitle').addEventListener('click', () => {
  sfx.tap();
  sfx.bgm(false);
  core = null;
  showScreen('title');
});
$('btnSingle').addEventListener('click', () => void startGame());
$('btnHowTo').addEventListener('click', () => {
  sfx.unlock();
  sfx.tap();
  $('howto').classList.remove('hidden');
});
$('btnRanking').addEventListener('click', () => {
  sfx.unlock();
  sfx.tap();
  void openRanking();
});
$('btnSettings').addEventListener('click', () => {
  sfx.unlock();
  sfx.tap();
  openSettings();
});
document.querySelectorAll('.overlay .close').forEach((b) =>
  b.addEventListener('click', () => {
    sfx.tap();
    (b.closest('.overlay') as HTMLElement).classList.add('hidden');
  }),
);

// ---------- 設定 ----------
const optMap: [string, keyof Settings][] = [
  ['optBgm', 'bgm'],
  ['optSe', 'se'],
  ['optMotion', 'reduceMotion'],
  ['optReuse', 'allowReuse'],
];
function openSettings() {
  for (const [id, k] of optMap) $<HTMLInputElement>(id).checked = settings[k];
  $('settings').classList.remove('hidden');
}
for (const [id, k] of optMap) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    settings = { ...settings, [k]: (e.target as HTMLInputElement).checked };
    sfx.seOn = settings.se;
    sfx.setBgmEnabled(settings.bgm);
    saveSettings(settings);
  });
}

// ---------- キーボード ----------
window.addEventListener('keydown', (e) => {
  if ($('game').classList.contains('hidden')) return;
  if (e.isComposing || e.keyCode === 229) return;
  const inInput = document.activeElement === input;
  if (!$('over').classList.contains('hidden')) {
    if (document.activeElement === $('rankName')) return;
    if (e.key === 'Enter' || e.key === 'r' || e.key === 'R' || e.key === ' ') {
      e.preventDefault();
      newGame();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (!held.left) core?.move(-8);
      held.left = true;
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (!held.right) core?.move(8);
      held.right = true;
      break;
    case 'Enter':
      e.preventDefault();
      tryDrop();
      break;
    case ' ':
      if (!inInput) {
        e.preventDefault();
        tryDrop();
      }
      break;
    case 'q':
    case 'Q':
      if (!inInput) rotateStep(-1);
      break;
    case 'e':
    case 'E':
      if (!inInput) rotateStep(1);
      break;
    case 'r':
    case 'R':
      if (!inInput) newGame();
      break;
    case 'Escape':
      input.blur();
      break;
    case 'Tab':
      break;
    default:
      if (!inInput && e.key.length === 1) input.focus();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') held.left = false;
  if (e.key === 'ArrowRight') held.right = false;
});
window.addEventListener('blur', () => {
  held.left = held.right = held.rotL = held.rotR = false;
  sfx.pause(document.hidden);
});

// ---------- ドラッグで移動 ----------
let dragX: number | null = null;
cv.addEventListener('pointerdown', (e) => {
  dragX = e.clientX;
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (dragX === null || !core) return;
  core.move((e.clientX - dragX) / cam.scale);
  dragX = e.clientX;
});
const endDrag = () => (dragX = null);
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- 進行イベント ----------
function onSettle(heightM: number) {
  if (!core) return;
  sfx.settle();
  updateHud();
  if (core.height >= (core.bestHeight || 0) - 1e-6) bestSnapshot = snapshot();
  if (best && heightM > best.height && !newRecordToasted) {
    newRecordToasted = true;
    toast('自己ベスト更新中！', true);
    sfx.record();
  }
  setStatus('次の漢字を入力して落とそう');
  if (input.value) onInputChanged();
}

function onGameOver(reason: 'fell' | 'timeout') {
  if (!core) return;
  sfx.collapse();
  if (!settings.reduceMotion) shake = 1;
  const c = core.fallen?.char ?? '';
  setStatus(reason === 'fell' ? `「${c}」が落ちた！` : `「${c}」が着地しなかった`);
  const g = core;
  overTimer = window.setTimeout(() => showGameOver(g, reason), 1300);
}

function snapshot(): DrawItem[] {
  if (!core) return [];
  return core.bodies.map((k) => ({
    glyph: k.glyph,
    com: k.com,
    x: k.body.position.x,
    y: k.body.position.y,
    angle: k.body.angle,
  }));
}

function showGameOver(g: TowerCore, reason: 'fell' | 'timeout') {
  if (g !== core) return;
  const height = g.bestHeight / 100;
  const chars = g.usedChars();
  let isNew = false;
  if (g.placed > 0 && (!best || height > best.height)) {
    best = { height, count: g.placed, chars: chars.join('') };
    saveBest(best);
    isNew = true;
  }
  const c = g.fallen?.char ?? '';
  $('overReason').textContent = reason === 'fell' ? `「${c}」が落ちてしまった…` : `「${c}」が着地しなかった…`;
  $('overHeight').textContent = height.toFixed(1);
  $('overCount').textContent = String(g.placed);
  $('overBest').textContent = (best?.height ?? 0).toFixed(1);
  $('overNew').classList.toggle('hidden', !isNew);
  setupRankBox(g);
  sfx.gameOver();
  $('overChars').textContent = chars.join(' ');
  const oc = $<HTMLCanvasElement>('overTower');
  const octx = oc.getContext('2d')!;
  octx.clearRect(0, 0, oc.width, oc.height);
  drawTowerFit(octx, bestSnapshot, 0, 0, oc.width, oc.height);
  $('over').classList.remove('hidden');
  $('btnAgain').focus();
  updateHud();
}

function resultData() {
  const g = core!;
  return {
    height: g.bestHeight / 100,
    count: g.placed,
    chars: g.usedChars(),
    tower: bestSnapshot,
    url: location.host + location.pathname.replace(/index\.html$/, ''),
  };
}

$('btnSave').addEventListener('click', async () => {
  if (!core) return;
  const blob = await canvasToBlob(renderResultImage(resultData()));
  downloadBlob(blob, `kanji-tower-${resultData().height.toFixed(1)}m.png`);
});

$('btnShare').addEventListener('click', async () => {
  if (!core) return;
  const d = resultData();
  const text = shareText(d);
  const blob = await canvasToBlob(renderResultImage(d));
  const file = new File([blob], 'kanji-tower.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  // 非対応環境：画像保存＋投稿文コピー
  downloadBlob(blob, 'kanji-tower.png');
  try {
    await navigator.clipboard.writeText(text);
    toast('画像を保存し、投稿文をコピーしました', true);
  } catch {
    toast('画像を保存しました', true);
  }
});

$('btnX').addEventListener('click', () => {
  if (!core) return;
  const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText(resultData()));
  window.open(url, '_blank', 'noopener');
});

// ---------- ランキング ----------
let rankTarget: { height: number; count: number; chars: string } | null = null;

function setupRankBox(g: TowerCore) {
  const box = $('rankBox');
  const show = !!ranking && g.placed > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  rankTarget = { height: g.bestHeight / 100, count: g.placed, chars: g.usedChars().join('') };
  $<HTMLInputElement>('rankName').value = loadName();
  $('rankMsg').textContent = '';
  $<HTMLButtonElement>('btnRankSubmit').disabled = false;
}

const RANK_MSG: Record<Exclude<SubmitResult, { ok: true }>['reason'], string> = {
  'not-better': '登録済みの記録の方が高いので、更新しませんでした',
  'too-soon': '少し待ってから、もう一度登録してください',
  network: '通信できませんでした。電波の良い所でもう一度どうぞ',
  disabled: 'ランキングは準備中です',
};

$('rankBox').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ranking || !rankTarget) return;
  const name = cleanName($<HTMLInputElement>('rankName').value);
  const msg = $('rankMsg');
  if (!name) {
    msg.textContent = '名前を入力してください';
    sfx.error();
    return;
  }
  saveName(name);
  const btn = $<HTMLButtonElement>('btnRankSubmit');
  btn.disabled = true;
  msg.textContent = '登録中…';
  const r = await ranking.submit(name, rankTarget.height, rankTarget.count, rankTarget.chars);
  if (r.ok) {
    msg.textContent = r.rank ? `世界 ${r.rank} 位に登録しました！` : '登録しました！';
    sfx.record();
  } else {
    msg.textContent = RANK_MSG[r.reason];
    btn.disabled = r.reason === 'not-better';
    if (r.reason !== 'not-better') sfx.error();
  }
});
$('btnRankView').addEventListener('click', () => {
  sfx.tap();
  void openRanking();
});

async function openRanking() {
  const list = $('rankList');
  $('ranking').classList.remove('hidden');
  const note = (t: string) => {
    list.textContent = '';
    const p = document.createElement('p');
    p.className = 'rank-empty';
    p.textContent = t;
    list.appendChild(p);
  };
  if (!ranking) return note('ランキングは準備中です');
  note('読み込み中…');
  try {
    const rows = await ranking.top(50);
    if (!rows.length) return note('まだ記録がありません。最初の登録者になろう！');
    list.textContent = '';
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (r.uid === ranking.uid ? ' me' : '');
      const cell = (cls: string, text: string) => {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = text;
        row.appendChild(el);
      };
      cell('no', String(i + 1));
      cell('nm', r.name);
      cell('ht', `${r.height.toFixed(1)} m`);
      cell('ch', `${r.count}文字　${r.chars}`);
      list.appendChild(row);
    });
  } catch {
    note('ランキングを読み込めませんでした');
  }
}

// ---------- HUD ----------
function updateHud() {
  $('hudHeight').textContent = ((core?.height ?? 0) / 100).toFixed(1);
  $('hudCount').textContent = String(core?.placed ?? 0);
  const b = Math.max(best?.height ?? 0, (core?.bestHeight ?? 0) / 100);
  $('hudBest').textContent = b.toFixed(1);
}

function updateUsed() {
  const el = $('used');
  el.textContent = '';
  for (const c of core?.usedChars() ?? []) {
    const s = document.createElement('span');
    s.textContent = c;
    el.appendChild(s);
  }
  el.scrollLeft = el.scrollWidth;
}

function setStatus(s: string) {
  $('status').textContent = s;
}

let toastTimer = 0;
function toast(msg: string, info = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('info', info);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
}
function hideToast() {
  $('toast').classList.remove('show');
}

// ---------- 描画ループ ----------
function resize() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(dprLimit, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  cam.w = r.width;
  cam.h = r.height;
  cam.scale = r.width / WORLD.width;
}
new ResizeObserver(resize).observe(stage);
new ResizeObserver(() => drawTitle()).observe($('title'));
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

function targetCamY(): number {
  const viewH = cam.h / cam.scale;
  const groundView = WORLD.groundY - viewH * 0.8;
  if (!core) return groundView;
  // HUDに隠れないよう、プレビューの上に余白を取る
  return Math.min(groundView, core.spawnY - 50 - 110 / cam.scale);
}

let last = performance.now();
let acc = 0;
let frameAvg = 16;
let slowFrames = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(250, now - last);
  last = now;
  if (document.hidden || $('game').classList.contains('hidden')) return;

  // 低性能端末では描画解像度を落とす（物理の固定更新は維持）
  frameAvg = frameAvg * 0.95 + dtMs * 0.05;
  if (frameAvg > 28 && dprLimit > 1) {
    if (++slowFrames > 120) {
      dprLimit = 1;
      resize();
    }
  } else slowFrames = 0;

  if (core) {
    const dt = dtMs / 1000;
    if (core.phase === 'aim') {
      if (held.left) core.move(-MOVE_SPEED * dt);
      if (held.right) core.move(MOVE_SPEED * dt);
      if (held.rotL || held.rotR) {
        holdRotTimer += dt;
        if (holdRotTimer > 0.3) core.rotate((held.rotR ? 1 : -1) * Math.PI * 0.8 * dt);
      }
    }
    acc += dtMs;
    let steps = 0;
    while (acc >= 1000 / 60 && steps < 5) {
      core.tick();
      acc -= 1000 / 60;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (core.phase !== 'falling') {
      const h = core.height;
      $('hudHeight').textContent = (h / 100).toFixed(1);
    }
  }
  cam.y += (targetCamY() - cam.y) * Math.min(1, dtMs / 160);
  draw(now);
}

function draw(now: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, cam, now, settings.reduceMotion);
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);
    shake = Math.max(0, shake - 0.02);
  }
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);
  drawPedestal(ctx);
  const bestUnits = Math.max(best?.height ?? 0, 0) * 100;
  drawRuler(ctx, cam, bestUnits);
  if (core) {
    for (const k of core.bodies) {
      drawKanji(
        ctx,
        {
          glyph: k.glyph,
          com: k.com,
          x: k.body.position.x,
          y: k.body.position.y,
          angle: k.body.angle,
          color: k === core.fallen ? '#b3261e' : '#1c1b22',
          outline: 'rgba(255,255,255,0.75)',
        },
        cam.scale,
      );
    }
    if (core.phase === 'aim') drawPreview(now);
  }
  ctx.restore();
}

function drawPreview(now: number) {
  if (!core) return;
  const s = cam.scale;
  if (core.preview) {
    const { glyph, com } = core.preview;
    const b = transformedBounds(glyph, com, core.previewX, core.spawnY, core.previewAngle);
    // 落下予告ガイド
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(b.minX, b.maxY, b.maxX - b.minX, WORLD.groundY - b.maxY);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([6 / s, 6 / s]);
    ctx.lineWidth = 1.5 / s;
    ctx.beginPath();
    ctx.moveTo(b.minX, b.maxY);
    ctx.lineTo(b.minX, WORLD.groundY);
    ctx.moveTo(b.maxX, b.maxY);
    ctx.lineTo(b.maxX, WORLD.groundY);
    ctx.stroke();
    ctx.restore();
    const pulse = settings.reduceMotion ? 0.75 : 0.65 + Math.sin(now / 250) * 0.12;
    drawKanji(
      ctx,
      {
        glyph,
        com,
        x: core.previewX,
        y: core.spawnY,
        angle: core.previewAngle,
        color: '#b3261e',
        alpha: pulse,
        outline: 'rgba(255,255,255,0.9)',
      },
      s,
    );
  } else {
    // 入力待ちの枠（100×100の論理文字枠）
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([8 / s, 6 / s]);
    ctx.lineWidth = 2 / s;
    ctx.translate(core.previewX, core.spawnY);
    ctx.rotate(core.previewAngle);
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeRect(-50, -50, 100, 100);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `bold ${15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('漢字を入力', 0, 0);
    ctx.restore();
  }
}

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
  held.left = held.right = held.rotL = held.rotR = false;
});

// 起動
updateTitleBest();
void ensureFont().catch(() => {});
requestAnimationFrame(frame);

// テスト用フック
(window as unknown as { __kt: unknown }).__kt = {
  get core() {
    return core;
  },
  get sound() {
    return sfx;
  },
  newGame,
};
