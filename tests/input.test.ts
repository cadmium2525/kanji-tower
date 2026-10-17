import { describe, expect, it } from 'vitest';
import { validateKanji } from '../src/kanjiInput';

describe('validateKanji', () => {
  it('漢字1文字を受け付ける', () => {
    for (const c of ['一', '龍', '々', '𠮷']) expect(validateKanji(c)).toEqual({ ok: true, char: c });
  });
  it('前後の空白・改行を除去する', () => {
    expect(validateKanji(' 山\n')).toEqual({ ok: true, char: '山' });
  });
  it('NFC正規化する（互換漢字はそのまま）', () => {
    expect(validateKanji('木'.normalize('NFD'))).toEqual({ ok: true, char: '木' });
  });
  it('ひらがな・カタカナ・英数字・絵文字を拒否', () => {
    for (const c of ['あ', 'ア', 'a', '1', '😀', '！']) expect(validateKanji(c).ok).toBe(false);
  });
  it('複数文字を拒否', () => {
    expect(validateKanji('山川')).toEqual({ ok: false, reason: 'multiple' });
  });
  it('空入力', () => {
    expect(validateKanji('  ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('異体字セレクタ付きを拒否', () => {
    expect(validateKanji('葛\u{E0100}')).toEqual({ ok: false, reason: 'variation' });
  });
});
