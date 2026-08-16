export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicGain: GainNode | null = null;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      // SFX intentionally retain the compressed arcade character and sit clearly above the music during action.
      // 0.27 x 1.15 is ~1.69x (+4.6 dB) over the previous shared SFX path.
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.27;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 2.35;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.22;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1.15;
      this.sfxBus.connect(this.master);
    }

    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicElement) return;

    // The approved 48 kbps AAC render is already the finished music.
    // Route it around the SFX compressor so its dynamics/timbre remain untouched.
    const element = new Audio("/audio/arena-theme.m4a");
    element.loop = true;
    element.preload = "auto";
    element.setAttribute("playsinline", "");

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    // The approved track measures about -22.3 LUFS integrated / -6.3 dBFS peak.
    // 1.24x is 20% below the previous 1.55x playback gain: about -20.4 LUFS
    // with roughly 4.4 dB of peak headroom, leaving space for gameplay SFX.
    gain.gain.value = 1.24;

    source.connect(gain);
    gain.connect(ctx.destination);

    this.musicElement = element;
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
    this.sfxTone(58 + power * 48, 0.11, 0.105, "sine");
    this.sfxTone(145 + power * 110, 0.07, 0.055, "triangle", 0.012);
    if (power > 0.62) this.sfxTone(46, 0.16, 0.07, "square", 0.018);
  }

  jump() {
    this.sfxTone(118, 0.075, 0.07, "sine");
    this.sfxTone(248, 0.12, 0.04, "triangle", 0.018);
    this.sfxTone(420, 0.065, 0.024, "sine", 0.045);
  }

  powerPickup(kind: "superjump" | "blaster" | "superspeed" | "recovery") {
    const base = kind === "superjump" ? 285 : kind === "blaster" ? 205 : kind === "superspeed" ? 410 : 330;
    this.sfxTone(base, 0.09, 0.06, "triangle");
    this.sfxTone(base * 1.5, 0.16, 0.05, "sine", 0.045);
    this.sfxTone(base * 2, 0.2, 0.035, "triangle", 0.09);
  }

  powerUse(kind: "superjump" | "blaster" | "superspeed") {
    const base = kind === "superjump" ? 240 : kind === "blaster" ? 310 : 520;
    this.sfxTone(base, 0.14, 0.09, kind === "superspeed" ? "triangle" : "sawtooth");
    this.sfxTone(base * 2.2, 0.09, 0.05, "triangle", 0.012);
  }

  blasterShot() {
    this.sfxTone(430, 0.045, 0.0135, "square");
    this.sfxTone(185, 0.07, 0.0075, "triangle", 0.008);
  }

  recover() {
    this.sfxTone(330, 0.1, 0.05, "sine");
    this.sfxTone(440, 0.14, 0.045, "triangle", 0.06);
    this.sfxTone(660, 0.18, 0.04, "sine", 0.12);
  }

  eliminated() {
    this.sfxTone(180, 0.18, 0.08, "sawtooth");
    this.sfxTone(118, 0.28, 0.07, "triangle", 0.09);
  }

  victory() {
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
    this.musicElement = null;
    this.musicSource = null;
    this.musicGain = null;
  }

}
