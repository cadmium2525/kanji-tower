// Firestore / Auth エミュレーターを使ったランキングとセキュリティルールのテスト。
//   npm run test:ranking   （firebase-tools が必要）
import { describe, expect, it } from 'vitest';
import { cleanName, Ranking } from '../src/ranking';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-kanji';
const mk = () => new Ranking({ apiKey: 'demo-key', projectId: PROJECT, emulatorHost: '127.0.0.1' });

/** ルールを素通りさせない生の書き込み（不正なデータが拒否されるかの確認用） */
async function rawWrite(r: Ranking, uid: string | null, fields: Record<string, unknown>) {
  const a = await (r as unknown as { token(): Promise<{ uid: string; idToken: string }> }).token();
  const doc = `projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(`http://127.0.0.1:8080/v1/${doc}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.idToken}` },
    body: JSON.stringify({
      writes: [
        {
          update: { name: `${doc}/scores/${uid ?? a.uid}`, fields },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
    }),
  });
  return res.status;
}
const F = (name: string, height: number, count: number, chars: string) => ({
  name: { stringValue: name },
  height: { doubleValue: height },
  count: { integerValue: String(count) },
  chars: { stringValue: chars },
});

describe.skipIf(!EMU)('グローバルランキング（エミュレーター）', () => {
  const a = mk();
  const b = mk();

  it('初回登録できて1位になる（日本語12文字の名前）', async () => {
    expect(await a.top()).toEqual([]);
    const r = await a.submit('漢字タワー名人あいうえお', 3.21, 5, '回田国山固');
    expect(r).toEqual({ ok: true, rank: 1 });
    const mine = await a.mine();
    expect(mine).toMatchObject({ name: '漢字タワー名人あいうえお', height: 3.21, count: 5 });
  });

  it('自己ベストより低い記録は受け付けない', async () => {
    expect(await a.submit('名人', 2.5, 4, '回田国山')).toEqual({ ok: false, reason: 'not-better' });
  });

  it('10秒以内の連続更新は受け付けない', async () => {
    expect(await a.submit('名人', 4.0, 6, '回田国山固龍')).toEqual({ ok: false, reason: 'too-soon' });
  });

  it('他の人が上回ると順位が下がり、上位一覧は高い順', async () => {
    expect(await b.submit('ライバル', 5.5, 8, '一二三四五六七八')).toEqual({ ok: true, rank: 1 });
    expect(await a.rankOf(3.21)).toBe(2);
    const top = await a.top();
    expect(top.map((e) => e.name)).toEqual(['ライバル', '漢字タワー名人あいうえお']);
    expect(top[0].uid).toBe(b.uid);
  });

  it('不正なデータはルールで拒否される', async () => {
    const c = mk();
    expect(await rawWrite(c, null, F('ずる', 50, 3, '山川口'))).toBe(403); // 1文字あたり1.5m超
    expect(await rawWrite(c, null, F('あいうえおかきくけこさしす', 1, 1, '山'))).toBe(403); // 名前13文字
    expect(await rawWrite(c, null, F('', 1, 1, '山'))).toBe(403); // 名前なし
    expect(await rawWrite(c, null, F('ずる', 1, 3, '山'))).toBe(403); // 使用漢字が文字数より少ない
    expect(await rawWrite(c, a.uid, F('なりすまし', 9, 9, '一二三四五六七八九'))).toBe(403); // 他人の記録
    expect(await rawWrite(c, null, { ...F('ずる', 1, 1, '山'), admin: { stringValue: 'x' } })).toBe(403); // 余計な項目
    expect(await rawWrite(c, null, F('ふつう', 1.2, 1, '山'))).toBe(200); // 正常
  });
});

describe('cleanName', () => {
  it('空白・制御文字を整理し12文字に切る', () => {
    expect(cleanName('  漢字​  タワー\n')).toBe('漢字 タワー');
    expect(cleanName('あいうえおかきくけこさしすせそ')).toBe('あいうえおかきくけこさし');
  });
});
