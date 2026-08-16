export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private intensity = 0;
  private step = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.102;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.2;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      // Arena music is intentionally forward in the mix; gameplay SFX remain readable above it.
      this.musicBus.gain.value = 1.18;
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 2050;
      this.musicFilter.Q.value = 1.4;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.92;
      this.sfxBus.connect(this.master);

      // One reusable noise buffer for hats/percussion; no per-beat allocations.
      this.noiseBuffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * 0.08)), this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
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
    osc.stop(now + duration + 0.04);
  }

  private bassPluck(frequency: number, duration: number, gainValue: number, when = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    sub.type = "sine";
    osc.frequency.setValueAtTime(frequency, now);
    sub.frequency.setValueAtTime(frequency * 0.5, now);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(5.4, now);
    filter.frequency.setValueAtTime(920, now);
    filter.frequency.exponentialRampToValueAtTime(245, now + Math.max(0.07, duration * 0.82));

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    sub.connect(gain);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    sub.start(now);
    osc.stop(now + duration + 0.04);
    sub.stop(now + duration + 0.04);
  }

  private kick(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(126, now);
    osc.frequency.exponentialRampToValueAtTime(43, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.145 * strength, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private hat(when = 0, strength = 1, open = false) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || !this.noiseBuffer) return;
    const now = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(open ? 4800 : 6200, now);
    const duration = open ? 0.072 : 0.032;
    gain.gain.setValueAtTime(Math.max(0.0002, 0.016 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    src.start(now);
    src.stop(now + duration + 0.01);
  }

  private clap(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || !this.noiseBuffer) return;
    const now = ctx.currentTime + when;
    for (const offset of [0, 0.012, 0.025]) {
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.value = 1500;
      filter.Q.value = 0.7;
      const start = now + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.018 * strength, start + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.052);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      src.start(start);
      src.stop(start + 0.06);
    }
  }

  startMusic() {
    this.ensure();
    if (this.musicTimer !== null) return;

    // Original Orbs Arena score: slow, swung machine-funk with a rubbery filtered bass,
    // sparse crunchy digital hooks, and a 4-bar phrase so it breathes instead of looping constantly.
    const barRoots = [82.41, 82.41, 73.42, 92.5]; // E2, E2, D2, F#2
    const bassIntervals = [
      0, -99, 0, -99, 7, -99, 3, -99, 0, -99, 10, -99, 7, -99, 3, -99,
      0, -99, 12, -99, 7, -99, 3, -99, 0, -99, 10, -99, 5, -99, 7, -99,
      0, -99, 0, -99, 5, -99, 10, -99, 3, -99, 7, -99, 12, -99, 10, -99,
      0, -99, 7, -99, 3, -99, 10, -99, 0, -99, 12, -99, 7, -99, 3, -99,
    ];
    const hookIntervals = [
      -99, -99, 12, -99, -99, -99, 7, -99, -99, 10, -99, -99, 15, -99, -99, -99,
      -99, 12, -99, -99, 7, -99, -99, -99, 10, -99, 15, -99, -99, -99, 7, -99,
      -99, -99, 12, -99, 7, -99, -99, 10, -99, -99, 15, -99, 19, -99, -99, -99,
      12, -99, -99, 10, -99, 7, -99, -99, 3, -99, -99, 10, -99, -99, 7, -99,
    ];

    const semitone = (n: number) => Math.pow(2, n / 12);

    const tick = () => {
      const ctx = this.ensure();
      if (!ctx) return;

      const phraseStep = this.step % 64;
      const step16 = phraseStep % 16;
      const bar = Math.floor(phraseStep / 16);
      const root = barRoots[bar]!;
      const energy = this.intensity;

      if (this.musicFilter) {
        // Keep the opening warm/dark; let the machine brighten as the field thins.
        const cutoff = 1850 + energy * 2250;
        this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.12);
        this.musicFilter.Q.setTargetAtTime(1.35 + energy * 1.25, ctx.currentTime, 0.12);
      }

      // Heavy four-on-the-floor foundation with a little extra shove late in each phrase.
      if (step16 % 4 === 0) this.kick(0, 0.9 + energy * 0.16);
      if (phraseStep % 32 === 30 && energy > 0.45) this.kick(0.015, 0.42);

      // Backbeat plus swung hats supply the groove instead of constant melody.
      if (step16 === 4 || step16 === 12) this.clap(0, 0.82 + energy * 0.12);
      if (step16 % 4 === 2) this.hat(0.006, 0.82 + energy * 0.2, step16 === 14);
      if (energy > 0.58 && [3, 7, 11, 15].includes(step16)) this.hat(0.01, 0.46, false);

      // Filtered bass is the lead character. Notes are intentionally sparse and syncopated.
      const bassInterval = bassIntervals[phraseStep]!;
      if (bassInterval > -90) {
        const note = root * 0.5 * semitone(bassInterval);
        const accent = [0, 6, 10, 14].includes(step16) ? 1.12 : 0.94;
        this.bassPluck(note, 0.19 + energy * 0.025, (0.072 + energy * 0.009) * accent);
      }

      // Sparse digital answer phrase. It leaves entire beats empty so impacts and movement can breathe.
      const hookInterval = hookIntervals[phraseStep]!;
      if (hookInterval > -90) {
        const lead = root * 2 * semitone(hookInterval);
        this.tone(lead, 0.082, 0.028 + energy * 0.006, "square", 0, true, -5);
        this.tone(lead * 0.5, 0.095, 0.012, "triangle", 0.008, true, 4);
      }

      // Only the late game earns the brighter upper counter-line.
      if (energy > 0.72 && [6, 14].includes(step16)) {
        const upper = root * 4 * semitone(bar % 2 === 0 ? 7 : 10);
        this.tone(upper, 0.052, 0.012, "square", 0.012, true, 7);
      }

      this.step += 1;

      // Slow pocket: ~108 BPM opening, only rising to ~116 BPM in sudden death.
      // Alternating sixteenth durations create a gentle swing instead of a rigid machine-gun grid.
      const bpm = 108 + energy * 8;
      const sixteenthMs = 60_000 / bpm / 4;
      const swing = this.step % 2 === 0 ? 1.12 : 0.88;
      this.musicTimer = window.setTimeout(tick, Math.round(sixteenthMs * swing));
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
    this.compressor = null;
    this.noiseBuffer = null;
    this.step = 0;
  }
}
