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
  private nextMusicStepTime = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      this.master = this.ctx.createGain();
      // Slightly louder than V2, but with extra headroom so the score stays clean during firefights.
      this.master.gain.value = 0.116;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -10;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 2.6;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      // Forward enough to feel like a real soundtrack, while the compressor keeps weapon SFX readable.
      this.musicBus.gain.value = 1.28;
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
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
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
    osc.onended = () => { osc.disconnect(); sub.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  private wahLead(frequency: number, duration: number, gainValue: number, when = 0, accent = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const edge = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    // An original, vocal-ish digital lead: square/saw harmonics through a fast resonant filter sweep.
    // This recreates the *kind* of wah articulation we want without reproducing an existing riff.
    osc.type = "square";
    edge.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, now);
    edge.frequency.setValueAtTime(frequency * 0.5, now);
    edge.detune.setValueAtTime(7, now);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(8.2 + accent * 1.5, now);
    const open = 1250 + accent * 900;
    filter.frequency.setValueAtTime(330, now);
    filter.frequency.exponentialRampToValueAtTime(open, now + duration * 0.32);
    filter.frequency.exponentialRampToValueAtTime(520, now + duration * 0.92);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.006);
    gain.gain.setValueAtTime(gainValue * 0.9, now + duration * 0.58);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    edge.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    edge.start(now);
    osc.stop(now + duration + 0.03);
    edge.stop(now + duration + 0.03);
    osc.onended = () => { osc.disconnect(); edge.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  private acidBass(frequency: number, duration: number, gainValue: number, when = 0, accent = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, now);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(6.4 + accent * 1.4, now);
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(760 + accent * 420, now + 0.035);
    filter.frequency.exponentialRampToValueAtTime(235, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue * accent, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.03);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
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
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
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
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
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
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer !== null) return;

    // Original Arena score with real sections: an 8-bar verse and an 8-bar chorus.
    // The hook uses a resonant filter envelope to create a vocal "wah" articulation, while
    // the arrangement stays intentionally slower and roomier than the previous chiptune loop.
    const roots = [73.42, 73.42, 65.41, 82.41, 73.42, 73.42, 87.31, 82.41]; // original D/C/E/F-centered cycle
    const verseBass = [0,-99,-99,0, 7,-99,3,-99, 0,-99,10,-99, 7,-99,3,-99];
    const chorusBass = [0,-99,0,-99, 7,-99,10,-99, 0,3,-99,7, 12,-99,10,-99];
    const wahA = [-99,-99,12,-99, 15,-99,10,-99, -99,7,-99,10, 12,-99,-99,-99];
    const wahB = [-99,10,-99,12, -99,7,-99,-99, 15,-99,12,-99, 10,-99,7,-99];
    const semitone = (n: number) => Math.pow(2, n / 12);

    const scheduleStep = (globalStep: number, when: number) => {
      const phraseStep = globalStep % 256; // sixteen bars
      const bar = Math.floor(phraseStep / 16);
      const step16 = phraseStep % 16;
      const chorus = bar >= 8;
      const localBar = bar % 8;
      const root = roots[localBar]!;
      const energy = this.intensity;

      if (this.musicFilter) {
        const cutoff = (chorus ? 3100 : 2450) + energy * 1250;
        this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime + Math.max(0, when), 0.08);
        this.musicFilter.Q.setTargetAtTime(1.05 + energy * 0.75, ctx.currentTime + Math.max(0, when), 0.08);
      }

      // Slow four-on-the-floor pocket. Chorus gains an extra ghost kick rather than just speeding up.
      if (step16 % 4 === 0) this.kick(when, chorus ? 1.02 : 0.92);
      if (chorus && step16 === 14) this.kick(when + 0.012, 0.38 + energy * 0.08);
      if (step16 === 4 || step16 === 12) this.clap(when, chorus ? 0.92 : 0.76);
      if ([2,6,10,14].includes(step16)) this.hat(when + 0.008, chorus ? 0.92 : 0.68, chorus && step16 === 14);
      if (chorus && energy > 0.48 && [3,7,11,15].includes(step16)) this.hat(when + 0.012, 0.36, false);

      const bassPattern = chorus ? chorusBass : verseBass;
      const bassInterval = bassPattern[step16]!;
      if (bassInterval > -90) {
        const note = root * 0.5 * semitone(bassInterval);
        const accent = [0,8,12].includes(step16) ? 1.12 : 0.92;
        this.acidBass(note, chorus ? 0.22 : 0.25, chorus ? 0.064 : 0.058, when, accent);
      }

      // Verse: the wah hook appears as a restrained call every other bar.
      // Chorus: it becomes the memorable lead and answers itself with a second phrase.
      const motif = localBar % 2 === 0 ? wahA : wahB;
      const hookInterval = motif[step16]!;
      const playVerseHook = !chorus && localBar % 2 === 1;
      if ((chorus || playVerseHook) && hookInterval > -90) {
        const lead = root * 2 * semitone(hookInterval);
        this.wahLead(lead, chorus ? 0.19 : 0.16, chorus ? 0.046 : 0.034, when, chorus ? 1.0 : 0.62);
      }

      // Chorus response: a tiny octave punctuation, deliberately not a continuous melody.
      if (chorus && [7,15].includes(step16)) {
        const answer = root * 4 * semitone(localBar % 2 === 0 ? 7 : 5);
        this.tone(answer, 0.07, 0.012 + energy * 0.003, "triangle", when + 0.018, true, 5);
      }
    };

    this.nextMusicStepTime = ctx.currentTime + 0.08;
    const pump = () => {
      const audio = this.ensure();
      if (!audio) return;
      const lookAhead = 0.18;
      while (this.nextMusicStepTime < audio.currentTime + lookAhead) {
        const energy = this.intensity;
        // A relaxed 106 BPM base with only a subtle late-game lift; groove comes from swing, not speed.
        const bpm = 106 + energy * 5;
        const sixteenth = 60 / bpm / 4;
        const swing = this.step % 2 === 0 ? 1.11 : 0.89;
        const when = Math.max(0, this.nextMusicStepTime - audio.currentTime);
        scheduleStep(this.step, when);
        this.nextMusicStepTime += sixteenth * swing;
        this.step += 1;
      }
    };

    pump();
    // AudioContext-time scheduling avoids main-thread timer jitter/crackle during long matches.
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
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
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
    this.nextMusicStepTime = 0;
  }
}
