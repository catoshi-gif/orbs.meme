export class ArenaAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private intensity = 0;
  private step = 0;
  private nextMusicStepTime = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.125;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 2.4;
      this.compressor.attack.value = 0.01;
      this.compressor.release.value = 0.2;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1.3;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);

      this.noiseBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.06), this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private chip(
    frequency: number,
    duration: number,
    gainValue: number,
    when = 0,
    type: OscillatorType = "square",
    octaveSparkle = false,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.003);
    gain.gain.setValueAtTime(gainValue * 0.82, now + Math.min(0.055, duration * 0.45));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);

    let sparkle: OscillatorNode | null = null;
    let sparkleGain: GainNode | null = null;
    if (octaveSparkle) {
      sparkle = ctx.createOscillator();
      sparkleGain = ctx.createGain();
      sparkle.type = "square";
      sparkle.frequency.setValueAtTime(frequency * 2, now);
      sparkleGain.gain.setValueAtTime(gainValue * 0.13, now);
      sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.72);
      sparkle.connect(sparkleGain);
      sparkleGain.connect(this.musicBus);
      sparkle.start(now);
      sparkle.stop(now + duration + 0.02);
    }

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      sparkle?.disconnect();
      sparkleGain?.disconnect();
    };
  }

  private chipBass(frequency: number, duration: number, gainValue: number, when = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(780, now);
    filter.Q.setValueAtTime(0.7, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  private arpeggio(frequencies: number[], duration: number, gainValue: number, when = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const slice = duration / frequencies.length;
    frequencies.forEach((frequency, index) => {
      const now = ctx.currentTime + when + index * slice;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + slice * 0.88);
      osc.connect(gain);
      gain.connect(this.musicBus!);
      osc.start(now);
      osc.stop(now + slice);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });
  }

  private kick(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(47, now + 0.085);
    gain.gain.setValueAtTime(0.055 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.12);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  private tick(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || !this.noiseBuffer) return;
    const now = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(5600, now);
    gain.gain.setValueAtTime(0.006 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    src.start(now);
    src.stop(now + 0.028);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
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

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer !== null) return;

    // Original arcade-chiptune Arena theme. Bright, playful and melodic,
    // inspired only by the broad 8-bit platform-game vocabulary.
    const semi = (n: number) => Math.pow(2, n / 12);
    const roots = [130.81, 146.83, 164.81, 146.83, 130.81, 174.61, 164.81, 146.83];

    // 8 bars A + 8 bars B. Sentinel -99 = rest.
    const melodyA = [
      0,4,7,-99, 12,7,4,-99, 2,5,9,-99, 7,5,2,-99,
      4,7,11,-99, 14,11,7,-99, 5,9,12,-99, 11,9,5,-99,
    ];
    const melodyB = [
      12,-99,9,7, 5,7,9,-99, 14,-99,11,9, 7,9,11,-99,
      16,14,12,-99, 9,12,14,-99, 11,9,7,5, 7,-99,12,-99,
    ];
    const bass = [0,-99,0,7, -99,0,5,-99, 0,-99,7,-99, 5,7,-99,0];
    const chordSets = [[0,4,7], [0,3,7], [0,5,9], [0,4,9]];

    const schedule = (globalStep: number, when: number) => {
      const phrase = globalStep % 256;
      const bar = Math.floor(phrase / 16);
      const s = phrase % 16;
      const sectionB = bar >= 8;
      const localBar = bar % 8;
      const root = roots[localBar]!;
      const melody = sectionB ? melodyB : melodyA;
      const melodicIndex = (localBar % 2) * 16 + s;
      const interval = melody[melodicIndex]!;

      if (s % 4 === 0) this.kick(when, sectionB ? 0.85 : 0.72);
      if ([2,6,10,14].includes(s)) this.tick(when + 0.006, sectionB ? 0.9 : 0.68);

      const bassInterval = bass[s]!;
      if (bassInterval > -90) {
        this.chipBass(root * 0.5 * semi(bassInterval), 0.105, 0.042, when);
      }

      // Fast broken chords are the harmonic "engine" and stay quieter than the tune.
      if (s === 0 || s === 8) {
        const intervals = chordSets[(localBar + (s === 8 ? 1 : 0)) % chordSets.length]!;
        const base = root;
        this.arpeggio(
          [base * semi(intervals[0]!), base * semi(intervals[1]!), base * semi(intervals[2]!), base * semi(intervals[1]!)],
          0.31,
          sectionB ? 0.012 : 0.010,
          when + 0.012,
        );
      }

      if (interval > -90) {
        const frequency = root * 2 * semi(interval);
        this.chip(frequency, sectionB ? 0.105 : 0.115, sectionB ? 0.036 : 0.032, when, "square", sectionB);
        // B-section gets harmony, not a volume jump.
        if (sectionB && [0,4,8,12].includes(s)) {
          this.chip(frequency * semi(-5), 0.09, 0.011, when + 0.008, "triangle");
        }
      }

      // Little end-of-section sparkle makes the form obvious without becoming noisy.
      if ((bar === 7 || bar === 15) && [12,14,15].includes(s)) {
        const lift = [12,16,19][[12,14,15].indexOf(s)]!;
        this.chip(root * 2 * semi(lift), 0.08, 0.022, when, "square", true);
      }
    };

    this.nextMusicStepTime = ctx.currentTime + 0.08;
    const pump = () => {
      const audio = this.ensure();
      if (!audio) return;
      const lookAhead = 0.2;
      while (this.nextMusicStepTime < audio.currentTime + lookAhead) {
        const bpm = 116 + this.intensity * 3;
        const sixteenth = 60 / bpm / 4;
        const when = Math.max(0, this.nextMusicStepTime - audio.currentTime);
        schedule(this.step, when);
        this.nextMusicStepTime += sixteenth;
        this.step += 1;
      }
    };

    pump();
    this.musicTimer = window.setInterval(pump, 45);
  }

  setIntensity(value: number) {
    this.intensity = Math.max(0, Math.min(1, value));
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
    [261.63, 329.63, 392, 523.25].forEach((f, i) => this.sfxTone(f, 0.45, 0.08, "triangle", i * 0.11));
  }

  stop() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.step = 0;
    this.nextMusicStepTime = 0;
  }
}
