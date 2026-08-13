"use client";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Tiny procedural audio engine for Glass Roller.
 * No downloaded audio assets, no decode cost, and nothing runs until a user gesture unlocks audio.
 */
export class GameAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollSource: AudioBufferSourceNode | null = null;
  private musicTimer: number | null = null;
  private musicIndex = 0;
  private muted = false;
  private lastThumpAt = 0;

  async unlock() {
    if (typeof window === "undefined") return;
    if (!this.context) {
      const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctx) return;
      const context = new Ctx();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 0.72;
      master.connect(context.destination);

      const rollFilter = context.createBiquadFilter();
      rollFilter.type = "bandpass";
      rollFilter.frequency.value = 430;
      rollFilter.Q.value = 0.75;
      const rollGain = context.createGain();
      rollGain.gain.value = 0;
      rollFilter.connect(rollGain);
      rollGain.connect(master);

      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(rollFilter);
      source.start();

      this.context = context;
      this.master = master;
      this.rollFilter = rollFilter;
      this.rollGain = rollGain;
      this.rollSource = source;
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.03);
  }

  setRollingSpeed(speed: number) {
    if (!this.context || !this.rollGain || !this.rollFilter) return;
    const normalized = clamp((speed - 1.35) / 3.25, 0, 1);
    const targetGain = normalized * 0.037;
    this.rollGain.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.075);
    this.rollFilter.frequency.setTargetAtTime(360 + normalized * 520, this.context.currentTime, 0.08);
  }

  thump(intensity: number) {
    if (!this.context || !this.master || this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastThumpAt < 115) return;
    this.lastThumpAt = nowMs;

    const amount = clamp(intensity, 0, 1);
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(112 + amount * 26, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.075);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.026 + amount * 0.028, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  victory() {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      const start = now + index * 0.105;
      const osc = this.context!.createOscillator();
      const gain = this.context!.createGain();
      osc.type = index === notes.length - 1 ? "sawtooth" : "triangle";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === notes.length - 1 ? 0.09 : 0.055, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (index === notes.length - 1 ? 0.42 : 0.19));
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(start);
      osc.stop(start + (index === notes.length - 1 ? 0.44 : 0.21));
    });
  }

  /** Call from the real successful claim flow after Anchor confirms/broadcasts the claim. */
  cashRegister() {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    [880, 1320, 1760].forEach((frequency, index) => {
      const start = now + index * 0.045;
      const osc = this.context!.createOscillator();
      const gain = this.context!.createGain();
      osc.type = "square";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.032, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.08);
    });
    const bellStart = now + 0.14;
    const bell = this.context.createOscillator();
    const bellGain = this.context.createGain();
    bell.type = "sine";
    bell.frequency.value = 1568;
    bellGain.gain.setValueAtTime(0.0001, bellStart);
    bellGain.gain.exponentialRampToValueAtTime(0.065, bellStart + 0.008);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, bellStart + 0.34);
    bell.connect(bellGain);
    bellGain.connect(this.master);
    bell.start(bellStart);
    bell.stop(bellStart + 0.36);
  }

  startMusic() {
    if (!this.context || this.musicTimer !== null) return;
    const pattern = [261.63, 329.63, 392.0, 329.63, 293.66, 392.0, 440.0, 392.0];
    const tick = () => {
      if (!this.context || !this.master || this.muted) return;
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "triangle";
      osc.frequency.value = pattern[this.musicIndex % pattern.length]!;
      this.musicIndex += 1;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.0105, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.12);
    };
    tick();
    this.musicTimer = window.setInterval(tick, 390);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  dispose() {
    this.stopMusic();
    try { this.rollSource?.stop(); } catch { /* already stopped */ }
    this.rollSource = null;
    this.rollGain = null;
    this.rollFilter = null;
    this.master = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close();
  }
}
