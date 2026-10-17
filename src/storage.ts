// localStorage への記録・設定保存（失敗してもプレイは継続）
export interface BestRecord {
  height: number; // m
  count: number;
  chars: string;
}

export interface Settings {
  bgm: boolean;
  se: boolean;
  reduceMotion: boolean;
  allowReuse: boolean;
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
  const saved = (read().settings ?? {}) as Partial<Settings> & { mute?: boolean; showHitbox?: boolean };
  // 旧版の「ミュート」設定を引き継ぐ
  const muted = saved.mute === true;
  return {
    bgm: saved.bgm ?? !muted,
    se: saved.se ?? !muted,
    reduceMotion: saved.reduceMotion ?? reduce,
    allowReuse: saved.allowReuse ?? false,
  };
}

export function saveSettings(s: Settings) {
  write({ ...read(), settings: s });
}

const NAME_KEY = 'kanjiTower.name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 保存できなくても登録は続行 */
  }
}
