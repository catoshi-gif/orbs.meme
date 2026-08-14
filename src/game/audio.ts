"use client";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type OscType = OscillatorType;

/**
 * Lightweight procedural audio for Glass Roller.
 *
 * Design rules:
 * - No rolling-noise bed. Broadband noise sounded like static on iPhone speakers, so V1 stays
 *   silent while rolling until we have a genuinely good glass-roll asset/synthesis model.
 * - Collision, victory and cash-register cues are short and sparse.
 * - Music is a ~2 minute authored procedural chiptune form (verse → chorus → verse B →
 *   bridge → final chorus), not an 8-note loop.
 * - Nothing allocates or runs until a user gesture unlocks Web Audio.
 */
export class GameAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicNextAt = 0;
  private muted = false;
  private lastThumpAt = 0;
  private musicIntensity = 0;

  async unlock() {
    if (typeof window === "undefined") return;
    if (!this.context) {
      const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctx) return;
      const context = new Ctx();

      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 0.76;
      master.connect(context.destination);

      const musicBus = context.createGain();
      musicBus.gain.value = 0.9;
      musicBus.connect(master);

      this.context = context;
      this.master = master;
      this.musicBus = musicBus;
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.76, this.context.currentTime, 0.03);
  }

  /**
   * Intentionally silent for V1.
   * We keep the hook because the renderer/physics contract already exposes marble speed and a
   * future real glass-rolling sample can be added without touching gameplay code.
   */
  setRollingSpeed(_speed: number) {
    // no-op by design
  }

  private tone(
    frequency: number,
    start: number,
    duration: number,
    amount: number,
    type: OscType,
    destination: AudioNode,
    detune = 0,
  ) {
    if (!this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.detune.setValueAtTime(detune, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amount), start + Math.min(0.012, duration * 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.015);
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


  checkpoint(index: number, total: number) {
    if (!this.context || !this.master || this.muted) return;
    const progress = clamp(total > 0 ? index / total : 0, 0, 1);
    this.musicIntensity = progress;
    const now = this.context.currentTime;
    const root = 84 + Math.round(progress * 5);
    this.tone(midiToHz(root), now, 0.10, 0.040, "sine", this.master);
    this.tone(midiToHz(root + 7), now + 0.045, 0.14, 0.032, "triangle", this.master);
    if (progress >= 0.75) this.tone(midiToHz(root + 12), now + 0.09, 0.16, 0.025, "sine", this.master);
  }

  setRaceProgress(progress: number) {
    this.musicIntensity = clamp(progress, 0, 1);
  }

  victory() {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    const fanfare = [
      { midi: 72, at: 0.00, len: 0.18, gain: 0.052 },
      { midi: 76, at: 0.11, len: 0.18, gain: 0.056 },
      { midi: 79, at: 0.22, len: 0.20, gain: 0.060 },
      { midi: 84, at: 0.34, len: 0.48, gain: 0.080 },
    ];
    fanfare.forEach((note, index) => {
      this.tone(midiToHz(note.midi), now + note.at, note.len, note.gain, index === fanfare.length - 1 ? "sawtooth" : "triangle", this.master!);
      this.tone(midiToHz(note.midi - 12), now + note.at, note.len * 0.9, note.gain * 0.28, "square", this.master!, -4);
    });
  }

  /** Call only after a real successful Anchor claim. */
  cashRegister() {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    [880, 1320, 1760].forEach((frequency, index) => {
      this.tone(frequency, now + index * 0.045, 0.075, 0.030, "square", this.master!);
    });
    this.tone(1568, now + 0.14, 0.34, 0.064, "sine", this.master!);
    this.tone(2093, now + 0.18, 0.23, 0.028, "triangle", this.master!);
  }

  /**
   * Two-minute chiptune form at 132 BPM.
   * 64 bars × 8 eighth-note steps ≈ 116 seconds before the composition repeats.
   */
  private scheduleMusicStep(stepIndex: number, at: number) {
    if (!this.context || !this.musicBus || this.muted) return;

    const stepInBar = stepIndex % 8;
    const bar = Math.floor(stepIndex / 8) % 64;

    type Section = "verseA" | "chorusA" | "verseB" | "bridge" | "chorusB";
    const section: Section =
      bar < 16 ? "verseA" :
      bar < 32 ? "chorusA" :
      bar < 48 ? "verseB" :
      bar < 56 ? "bridge" : "chorusB";

    // Roots are MIDI notes around C3. Each progression is long enough that the ear hears
    // harmonic movement instead of a short repeating arpeggio.
    const progressions: Record<Section, number[]> = {
      verseA:  [48,45,41,43, 48,40,41,43, 45,41,48,43, 41,43,48,48],
      chorusA: [41,43,40,45, 41,43,48,48, 41,43,40,45, 41,43,48,43],
      verseB:  [45,41,48,43, 45,40,41,43, 48,45,41,43, 40,41,43,43],
      bridge:  [38,45,41,43, 38,40,41,43],
      chorusB: [41,43,48,45, 41,43,48,48],
    };
    const roots = progressions[section];
    const root = roots[bar % roots.length]!;

    // Major/minor quality based on the diatonic C-major harmony above.
    const minorRootClasses = new Set([2, 4, 9, 11]);
    const rootClass = ((root % 12) + 12) % 12;
    const third = minorRootClasses.has(rootClass) ? 3 : 4;
    const chord = [0, third, 7, 12];

    // Bass: warm pulse on quarter notes.
    if (stepInBar === 0 || stepInBar === 4) {
      this.tone(midiToHz(root - 12), at, 0.19, section.startsWith("chorus") ? 0.016 : 0.013, "triangle", this.musicBus);
    }

    // Glassy chord/arpeggio bed. Different inversion every bar gives the long form motion.
    const arpDegree = chord[(stepInBar + bar) % chord.length]!;
    if (stepInBar % 2 === 0 || section.startsWith("chorus")) {
      this.tone(midiToHz(root + 12 + arpDegree), at, 0.105, section.startsWith("chorus") ? 0.0085 : 0.0062, "square", this.musicBus, -3);
    }

    // Lead melody: five distinct motifs assigned by section and rotated across bars.
    const motifs: Record<Section, number[][]> = {
      verseA: [
        [0,2,4,7,4,2,0,2], [4,7,9,7,4,2,4,7], [7,9,11,9,7,4,2,4], [4,2,0,2,4,7,4,2],
      ],
      chorusA: [
        [7,9,12,11,9,7,4,7], [9,12,14,12,11,9,7,9], [12,11,9,7,9,11,12,14], [7,9,11,12,16,14,12,11],
      ],
      verseB: [
        [9,7,4,2,4,7,9,7], [4,2,0,2,7,4,2,0], [7,11,9,7,4,7,9,11], [2,4,7,9,7,4,2,4],
      ],
      bridge: [
        [2,5,9,7,5,4,2,0], [5,9,12,9,7,5,4,2], [4,7,11,9,7,4,2,4], [2,4,5,7,9,11,12,11],
      ],
      chorusB: [
        [7,9,12,14,12,9,7,9], [12,14,16,14,12,11,9,7], [9,11,12,16,14,12,11,9], [7,9,11,12,14,16,19,16],
      ],
    };
    const sectionMotifs = motifs[section];
    const motif = sectionMotifs[bar % sectionMotifs.length]!;
    const melodyOffset = motif[stepInBar]!;
    const leadMidi = 72 + melodyOffset;

    // Verse breathes on alternating eighth notes; choruses carry the melody more continuously.
    const playLead = section.startsWith("chorus") || section === "bridge" || (stepInBar % 2 === (bar % 2));
    if (playLead) {
      const leadGain = section.startsWith("chorus") ? 0.020 : section === "bridge" ? 0.017 : 0.0155;
      this.tone(midiToHz(leadMidi), at, 0.135, leadGain, "triangle", this.musicBus);
      if (section === "chorusB" && (stepInBar === 0 || stepInBar === 4)) {
        this.tone(midiToHz(leadMidi - 12), at, 0.17, 0.006, "square", this.musicBus);
      }
    }

    // Tiny tonal percussion (no white noise/static). Kick on 1/3; bright click on 2/4.
    if (stepInBar === 0 || stepInBar === 4) {
      this.tone(58, at, 0.07, 0.009, "sine", this.musicBus);
    } else if ((stepInBar === 2 || stepInBar === 6) && section !== "verseA") {
      this.tone(1480, at, 0.025, 0.0032, "square", this.musicBus);
    }
  }

  startMusic() {
    if (!this.context || this.musicTimer !== null) return;
    this.musicIntensity = 0;
    this.musicStep = 0;
    this.musicNextAt = this.context.currentTime + 0.05;

    const schedule = () => {
      if (!this.context || !this.musicBus) return;
      const horizon = this.context.currentTime + 0.32;
      while (this.musicNextAt < horizon) {
        this.scheduleMusicStep(this.musicStep, this.musicNextAt);
        this.musicStep = (this.musicStep + 1) % (64 * 8);
        const bpm = 132 + this.musicIntensity * 20;
        this.musicNextAt += (60 / bpm) / 2;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 80);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  dispose() {
    this.stopMusic();
    this.musicBus = null;
    this.master = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close();
  }
}
