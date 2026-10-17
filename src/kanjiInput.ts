// 入力文字の正規化と検証
export type InputResult =
  | { ok: true; char: string }
  | { ok: false; reason: 'empty' | 'multiple' | 'not-kanji' | 'variation' };

const HAN = /^[\p{Script=Han}々〆]$/u;
const VARIATION = /[︀-️\u{E0100}-\u{E01EF}\u{180B}-\u{180D}]/u;

export function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    return [...seg.segment(s)].map((x) => x.segment);
  }
  return [...s];
}

export function validateKanji(raw: string): InputResult {
  const s = raw.normalize('NFC').replace(/\s+/gu, '');
  if (!s) return { ok: false, reason: 'empty' };
  const g = graphemes(s);
  if (g.length !== 1) return { ok: false, reason: 'multiple' };
  if (VARIATION.test(s)) return { ok: false, reason: 'variation' };
  if (!HAN.test(s)) return { ok: false, reason: 'not-kanji' };
  return { ok: true, char: s };
}

export const INPUT_ERRORS: Record<string, string> = {
  empty: '漢字を1文字入力してください',
  multiple: '漢字は1文字だけ入力してください',
  'not-kanji': '漢字（1文字）を入力してください',
  variation: '異体字セレクタ付きの文字には未対応です',
  missing: 'この漢字はフォントに収録されていません',
  shape: 'この漢字の形状を作れませんでした',
  used: 'この漢字はもう使いました',
};
