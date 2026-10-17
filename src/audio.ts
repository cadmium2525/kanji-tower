// Web Audio による合成効果音（音源ファイル不要）
export class Sfx {
  private ctx: AudioContext | null = null;
  private lastImpact = 0;
  muted = false;

  private ac(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** ユーザー操作時に呼んで AudioContext を有効化 */
  unlock() {
    this.ac();
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 1) {
    const ac = this.ac();
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number) {
    const ac = this.ac();
    if (!ac) return;
    const t = ac.currentTime;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t);
  }

  impact(strength: number) {
    const now = performance.now();
    if (now - this.lastImpact < 70) return;
    this.lastImpact = now;
    const v = Math.min(0.5, 0.06 + strength * 0.04);
    this.tone(140 + Math.random() * 40, 0.18, v, 'sine', 0.5);
    this.noise(0.08, v * 0.8, 900);
  }

  drop() {
    this.tone(520, 0.12, 0.08, 'triangle', 0.6);
  }

  settle() {
    this.tone(880, 0.25, 0.07, 'sine', 1);
    setTimeout(() => this.tone(1320, 0.3, 0.05, 'sine', 1), 70);
  }

  error() {
    this.tone(220, 0.15, 0.08, 'square', 0.9);
  }

  collapse() {
    this.noise(0.9, 0.35, 400);
    this.tone(200, 0.8, 0.15, 'sawtooth', 0.3);
  }
}
