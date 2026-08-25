"use client";

export class RaceAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private started = false;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    this.ctx = ctx; this.master = master;
    return ctx;
  }

  async start() {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (this.started) return;
    this.started = true;
    const hum = ctx.createOscillator(), gain = ctx.createGain();
    hum.type = "sine"; hum.frequency.value = 58; gain.gain.value = 0.018;
    hum.connect(gain); gain.connect(this.master); hum.start();
    this.hum = hum; this.humGain = gain;
  }

  setSpeed(speed: number) {
    if (!this.ctx || !this.hum || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.hum.frequency.setTargetAtTime(52 + Math.min(26, speed) * 2.1, t, 0.08);
    this.humGain.gain.setTargetAtTime(0.012 + Math.min(1, speed / 22) * 0.02, t, 0.08);
  }

  private ping(freq: number, duration: number, volume: number, type: OscillatorType = "sine", endFreq?: number) {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + duration);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + duration + 0.02);
  }

  jump() { this.ping(250, 0.16, 0.09, "triangle", 520); }
  boost() { this.ping(180, 0.28, 0.12, "sawtooth", 860); }
  pickup() { this.ping(680, 0.13, 0.08, "sine", 1040); }
  missile() { this.ping(430, 0.16, 0.1, "square", 175); }
  bomb() { this.ping(95, 0.25, 0.11, "sawtooth", 38); }
  hit() { this.ping(120, 0.18, 0.11, "square", 54); }
  rescue() { this.ping(520, 0.48, 0.08, "sine", 920); }
  lap() { this.ping(660, 0.22, 0.09, "triangle", 990); setTimeout(() => this.ping(990, 0.24, 0.08, "triangle", 1320), 120); }
  victory() { [0, 140, 290, 450].forEach((ms, i) => setTimeout(() => this.ping([523,659,784,1046][i]!, 0.32, 0.1, "triangle"), ms)); }

  stop() {
    try { this.hum?.stop(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.ctx = null; this.master = null; this.hum = null; this.humGain = null; this.started = false;
  }
}
