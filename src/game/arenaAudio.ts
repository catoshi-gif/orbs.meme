export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private intensity = 0;
  private step = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.085;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.78;
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 1550;
      this.musicFilter.Q.value = 1.15;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    frequency: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = "sine",
    when = 0,
    music = false,
    detune = 0,
  ) {
    const ctx = this.ensure();
    const destination = music ? this.musicBus : this.sfxBus;
    if (!ctx || !destination) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (detune) osc.detune.setValueAtTime(detune, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.025, duration));
    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.035);
  }

  private kick(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(118, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.115 * strength, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  startMusic() {
    this.ensure();
    if (this.musicTimer !== null) return;

    // Original Arena score: a gritty mechanical house pulse with tiny digital hooks.
    // It deliberately uses simple synthesis rather than sampling or reproducing any existing track.
    const roots = [82.41, 92.5, 110, 98];
    const leadPattern = [0, 7, 12, 7, 3, 10, 15, 10, 0, 7, 12, 19, 3, 10, 15, 12];
    const bassPattern = [0, 0, 7, 0, 3, 3, 10, 3, 0, 0, 7, 12, 3, 10, 3, 7];

    const semitone = (n: number) => Math.pow(2, n / 12);
    const tick = () => {
      const ctx = this.ensure();
      if (!ctx) return;
      const step16 = this.step % 16;
      const root = roots[Math.floor(this.step / 32) % roots.length]!;
      const energy = this.intensity;

      if (this.musicFilter) {
        const cutoff = 1250 + energy * 3700;
        this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.08);
        this.musicFilter.Q.setTargetAtTime(1.1 + energy * 2.1, ctx.currentTime, 0.08);
      }

      // Four-on-the-floor pulse. The final third of a match gets a slightly harder transient.
      if (step16 % 4 === 0) this.kick(0, 0.78 + energy * 0.24);

      // Rubbery mono bass: short enough to leave room for impacts and Blaster SFX.
      if ([0, 3, 6, 8, 11, 14].includes(step16)) {
        const bass = root * 0.5 * semitone(bassPattern[step16]!);
        this.tone(bass, 0.105, 0.05 + energy * 0.012, "sawtooth", 0, true);
        this.tone(bass * 0.5, 0.12, 0.018, "sine", 0, true);
      }

      // Small square-wave hook. Repetition makes it memorable; the note pattern is original.
      if (step16 % 2 === 0 || energy > 0.58) {
        const lead = root * 2 * semitone(leadPattern[step16]!);
        this.tone(lead, 0.052, 0.022 + energy * 0.012, "square", 0, true);
        if (energy > 0.72 && step16 % 2 === 0) {
          this.tone(lead * 2, 0.028, 0.009, "square", 0.008, true, 5);
        }
      }

      // A sparse syncopated metallic chirp enters only after the match develops.
      if (energy > 0.32 && [2, 7, 10, 15].includes(step16)) {
        const chirp = root * (energy > 0.74 ? 6 : 4);
        this.tone(chirp, 0.024, 0.009 + energy * 0.005, "triangle", 0, true);
      }

      this.step += 1;
      // 16th-note grid: ~122 BPM early, rising toward ~151 BPM in the endgame.
      const interval = Math.max(99, 123 - energy * 24);
      this.musicTimer = window.setTimeout(tick, interval);
    };

    tick();
  }

  setIntensity(value: number) {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  bump(power = 0.6) {
    this.tone(58 + power * 48, 0.11, 0.105, "sine");
    this.tone(145 + power * 110, 0.07, 0.055, "triangle", 0.012);
    if (power > 0.62) this.tone(46, 0.16, 0.07, "square", 0.018);
  }

  jump() {
    this.tone(118, 0.075, 0.07, "sine");
    this.tone(248, 0.12, 0.04, "triangle", 0.018);
    this.tone(420, 0.065, 0.024, "sine", 0.045);
  }

  powerPickup(kind: "superjump" | "blaster" | "superspeed" | "recovery") {
    const base = kind === "superjump" ? 285 : kind === "blaster" ? 205 : kind === "superspeed" ? 410 : 330;
    this.tone(base, 0.09, 0.06, "triangle");
    this.tone(base * 1.5, 0.16, 0.05, "sine", 0.045);
    this.tone(base * 2, 0.2, 0.035, "triangle", 0.09);
  }

  powerUse(kind: "superjump" | "blaster" | "superspeed") {
    const base = kind === "superjump" ? 240 : kind === "blaster" ? 310 : 520;
    this.tone(base, 0.14, 0.09, kind === "superspeed" ? "triangle" : "sawtooth");
    this.tone(base * 2.2, 0.09, 0.05, "triangle", 0.012);
  }

  blasterShot() {
    // Intentionally quiet so sustained automatic fire never overwhelms the score.
    this.tone(430, 0.045, 0.0135, "square");
    this.tone(185, 0.07, 0.0075, "triangle", 0.008);
  }

  recover() {
    this.tone(330, 0.1, 0.05, "sine");
    this.tone(440, 0.14, 0.045, "triangle", 0.06);
    this.tone(660, 0.18, 0.04, "sine", 0.12);
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
    this.musicBus = null;
    this.musicFilter = null;
    this.sfxBus = null;
    this.step = 0;
  }
}
