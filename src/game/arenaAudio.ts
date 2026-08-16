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
      this.master.gain.value = 0.122;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -13;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 2.2;
      this.compressor.attack.value = 0.012;
      this.compressor.release.value = 0.26;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1.24;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);

      this.noiseBuffer = this.ctx.createBuffer(
        1,
        Math.max(1, Math.floor(this.ctx.sampleRate * 0.08)),
        this.ctx.sampleRate,
      );
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
    osc.detune.setValueAtTime(detune, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, duration));

    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.04);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private warmBass(frequency: number, duration: number, gainValue: number, when = 0, accent = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;

    const body = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    body.type = "triangle";
    sub.type = "sine";
    body.frequency.setValueAtTime(frequency, now);
    sub.frequency.setValueAtTime(frequency * 0.5, now);

    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.4, now);
    filter.frequency.setValueAtTime(720 + accent * 180, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue * accent, now + 0.009);
    gain.gain.setValueAtTime(gainValue * 0.82, now + Math.min(0.12, duration * 0.45));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    body.connect(filter);
    filter.connect(gain);
    sub.connect(gain);
    gain.connect(this.musicBus);

    body.start(now);
    sub.start(now);
    body.stop(now + duration + 0.04);
    sub.stop(now + duration + 0.04);
    body.onended = () => {
      body.disconnect();
      sub.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private velvetChord(frequencies: number[], duration: number, gainValue: number, when = 0, wide = false) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(0.7, now);
    filter.frequency.setValueAtTime(wide ? 2300 : 1750, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.028);
    gain.gain.setValueAtTime(gainValue * 0.84, now + duration * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const oscillators: OscillatorNode[] = [];
    for (const [index, frequency] of frequencies.entries()) {
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = index === 0 ? "triangle" : "sine";
      b.type = "triangle";
      a.frequency.setValueAtTime(frequency, now);
      b.frequency.setValueAtTime(frequency, now);
      a.detune.setValueAtTime(index % 2 === 0 ? -3 : 3, now);
      b.detune.setValueAtTime(index % 2 === 0 ? 5 : -5, now);
      a.connect(filter);
      b.connect(filter);
      a.start(now);
      b.start(now);
      a.stop(now + duration + 0.05);
      b.stop(now + duration + 0.05);
      oscillators.push(a, b);
    }

    filter.connect(gain);
    gain.connect(this.musicBus);

    oscillators[0]!.onended = () => {
      for (const osc of oscillators) osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private glassLead(frequency: number, duration: number, gainValue: number, when = 0, bright = false) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;

    const core = ctx.createOscillator();
    const shimmer = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    core.type = "triangle";
    shimmer.type = "square";
    core.frequency.setValueAtTime(frequency, now);
    shimmer.frequency.setValueAtTime(frequency * 2, now);
    shimmer.detune.setValueAtTime(4, now);

    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.15, now);
    filter.frequency.setValueAtTime(bright ? 2950 : 2200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.setValueAtTime(gainValue * 0.88, now + duration * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    core.connect(filter);
    shimmer.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);

    core.start(now);
    shimmer.start(now);
    core.stop(now + duration + 0.04);
    shimmer.stop(now + duration + 0.04);
    core.onended = () => {
      core.disconnect();
      shimmer.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private mutedPluck(frequency: number, duration: number, gainValue: number, when = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, now);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(0.9, now);
    filter.frequency.setValueAtTime(1250, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.03);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private kick(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(102, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075 * strength, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.18);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private hat(when = 0, strength = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || !this.noiseBuffer) return;
    const now = ctx.currentTime + when;

    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    src.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(6500, now);
    gain.gain.setValueAtTime(Math.max(0.0002, 0.008 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    src.start(now);
    src.stop(now + 0.04);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer !== null) return;

    // Arena Theme: warm electro-funk built to sit behind gameplay instead of fighting it.
    // 16 bars = 8-bar A section + 8-bar B section. B gets wider/brighter, not dramatically louder.
    const semitone = (n: number) => Math.pow(2, n / 12);
    const roots = [65.41, 65.41, 73.42, 58.27, 65.41, 82.41, 73.42, 58.27];

    const bassA = [0,-99,7,-99, 10,-99,7,-99, 0,-99,3,-99, 7,-99,10,-99];
    const bassB = [0,-99,7,10, -99,7,-99,3, 0,-99,10,-99, 7,3,-99,-99];

    const melodyA = [-99,12,-99,10, -99,7,10,-99, 12,-99,-99,7, 5,-99,7,-99];
    const melodyB = [12,-99,15,-99, 14,12,-99,10, -99,12,-99,7, 10,-99,5,-99];
    const answerA = [-99,-99,-99,3, -99,-99,5,-99, -99,-99,-99,7, -99,-99,5,-99];
    const answerB = [-99,-99,7,-99, -99,10,-99,-99, -99,-99,5,-99, -99,7,-99,-99];

    const chordA = [[0,3,7],[0,5,10],[0,3,10],[0,5,9]];
    const chordB = [[0,3,10],[0,5,10],[0,7,10],[0,5,9]];

    const scheduleStep = (globalStep: number, when: number) => {
      const phraseStep = globalStep % 256;
      const bar = Math.floor(phraseStep / 16);
      const step16 = phraseStep % 16;
      const sectionB = bar >= 8;
      const localBar = bar % 8;
      const root = roots[localBar]!;
      const energy = this.intensity;

      // Rhythm is deliberately restrained.
      if (step16 % 4 === 0) this.kick(when, sectionB ? 0.94 : 0.82);
      if ([2,6,10,14].includes(step16) && (sectionB || step16 === 6 || step16 === 14)) {
        this.hat(when + 0.008, 0.7 + energy * 0.12);
      }

      const bassPattern = sectionB ? bassB : bassA;
      const bassInterval = bassPattern[step16]!;
      if (bassInterval > -90) {
        const note = root * 0.5 * semitone(bassInterval);
        this.warmBass(note, sectionB ? 0.27 : 0.3, sectionB ? 0.055 : 0.052, when, [0,8].includes(step16) ? 1.08 : 0.94);
      }

      // Long, gentle chords keep the soundtrack harmonic and pleasant.
      if (step16 === 0 || step16 === 8) {
        const chordSet = sectionB ? chordB : chordA;
        const intervals = chordSet[(localBar + (step16 === 8 ? 1 : 0)) % chordSet.length]!;
        const base = root * 2;
        this.velvetChord(
          intervals.map(interval => base * semitone(interval)),
          0.78,
          sectionB ? 0.020 : 0.017,
          when,
          sectionB,
        );
      }

      const melody = sectionB ? melodyB : melodyA;
      const interval = melody[step16]!;
      if (interval > -90) {
        const frequency = root * 2 * semitone(interval);
        this.glassLead(frequency, sectionB ? 0.22 : 0.19, sectionB ? 0.036 : 0.031, when, sectionB);
      }

      // A quiet second voice answers the melody; this makes it funky without making it busy.
      const answer = sectionB ? answerB : answerA;
      const answerInterval = answer[step16]!;
      if (answerInterval > -90) {
        this.mutedPluck(root * 2 * semitone(answerInterval), 0.095, 0.014, when + 0.015);
      }

      // Tiny turnaround so the form feels intentional.
      if ((bar === 7 || bar === 15) && step16 === 14) {
        this.glassLead(root * 4 * semitone(10), 0.12, 0.023, when, true);
      }
    };

    this.nextMusicStepTime = ctx.currentTime + 0.08;

    const pump = () => {
      const audio = this.ensure();
      if (!audio) return;
      const lookAhead = 0.2;

      while (this.nextMusicStepTime < audio.currentTime + lookAhead) {
        // Almost no tempo change: intensity alters energy through brightness/density, not speed.
        const bpm = 100 + this.intensity * 2;
        const sixteenth = 60 / bpm / 4;
        const swing = this.step % 2 === 0 ? 1.12 : 0.88;
        const when = Math.max(0, this.nextMusicStepTime - audio.currentTime);

        scheduleStep(this.step, when);
        this.nextMusicStepTime += sixteenth * swing;
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
