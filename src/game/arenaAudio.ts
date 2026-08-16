export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicTimer: number | null = null;
  private intensity = 0;
  private step = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.09;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(frequency: number, duration: number, gainValue: number, type: OscillatorType = "sine", when = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  startMusic() {
    this.ensure();
    if (this.musicTimer !== null) return;
    const tick = () => {
      const roots = [110, 123.47, 146.83, 164.81];
      const root = roots[Math.floor(this.step / 8) % roots.length]!;
      const pattern = [1, 1.5, 2, 1.25, 1.5, 2.5, 2, 1.5];
      const note = root * pattern[this.step % pattern.length]!;
      this.tone(note, 0.12, 0.06 + this.intensity * 0.025, "triangle");
      if (this.step % 2 === 0) this.tone(root / 2, 0.16, 0.045, "sine");
      if (this.intensity > 0.46 && this.step % 2 === 1) this.tone(note * 2, 0.045, 0.025 + this.intensity * 0.02, "square");
      this.step += 1;
      const interval = Math.max(88, 245 - this.intensity * 135);
      this.musicTimer = window.setTimeout(tick, interval);
    };
    tick();
  }

  setIntensity(value: number) {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  bump(power = 0.6) {
    this.tone(72 + power * 54, 0.09, 0.09, "sine");
    this.tone(155 + power * 80, 0.055, 0.04, "triangle", 0.015);
  }

  eliminated() {
    this.tone(180, 0.18, 0.08, "sawtooth");
    this.tone(118, 0.28, 0.07, "triangle", 0.09);
  }

  victory() {
    [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, 0.45, 0.08, "triangle", i * 0.11));
  }

  stop() {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
}
