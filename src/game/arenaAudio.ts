export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxOutput: GainNode | null = null;
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicGain: GainNode | null = null;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      // SFX are tiny synthesized transients, not mastered full-scale audio.
      // Give them substantial pre-gain so the compressor has real signal to work with,
      // then a modest makeup stage so they translate on phone speakers.
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.95;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.16;

      this.sfxOutput = this.ctx.createGain();
      this.sfxOutput.gain.value = 1.4;

      this.master.connect(this.compressor);
      this.compressor.connect(this.sfxOutput);
      this.sfxOutput.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1.3;
      this.sfxBus.connect(this.master);
    }

    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  preloadMusic() {
    if (typeof window === "undefined" || this.musicElement) return;
    const element = new Audio();
    element.src = "/audio/arena-theme.m4a";
    element.loop = true;
    element.preload = "auto";
    element.setAttribute("playsinline", "");
    element.load();
    this.musicElement = element;
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.preloadMusic();
    const element = this.musicElement;
    if (!element) return;
    if (this.musicSource) {
      void element.play().catch(() => undefined);
      return;
    }

    // The approved 48 kbps AAC render is already the finished music.
    // Route it around the SFX compressor so its dynamics/timbre remain untouched.
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    // The approved track measures about -22.3 LUFS integrated / -6.3 dBFS peak.
    // 1.24x is 20% below the previous 1.55x playback gain: about -20.4 LUFS
    // with roughly 4.4 dB of peak headroom, leaving space for gameplay SFX.
    gain.gain.value = 1.24;

    source.connect(gain);
    gain.connect(ctx.destination);

    this.musicSource = source;
    this.musicGain = gain;
    void element.play().catch(() => {
      // Mobile autoplay policies may defer playback until the next user gesture.
      // Gameplay remains completely independent of music availability.
    });
  }

  setIntensity(_value: number) {
    // The mastered track is intentionally played unchanged.
  }

  private duckMusic(level = 0.84, holdSeconds = 0.055, releaseSeconds = 0.12) {
    const ctx = this.ctx;
    const gain = this.musicGain;
    if (!ctx || !gain) return;

    const now = ctx.currentTime;
    const base = 1.24;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.linearRampToValueAtTime(base * level, now + 0.012);
    gain.gain.setValueAtTime(base * level, now + holdSeconds);
    gain.gain.linearRampToValueAtTime(base, now + holdSeconds + releaseSeconds);
  }

  private sfxTone(
    frequency: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = "sine",
    when = 0,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  bump(power = 0.6) {
    this.duckMusic(power > 0.62 ? 0.72 : 0.82, 0.055, 0.13);
    this.sfxTone(58 + power * 48, 0.11, 0.105, "sine");
    this.sfxTone(145 + power * 110, 0.07, 0.055, "triangle", 0.012);
    this.sfxTone(330 + power * 190, 0.052, 0.042, "square", 0.006);
    if (power > 0.62) this.sfxTone(92, 0.16, 0.07, "square", 0.018);
  }

  jump() {
    this.duckMusic(0.84, 0.045, 0.11);
    this.sfxTone(118, 0.075, 0.07, "sine");
    this.sfxTone(248, 0.12, 0.04, "triangle", 0.018);
    this.sfxTone(420, 0.065, 0.024, "sine", 0.045);
  }

  powerPickup(kind: "superjump" | "blaster" | "superspeed" | "cloak" | "bomb" | "recovery") {
    this.duckMusic(0.8, 0.07, 0.15);
    const base = kind === "superjump" ? 285 : kind === "blaster" ? 205 : kind === "superspeed" ? 410 : kind === "cloak" ? 360 : kind === "bomb" ? 155 : 330;
    this.sfxTone(base, 0.09, 0.06, "triangle");
    this.sfxTone(base * 1.5, 0.16, 0.05, "sine", 0.045);
    this.sfxTone(base * 2, 0.2, 0.035, "triangle", 0.09);
  }

  powerUse(kind: "superjump" | "blaster" | "superspeed" | "cloak" | "bomb") {
    this.duckMusic(0.78, 0.065, 0.14);
    const base = kind === "superjump" ? 240 : kind === "blaster" ? 310 : kind === "superspeed" ? 520 : kind === "cloak" ? 390 : 125;
    this.sfxTone(base, 0.14, 0.09, kind === "superspeed" || kind === "cloak" ? "triangle" : "sawtooth");
    this.sfxTone(base * 2.2, 0.09, 0.05, "triangle", 0.012);
  }

  blasterShot() {
    this.duckMusic(0.93, 0.018, 0.055);
    this.sfxTone(430, 0.045, 0.04, "square");
    this.sfxTone(185, 0.07, 0.022, "triangle", 0.008);
  }

  bombExplosion() {
    this.duckMusic(0.68, 0.11, 0.22);
    this.sfxTone(82, 0.24, 0.12, "sine");
    this.sfxTone(164, 0.12, 0.075, "square", 0.012);
    this.sfxTone(310, 0.08, 0.045, "triangle", 0.026);
  }

  recover() {
    this.duckMusic(0.8, 0.08, 0.16);
    this.sfxTone(330, 0.1, 0.05, "sine");
    this.sfxTone(440, 0.14, 0.045, "triangle", 0.06);
    this.sfxTone(660, 0.18, 0.04, "sine", 0.12);
  }

  eliminated() {
    this.duckMusic(0.7, 0.11, 0.2);
    this.sfxTone(180, 0.18, 0.08, "sawtooth");
    this.sfxTone(118, 0.28, 0.07, "triangle", 0.09);
  }

  fall() {
    this.duckMusic(0.76, 0.08, 0.18);
    this.sfxTone(132, 0.16, 0.055, "triangle");
    this.sfxTone(92, 0.28, 0.06, "sine", 0.06);
    this.sfxTone(65, 0.38, 0.045, "triangle", 0.14);
  }

  zap() {
    this.duckMusic(0.78, 0.06, 0.14);
    this.sfxTone(760, 0.045, 0.05, "square");
    this.sfxTone(1180, 0.035, 0.034, "square", 0.018);
    this.sfxTone(470, 0.08, 0.035, "triangle", 0.032);
  }

  victory() {
    this.duckMusic(0.68, 0.18, 0.28);
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => {
      this.sfxTone(frequency, 0.45, 0.08, "triangle", index * 0.11);
    });
  }

  stop() {
    if (this.musicElement) {
      this.musicElement.pause();
      this.musicElement.removeAttribute("src");
      this.musicElement.load();
    }
    this.musicSource?.disconnect();
    this.musicGain?.disconnect();

    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.compressor = null;
    this.sfxOutput = null;
    this.musicElement = null;
    this.musicSource = null;
    this.musicGain = null;
  }

}
