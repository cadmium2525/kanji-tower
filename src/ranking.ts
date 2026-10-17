// グローバルランキング（Firebase の匿名ログイン＋Firestore を REST API で利用。SDK 不要）
export interface RankingConfig {
  apiKey: string;
  projectId: string;
  /** エミュレーター（テスト用）: 例 "127.0.0.1"。指定すると本番ではなくローカルに接続 */
  emulatorHost?: string;
}

export interface RankEntry {
  uid: string;
  name: string;
  height: number;
  count: number;
  chars: string;
}

export type SubmitResult =
  | { ok: true; rank: number }
  | { ok: false; reason: 'not-better' | 'too-soon' | 'network' | 'disabled' };

const AUTH_KEY = 'kanjiTower.auth';

interface Auth {
  uid: string;
  idToken: string;
  refreshToken: string;
  expires: number;
}

type FsValue = { stringValue?: string; doubleValue?: number; integerValue?: string };

export class Ranking {
  private auth: Auth | null = null;
  private readonly authBase: string;
  private readonly tokenBase: string;
  private readonly docs: string;
  private readonly docName: string;

  constructor(private cfg: RankingConfig) {
    const emu = cfg.emulatorHost;
    this.authBase = emu ? `http://${emu}:9099/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
    this.tokenBase = emu ? `http://${emu}:9099/securetoken.googleapis.com` : 'https://securetoken.googleapis.com';
    const fs = emu ? `http://${emu}:8080` : 'https://firestore.googleapis.com';
    this.docName = `projects/${cfg.projectId}/databases/(default)/documents`;
    this.docs = `${fs}/v1/${this.docName}`;
    try {
      this.auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null') as Auth | null;
    } catch {
      this.auth = null;
    }
  }

  get uid(): string | null {
    return this.auth?.uid ?? null;
  }

  private saveAuth() {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.auth));
    } catch {
      /* 保存できなくても今回のプレイ中は使える */
    }
  }

  /** 匿名ログイン（初回のみ作成し、以後はトークンを更新して同じ ID を使う） */
  private async token(): Promise<Auth> {
    const now = Date.now();
    if (this.auth && this.auth.expires - 60_000 > now) return this.auth;
    if (this.auth) {
      const res = await fetch(`${this.tokenBase}/v1/token?key=${this.cfg.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.auth.refreshToken)}`,
      });
      if (res.ok) {
        const j = await res.json();
        this.auth = {
          uid: j.user_id,
          idToken: j.id_token,
          refreshToken: j.refresh_token,
          expires: now + Number(j.expires_in) * 1000,
        };
        this.saveAuth();
        return this.auth;
      }
    }
    const res = await fetch(`${this.authBase}/v1/accounts:signUp?key=${this.cfg.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) throw new Error('auth ' + res.status);
    const j = await res.json();
    this.auth = { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, expires: now + Number(j.expiresIn) * 1000 };
    this.saveAuth();
    return this.auth;
  }

  /** 上位 limit 件 */
  async top(limit = 50): Promise<RankEntry[]> {
    const res = await fetch(`${this.docs}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'scores' }],
          orderBy: [{ field: { fieldPath: 'height' }, direction: 'DESCENDING' }],
          limit,
        },
      }),
    });
    if (!res.ok) throw new Error('query ' + res.status);
    const rows = (await res.json()) as { document?: { name: string; fields: Record<string, FsValue> } }[];
    return rows.filter((r) => r.document).map((r) => toEntry(r.document!));
  }

  /** この高さより上にいる人数 + 1 */
  async rankOf(height: number): Promise<number> {
    const res = await fetch(`${this.docs}:runAggregationQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredAggregationQuery: {
          aggregations: [{ alias: 'n', count: {} }],
          structuredQuery: {
            from: [{ collectionId: 'scores' }],
            where: {
              fieldFilter: { field: { fieldPath: 'height' }, op: 'GREATER_THAN', value: { doubleValue: height } },
            },
          },
        },
      }),
    });
    if (!res.ok) throw new Error('count ' + res.status);
    const j = await res.json();
    const v = j[0]?.result?.aggregateFields?.n;
    return Number(v?.integerValue ?? 0) + 1;
  }

  /** 自分の登録済み記録（未登録なら null） */
  async mine(): Promise<RankEntry | null> {
    const a = this.auth;
    if (!a) return null;
    const res = await fetch(`${this.docs}/scores/${a.uid}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('get ' + res.status);
    return toEntry(await res.json());
  }

  /** 記録を登録（自己ベストを更新したときだけ受け付けられる） */
  async submit(name: string, height: number, count: number, chars: string): Promise<SubmitResult> {
    let a: Auth;
    try {
      a = await this.token();
    } catch {
      return { ok: false, reason: 'network' };
    }
    const h = Math.round(height * 100) / 100;
    const res = await fetch(`${this.docs}:commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.idToken}` },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${this.docName}/scores/${a.uid}`,
              fields: {
                name: { stringValue: name },
                height: { doubleValue: h },
                count: { integerValue: String(count) },
                chars: { stringValue: chars },
              },
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    });
    if (res.status === 403) {
      // ルールで拒否：記録が伸びていない、または連投
      const cur = await this.mine().catch(() => null);
      return { ok: false, reason: cur && cur.height >= h ? 'not-better' : 'too-soon' };
    }
    if (!res.ok) return { ok: false, reason: 'network' };
    try {
      return { ok: true, rank: await this.rankOf(h) };
    } catch {
      return { ok: true, rank: 0 };
    }
  }
}

function toEntry(doc: { name: string; fields: Record<string, FsValue> }): RankEntry {
  const f = doc.fields;
  return {
    uid: doc.name.split('/').pop()!,
    name: f.name?.stringValue ?? '',
    height: Number(f.height?.doubleValue ?? f.height?.integerValue ?? 0),
    count: Number(f.count?.integerValue ?? 0),
    chars: f.chars?.stringValue ?? '',
  };
}

/** 名前の正規化：空白をまとめ、制御文字を除き、12文字まで */
export function cleanName(raw: string): string {
  const s = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...s].slice(0, 12).join('');
}

/** ビルド時の環境変数から設定を作る。未設定ならランキングは無効 */
export function rankingFromEnv(): Ranking | null {
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (!apiKey || !projectId) return null;
  return new Ranking({ apiKey, projectId, emulatorHost: (env.VITE_FIREBASE_EMULATOR as string) || undefined });
}
