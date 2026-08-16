import {
  ARENA_THEME_EVENTS,
  ARENA_THEME_EVENT_STRIDE,
  ARENA_THEME_LENGTH_MS,
} from "./arenaTheme.generated";

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
  private themeEpoch = 0;
  private themeEventIndex = 0;
  private themeLoop = 0;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();

      // SFX keep the existing compressed/arcade character, but music gets its own
      // uncompressed path so the MIDI retains the dynamics of the original composition.
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.145;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 2.35;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.22;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      // This bus now feeds the destination directly, so its gain is intentionally much
      // lower than the old pre-master value. Net music level is ~22% higher than before.
      this.musicBus.gain.value = 0.19;

      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 7200;
      this.musicFilter.Q.value = 0.55;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      // Slightly stronger SFX on phone speakers while preserving the existing compressor.
      this.sfxBus.gain.value = 1.0;
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

  private midiHz(note: number) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  private velocityGain(velocity: number, base: number) {
    const normalized = Math.max(0.08, Math.min(1, velocity / 127));
    return base * (0.42 + normalized * 0.58);
  }

  private scheduleOscVoice(
    note: number,
    durationMs: number,
    velocity: number,
    voice: number,
    absoluteWhen: number,
  ) {
    const ctx = this.ctx;
    const destination = this.musicBus;
    if (!ctx || !destination) return;

    const duration = Math.max(0.025, Math.min(2.8, durationMs / 1000));
    const frequency = this.midiHz(note);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const oscillators: OscillatorNode[] = [];
    let endedCount = 0;

    let baseGain = 0.022;
    let attack = 0.004;
    let releaseAt = duration;
    let cutoff = 4200;
    let q = 0.7;

    const addOsc = (type: OscillatorType, freq: number, detune = 0, level = 1) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, absoluteWhen);
      osc.detune.setValueAtTime(detune, absoluteWhen);
      oscGain.gain.setValueAtTime(level, absoluteWhen);
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(absoluteWhen);
      osc.stop(absoluteWhen + duration + 0.035);
      oscillators.push(osc);
      osc.onended = () => {
        osc.disconnect();
        oscGain.disconnect();
        endedCount += 1;
        if (endedCount >= oscillators.length) {
          filter.disconnect();
          gain.disconnect();
        }
      };
    };

    if (voice === 1) {
      // MIDI program 81: gritty lead. Preserve the line but soften raw saw edges for phones.
      baseGain = 0.019;
      cutoff = 3300 + this.intensity * 900;
      q = 1.15;
      addOsc("sawtooth", frequency, -3, 0.72);
      addOsc("triangle", frequency, 4, 0.42);
    } else if (voice === 2) {
      // MIDI program 80: compact 8-bit square lead.
      baseGain = 0.018;
      cutoff = 3900 + this.intensity * 700;
      q = 0.85;
      addOsc("square", frequency, 0, 0.72);
      addOsc("triangle", frequency * 2, 2, 0.16);
    } else if (voice === 3) {
      // Synth bass: rounded and weighty, with a small square core to preserve the MIDI grit.
      baseGain = 0.029;
      cutoff = 760 + this.intensity * 120;
      q = 1.1;
      attack = 0.006;
      addOsc("triangle", frequency, 0, 0.95);
      addOsc("square", frequency, -2, 0.22);
      if (frequency > 52) addOsc("sine", frequency * 0.5, 0, 0.34);
    } else {
      // Clavinet-style source track: short, articulate, filtered square/triangle.
      baseGain = 0.017;
      cutoff = 2450;
      q = 1.5;
      releaseAt = Math.min(duration, 0.32);
      addOsc("square", frequency, 0, 0.62);
      addOsc("triangle", frequency * 2, 4, 0.2);
    }

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, absoluteWhen);
    filter.Q.setValueAtTime(q, absoluteWhen);

    const peak = this.velocityGain(velocity, baseGain);
    gain.gain.setValueAtTime(0.0001, absoluteWhen);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), absoluteWhen + attack);
    if (releaseAt > attack + 0.015) {
      gain.gain.setValueAtTime(peak * 0.9, absoluteWhen + Math.max(attack + 0.01, releaseAt * 0.56));
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, absoluteWhen + releaseAt);

    filter.connect(gain);
    gain.connect(destination);

  }

  private scheduleDrum(note: number, velocity: number, absoluteWhen: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const strength = Math.max(0.2, Math.min(1, velocity / 127));

    if (note === 36) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(112, absoluteWhen);
      osc.frequency.exponentialRampToValueAtTime(43, absoluteWhen + 0.105);
      gain.gain.setValueAtTime(0.055 * strength, absoluteWhen);
      gain.gain.exponentialRampToValueAtTime(0.0001, absoluteWhen + 0.14);
      osc.connect(gain);
      gain.connect(this.musicBus);
      osc.start(absoluteWhen);
      osc.stop(absoluteWhen + 0.15);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      return;
    }

    if (note === 38 || note === 37 || note === 39) {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(note === 38 ? 1650 : 1250, absoluteWhen);
      filter.Q.setValueAtTime(0.8, absoluteWhen);
      gain.gain.setValueAtTime(0.018 * strength, absoluteWhen);
      gain.gain.exponentialRampToValueAtTime(0.0001, absoluteWhen + 0.075);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      src.start(absoluteWhen);
      src.stop(absoluteWhen + 0.08);
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
      return;
    }

    if (note === 42 || note === 46) {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = this.noiseBuffer;
      filter.type = "highpass";
      filter.frequency.setValueAtTime(note === 46 ? 4700 : 6100, absoluteWhen);
      const duration = note === 46 ? 0.065 : 0.028;
      gain.gain.setValueAtTime(0.008 * strength, absoluteWhen);
      gain.gain.exponentialRampToValueAtTime(0.0001, absoluteWhen + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      src.start(absoluteWhen);
      src.stop(absoluteWhen + duration + 0.01);
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
      return;
    }

    // Sparse toms from the source arrangement.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const tomHz = note >= 50 ? 150 : note >= 47 ? 125 : 105;
    osc.type = "sine";
    osc.frequency.setValueAtTime(tomHz, absoluteWhen);
    osc.frequency.exponentialRampToValueAtTime(tomHz * 0.72, absoluteWhen + 0.09);
    gain.gain.setValueAtTime(0.018 * strength, absoluteWhen);
    gain.gain.exponentialRampToValueAtTime(0.0001, absoluteWhen + 0.1);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(absoluteWhen);
    osc.stop(absoluteWhen + 0.11);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  private scheduleThemeEvent(eventIndex: number, absoluteWhen: number) {
    const offset = eventIndex * ARENA_THEME_EVENT_STRIDE;
    const durationMs = ARENA_THEME_EVENTS[offset + 1]!;
    const note = ARENA_THEME_EVENTS[offset + 2]!;
    const velocity = ARENA_THEME_EVENTS[offset + 3]!;
    const voice = ARENA_THEME_EVENTS[offset + 4]!;

    if (voice === 0) {
      this.scheduleDrum(note, velocity, absoluteWhen);
    } else {
      this.scheduleOscVoice(note, durationMs, velocity, voice, absoluteWhen);
    }
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer !== null) return;

    const eventCount = ARENA_THEME_EVENTS.length / ARENA_THEME_EVENT_STRIDE;
    const loopSeconds = ARENA_THEME_LENGTH_MS / 1000;
    this.themeEpoch = ctx.currentTime + 0.08;
    this.themeEventIndex = 0;
    this.themeLoop = 0;

    const pump = () => {
      const audio = this.ensure();
      if (!audio) return;

      const lookAhead = 0.22;
      const horizon = audio.currentTime + lookAhead;

      while (true) {
        if (this.themeEventIndex >= eventCount) {
          this.themeEventIndex = 0;
          this.themeLoop += 1;
        }

        const offset = this.themeEventIndex * ARENA_THEME_EVENT_STRIDE;
        const startMs = ARENA_THEME_EVENTS[offset]!;
        const eventWhen = this.themeEpoch + this.themeLoop * loopSeconds + startMs / 1000;

        if (eventWhen > horizon) break;

        // If a browser was briefly stalled, skip stale notes instead of bunching them together.
        if (eventWhen >= audio.currentTime - 0.06) {
          this.scheduleThemeEvent(this.themeEventIndex, Math.max(audio.currentTime + 0.002, eventWhen));
        }
        this.themeEventIndex += 1;
      }
    };

    pump();
    this.musicTimer = window.setInterval(pump, 45);
  }

  setIntensity(value: number) {
    this.intensity = Math.max(0, Math.min(1, value));
    if (this.ctx && this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(6900 + this.intensity * 1200, this.ctx.currentTime, 0.12);
    }
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
    this.themeEpoch = 0;
    this.themeEventIndex = 0;
    this.themeLoop = 0;
  }
}
