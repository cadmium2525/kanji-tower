// localStorage への記録・設定保存（失敗してもプレイは継続）
export interface BestRecord {
  height: number; // m
  count: number;
  chars: string;
}

export interface Settings {
  mute: boolean;
  reduceMotion: boolean;
  allowReuse: boolean;
  showHitbox: boolean;
}

const KEY = 'kanjiTower.v1';

interface Saved {
  best?: BestRecord;
  settings?: Partial<Settings>;
}

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Saved;
  } catch {
    return {};
  }
}

function write(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境でもゲームは続行 */
  }
}

export function loadBest(): BestRecord | null {
  return read().best ?? null;
}

export function saveBest(b: BestRecord) {
  write({ ...read(), best: b });
}

export function loadSettings(): Settings {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { mute: false, reduceMotion: reduce, allowReuse: false, showHitbox: false, ...read().settings };
}

export function saveSettings(s: Settings) {
  write({ ...read(), settings: s });
}
