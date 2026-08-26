"use client";

export class RaceAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxOutput: GainNode | null = null;

  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicGain: GainNode | null = null;

  private started = false;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  private ensure() {
    if (typeof window === "undefined") return null;

    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;

      this.ctx = new Ctx();

      // Intentionally matches Arena's approved gameplay gain staging.
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
    element.src = "/audio/race-theme.m4a";
    element.loop = true;
    element.preload = "auto";
    element.setAttribute("playsinline", "");
    element.load();
    this.musicElement = element;
  }

  async start() {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;

    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.preloadMusic();

    if (!this.started) {
      this.started = true;

      // Very subtle velocity hum. It is routed through the same Arena-style SFX bus,
      // so it cannot sit above important gameplay feedback.
      const hum = ctx.createOscillator();
      const gain = ctx.createGain();
      hum.type = "sine";
      hum.frequency.value = 58;
      gain.gain.value = 0.0045;
      hum.connect(gain);
      gain.connect(this.sfxBus);
      hum.start();
      this.hum = hum;
      this.humGain = gain;
    }

    this.startMusic();
  }

  private startMusic() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.preloadMusic();

    const element = this.musicElement;
    if (!element) return;

    if (this.musicSource) {
      void element.play().catch(() => undefined);
      return;
    }

    // race-theme.m4a is mastered to the same ~-22.3 LUFS target as Arena.
    // Use Arena's exact playback gain and keep music outside the SFX compressor.
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 1.24;

    source.connect(gain);
    gain.connect(ctx.destination);

    this.musicSource = source;
    this.musicGain = gain;

    void element.play().catch(() => {
      // A browser may defer playback until a user gesture; race simulation is unaffected.
    });
  }

  setSpeed(speed: number) {
    if (!this.ctx || !this.hum || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.hum.frequency.setTargetAtTime(52 + Math.min(30, speed) * 1.8, t, 0.08);
    this.humGain.gain.setTargetAtTime(0.003 + Math.min(1, speed / 26) * 0.006, t, 0.08);
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
    endFrequency?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;

    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  jump() {
    // Same loudness envelope as Arena jump, with a slightly brighter racing pitch.
    this.duckMusic(0.84, 0.045, 0.11);
    this.sfxTone(150, 0.075, 0.07, "sine");
    this.sfxTone(330, 0.12, 0.04, "triangle", 0.018, 620);
    this.sfxTone(620, 0.065, 0.024, "sine", 0.045, 780);
  }

  landing(intensity = 0.6) {
    // Maze wall-thump tonal signature, reused for RACE road contact:
    // same sine wave, 112–138 Hz starting pitch, 62 Hz fall and 90 ms envelope.
    // The gain is compensated for RACE's louder Arena-style SFX chain so it
    // remains clearly tactile underneath the background music.
    const amount = Math.max(0, Math.min(1, intensity));
    this.duckMusic(0.80, 0.032, 0.10);
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(112 + amount * 26, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.075);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.027 + amount * 0.028, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.1);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  boost() {
    this.duckMusic(0.78, 0.065, 0.14);
    this.sfxTone(220, 0.14, 0.09, "sawtooth", 0, 760);
    this.sfxTone(520, 0.09, 0.05, "triangle", 0.012, 1040);
  }

  pickup() {
    this.duckMusic(0.8, 0.07, 0.15);
    this.sfxTone(330, 0.09, 0.06, "triangle");
    this.sfxTone(495, 0.16, 0.05, "sine", 0.045);
    this.sfxTone(660, 0.2, 0.035, "triangle", 0.09);
  }

  overtake() {
    this.duckMusic(0.93, 0.018, 0.055);
    this.sfxTone(720, 0.07, 0.035, "triangle");
    this.sfxTone(980, 0.09, 0.025, "sine", 0.025);
  }

  missile() {
    // Arena blaster-shot loudness.
    this.duckMusic(0.93, 0.018, 0.055);
    this.sfxTone(430, 0.045, 0.04, "square");
    this.sfxTone(185, 0.07, 0.022, "triangle", 0.008);
  }

  bomb() {
    // Deployment cue: intentionally quieter than the explosion.
    this.duckMusic(0.88, 0.035, 0.09);
    this.sfxTone(125, 0.12, 0.06, "sawtooth");
    this.sfxTone(275, 0.07, 0.03, "triangle", 0.018);
  }

  explosion() {
    // Exact Arena-style bomb explosion hierarchy.
    this.duckMusic(0.68, 0.11, 0.22);
    this.sfxTone(82, 0.24, 0.12, "sine");
    this.sfxTone(164, 0.12, 0.075, "square", 0.012);
    this.sfxTone(310, 0.08, 0.045, "triangle", 0.026);
  }

  turbo() {
    this.duckMusic(0.78, 0.065, 0.14);
    this.sfxTone(520, 0.14, 0.09, "triangle", 0, 920);
    this.sfxTone(1040, 0.09, 0.05, "triangle", 0.012, 1320);
  }

  hit() {
    this.duckMusic(0.82, 0.055, 0.13);
    this.sfxTone(88, 0.11, 0.105, "sine");
    this.sfxTone(210, 0.07, 0.055, "triangle", 0.012);
    this.sfxTone(420, 0.052, 0.042, "square", 0.006);
  }

  rescue() {
    this.duckMusic(0.8, 0.08, 0.16);
    this.sfxTone(330, 0.1, 0.05, "sine");
    this.sfxTone(440, 0.14, 0.045, "triangle", 0.06);
    this.sfxTone(660, 0.18, 0.04, "sine", 0.12);
  }

  lap() {
    this.duckMusic(0.76, 0.09, 0.18);
    this.sfxTone(440, 0.11, 0.055, "triangle");
    this.sfxTone(660, 0.16, 0.05, "triangle", 0.07);
    this.sfxTone(990, 0.22, 0.04, "sine", 0.15);
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

    try {
      this.hum?.stop();
    } catch {
      // Already stopped.
    }

    if (this.ctx) void this.ctx.close();

    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.compressor = null;
    this.sfxOutput = null;
    this.musicElement = null;
    this.musicSource = null;
    this.musicGain = null;
    this.hum = null;
    this.humGain = null;
    this.started = false;
  }
}
