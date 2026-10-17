// BGM・効果音の再生（音源は「かなでる」で作成した public/audio/*.mp3、元データは audio-src/）
const SE_NAMES = [
  'se_land',
  'se_heavy',
  'se_drop',
  'se_settle',
  'se_rotate',
  'se_tap',
  'se_error',
  'se_collapse',
  'se_record',
  'se_start',
  'gameover',
] as const;
type SeName = (typeof SE_NAMES)[number];

/** 素材ごとの音量バランス（ラウドネスの差をならす） */
const SE_GAIN: Record<SeName, number> = {
  se_land: 0.9,
  se_heavy: 0.9,
  se_drop: 0.55,
  se_settle: 0.4,
  se_rotate: 0.5,
  se_tap: 0.5,
  se_error: 0.4,
  se_collapse: 0.9,
  se_record: 0.45,
  se_start: 0.45,
  gameover: 0.6,
};

/** BGM のループ長（24小節 @ 88BPM）。MP3 の末尾の余りを使わず、ここで折り返す */
const BGM_LOOP = (24 * 4 * 60) / 88;
const BGM_VOLUME = 0.45;

export class Sound {
  private ctx: AudioContext | null = null;
  private seBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private bgmSrc: AudioBufferSourceNode | null = null;
  private bgmWanted = false;
  private lastImpact = 0;
  seOn = true;
  bgmOn = true;

  constructor(private base: string) {}

  /** 読み込み済みの音源数（テスト用） */
  get loaded(): number {
    return this.buffers.size;
  }

  get bgmPlaying(): boolean {
    return !!this.bgmSrc;
  }

  private ac(): AudioContext | null {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.seBus = this.ctx.createGain();
        this.bgmBus = this.ctx.createGain();
        this.seBus.connect(this.ctx.destination);
        this.bgmBus.connect(this.ctx.destination);
        this.bgmBus.gain.value = BGM_VOLUME;
      }
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** ユーザー操作時に呼ぶ（ブラウザの自動再生制限の解除＋音源の読み込み開始） */
  unlock() {
    const ac = this.ac();
    if (!ac || this.loading) return;
    this.loading = Promise.all(
      ['bgm', ...SE_NAMES].map(async (name) => {
        try {
          const res = await fetch(`${this.base}audio/${name}.mp3`);
          const buf = await ac.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
          if (name === 'bgm' && this.bgmWanted) this.startBgm();
        } catch {
          /* 読み込めない音は鳴らさないだけでゲームは続行 */
        }
      }),
    ).then(() => undefined);
  }

  private play(name: SeName, gain = 1, rate = 1) {
    if (!this.seOn) return;
    const ac = this.ac();
    const buf = this.buffers.get(name);
    if (!ac || !buf || !this.seBus) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = SE_GAIN[name] * gain;
    src.connect(g).connect(this.seBus);
    src.start();
  }

  // ---- BGM ----
  bgm(on: boolean) {
    this.bgmWanted = on;
    if (on) this.startBgm();
    else this.stopBgm();
  }

  private startBgm() {
    if (!this.bgmOn || this.bgmSrc) return;
    const ac = this.ac();
    const buf = this.buffers.get('bgm');
    if (!ac || !buf || !this.bgmBus) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = Math.min(BGM_LOOP, buf.duration);
    src.connect(this.bgmBus);
    this.bgmBus.gain.cancelScheduledValues(ac.currentTime);
    this.bgmBus.gain.setValueAtTime(0, ac.currentTime);
    this.bgmBus.gain.linearRampToValueAtTime(BGM_VOLUME, ac.currentTime + 1.2);
    src.start();
    this.bgmSrc = src;
  }

  private stopBgm(fade = 0.6) {
    const src = this.bgmSrc;
    if (!src || !this.ctx || !this.bgmBus) return;
    this.bgmSrc = null;
    const t = this.ctx.currentTime;
    this.bgmBus.gain.cancelScheduledValues(t);
    this.bgmBus.gain.setValueAtTime(this.bgmBus.gain.value, t);
    this.bgmBus.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.05);
  }

  setBgmEnabled(on: boolean) {
    this.bgmOn = on;
    if (!on) this.stopBgm(0.2);
    else if (this.bgmWanted) this.startBgm();
  }

  /** タブ非表示中は音を止める */
  pause(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ---- 効果音 ----
  impact(strength: number) {
    const now = performance.now();
    if (now - this.lastImpact < 70) return;
    this.lastImpact = now;
    const v = Math.min(1, 0.25 + strength * 0.12);
    const rate = 0.9 + Math.random() * 0.2;
    if (strength > 5) this.play('se_heavy', v, rate);
    else this.play('se_land', v, rate);
  }

  drop() {
    this.play('se_drop', 1, 0.95 + Math.random() * 0.1);
  }

  settle() {
    this.play('se_settle');
  }

  rotate() {
    this.play('se_rotate', 1, 0.95 + Math.random() * 0.1);
  }

  tap() {
    this.play('se_tap');
  }

  error() {
    this.play('se_error');
  }

  record() {
    this.play('se_record');
  }

  start() {
    this.play('se_start');
  }

  collapse() {
    this.stopBgm(0.4);
    this.play('se_collapse');
  }

  gameOver() {
    this.play('gameover');
  }
}
