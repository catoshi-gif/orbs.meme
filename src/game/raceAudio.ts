"use client";

export class RaceAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private started = false;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;

  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.19;
    master.connect(ctx.destination);
    const music = ctx.createGain();
    music.gain.value = 0.115;
    music.connect(master);
    this.ctx = ctx; this.master = master; this.music = music;
    return ctx;
  }

  async start() {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (this.started) return;
    this.started = true;
    const hum = ctx.createOscillator(), gain = ctx.createGain();
    hum.type = "sine"; hum.frequency.value = 58; gain.gain.value = 0.014;
    hum.connect(gain); gain.connect(this.master); hum.start();
    this.hum = hum; this.humGain = gain;
    this.startMusic();
  }

  private startMusic() {
    if (!this.ctx || !this.music) return;
    // Original fast 16-bit racing loop: bright arpeggios, syncopated bass and tiny noise-hat clicks.
    // It intentionally evokes classic cartridge-era racing energy without reusing any existing melody.
    const beatMs = 118;
    this.musicStep = 0;
    const tick = () => {
      if (!this.started || !this.ctx || !this.music) return;
      const step = this.musicStep++ % 64;
      const chordRoots = [261.63, 293.66, 220.0, 246.94];
      const root = chordRoots[Math.floor(step / 16)]!;
      const arp = [1, 1.25, 1.5, 2, 1.5, 1.25, 1.125, 1.5][step % 8]!;
      this.note(root * arp, 0.075, 0.032, "square", this.music);
      if (step % 4 === 0) this.note(root / 2, 0.13, 0.046, "triangle", this.music);
      if (step % 8 === 6) this.note(root * 2, 0.05, 0.022, "square", this.music);
      if (step % 2 === 1) this.noiseClick(0.025, 0.014);
    };
    tick();
    this.musicTimer = window.setInterval(tick, beatMs);
  }

  setSpeed(speed: number) {
    if (!this.ctx || !this.hum || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.hum.frequency.setTargetAtTime(52 + Math.min(28, speed) * 2.15, t, 0.08);
    this.humGain.gain.setTargetAtTime(0.009 + Math.min(1, speed / 24) * 0.018, t, 0.08);
  }

  private note(freq: number, duration: number, volume: number, type: OscillatorType, destination: AudioNode) {
    const ctx = this.ctx; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.connect(g); g.connect(destination); o.start(); o.stop(ctx.currentTime + duration + 0.02);
  }

  private noiseClick(duration: number, volume: number) {
    const ctx = this.ctx; if (!ctx || !this.music) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buffer; filter.type = "highpass"; filter.frequency.value = 5500; g.gain.value = volume;
    src.connect(filter); filter.connect(g); g.connect(this.music); src.start();
  }

  private ping(freq: number, duration: number, volume: number, type: OscillatorType = "sine", endFreq?: number) {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + duration);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + duration + 0.02);
  }

  jump() { this.ping(250, 0.16, 0.08, "triangle", 520); }
  boost() { this.ping(180, 0.28, 0.10, "sawtooth", 860); }
  pickup() { this.ping(680, 0.13, 0.075, "sine", 1040); }
  missile() { this.ping(430, 0.16, 0.09, "square", 175); }
  bomb() { this.ping(95, 0.25, 0.10, "sawtooth", 38); }
  hit() { this.ping(120, 0.18, 0.10, "square", 54); }
  rescue() { this.ping(520, 0.48, 0.07, "sine", 920); }
  lap() { this.ping(660, 0.22, 0.085, "triangle", 990); setTimeout(() => this.ping(990, 0.24, 0.075, "triangle", 1320), 120); }
  victory() { [0, 140, 290, 450].forEach((ms, i) => setTimeout(() => this.ping([523,659,784,1046][i]!, 0.32, 0.09, "triangle"), ms)); }

  stop() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    try { this.hum?.stop(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.ctx = null; this.master = null; this.music = null; this.hum = null; this.humGain = null; this.started = false;
  }
}
