/**
 * NEON SWARM audio — everything synthesized live with WebAudio.
 * No assets, no loading. Unlocked on first user gesture.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;

  // music scheduler
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private lastExploAt = 0;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    // gentle limiter so stacked explosions don't clip harshly
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 9;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);

    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
  }

  suspend(): void {
    this.stopMusic();
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  // ------------------------------------------------------------------ sfx

  private env(node: GainNode, t: number, peak: number, decay: number): void {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.008);
    node.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  shoot(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "square";
    const f0 = 560 + Math.random() * 320;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    const g = c.createGain();
    this.env(g, t, 0.055, 0.1);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3400;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.12);
  }

  hit(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf || this.muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.6 + Math.random() * 0.6;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 1.2;
    const g = c.createGain();
    this.env(g, t, 0.12, 0.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random() * 0.4, 0.06);
  }

  /** size 0..1 */
  explode(size: number): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf || this.muted) return;
    const t = c.currentTime;
    // gate insane stacking during nova chains
    if (t - this.lastExploAt < 0.028) return;
    this.lastExploAt = t;
    const s = Math.min(1, Math.max(0.05, size));

    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.4;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900 + 3400 * s, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.24 + 0.3 * s);
    const g = c.createGain();
    this.env(g, t, 0.16 + 0.3 * s, 0.26 + 0.34 * s);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random() * 0.5, 0.7);

    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150 + 140 * s, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22 + 0.2 * s);
    const g2 = c.createGain();
    this.env(g2, t, 0.22 * s + 0.05, 0.24 + 0.2 * s);
    o.connect(g2);
    g2.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.5);
  }

  hurt(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf || this.muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 0.7);
    const g = c.createGain();
    this.env(g, t, 0.6, 0.75);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    src.start(t, 0.1, 0.9);

    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.55);
    const g2 = c.createGain();
    this.env(g2, t, 0.4, 0.6);
    o.connect(g2);
    g2.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.65);
  }

  tierUp(mult: number): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.muted) return;
    const t = c.currentTime;
    const base = 340 * Math.pow(2, Math.min(mult, 12) / 14);
    [0, 0.055].forEach((off, i) => {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = base * (i === 0 ? 1 : 1.5);
      const g = c.createGain();
      this.env(g, t + off, 0.14, 0.14);
      o.connect(g);
      g.connect(this.sfxBus!);
      o.start(t + off);
      o.stop(t + off + 0.16);
    });
  }

  pickup(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(1240, t + 0.11);
    const g = c.createGain();
    this.env(g, t, 0.16, 0.16);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.18);
  }

  nova(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf || this.muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 1.1);
    const g = c.createGain();
    this.env(g, t, 0.7, 1.15);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    src.start(t, 0, 1.2);

    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.95);
    const g2 = c.createGain();
    this.env(g2, t, 0.55, 1.0);
    o.connect(g2);
    g2.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 1.05);

    [1318, 1661, 1979].forEach((f, i) => {
      const s = c.createOscillator();
      s.type = "triangle";
      s.frequency.value = f;
      const sg = c.createGain();
      this.env(sg, t + 0.06 + i * 0.07, 0.08, 0.34);
      s.connect(sg);
      sg.connect(this.sfxBus!);
      s.start(t + 0.06 + i * 0.07);
      s.stop(t + 0.06 + i * 0.07 + 0.4);
    });
  }

  surge(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.muted) return;
    const t = c.currentTime;
    [108, 113].forEach((f) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(1600, t + 0.34);
      const g = c.createGain();
      this.env(g, t, 0.12, 0.5);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.sfxBus!);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  ui(): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = 840;
    const g = c.createGain();
    this.env(g, t, 0.07, 0.06);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.07);
  }

  // ------------------------------------------------------------------ music

  startMusic(): void {
    const c = this.ctx;
    if (!c || this.musicTimer !== null) return;
    this.step = 0;
    this.nextNoteTime = c.currentTime + 0.08;
    this.musicTimer = window.setInterval(() => this.schedule(), 28);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  duck(on: boolean): void {
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(on ? 0.1 : 0.34, this.ctx.currentTime, 0.12);
    }
  }

  private midi(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  private schedule(): void {
    const c = this.ctx;
    if (!c) return;
    const spb = 60 / 132 / 4; // 132bpm, 16th notes
    while (this.nextNoteTime < c.currentTime + 0.14) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  private scheduleStep(s: number, t: number): void {
    const c = this.ctx;
    if (!c || !this.musicBus || !this.noiseBuf) return;
    const bar = Math.floor(s / 16); // 0..3
    const step16 = s % 16;
    const roots = [33, 29, 36, 31]; // A1 F1 C2 G1-ish

    // kick: four on the floor
    if (step16 % 4 === 0) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      const g = c.createGain();
      this.env(g, t, 0.5, 0.13);
      o.connect(g);
      g.connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.15);
    }

    // hat: offbeats
    if (step16 % 4 === 2) {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 1.8;
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6800;
      const g = c.createGain();
      this.env(g, t, 0.055, 0.04);
      src.connect(hp);
      hp.connect(g);
      g.connect(this.musicBus);
      src.start(t, Math.random() * 0.6, 0.05);
    }

    // snare on 2 & 4
    if (step16 === 4 || step16 === 12) {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 0.9;
      const g = c.createGain();
      this.env(g, t, 0.09, 0.11);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.musicBus);
      src.start(t, Math.random() * 0.4, 0.12);
    }

    // bass line
    if (step16 % 2 === 0) {
      const riff = [0, 0, 12, 0, 7, 12, 0, 3];
      const note = roots[bar] + riff[(step16 / 2) | 0];
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = this.midi(note + 12);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 480;
      lp.Q.value = 6;
      const g = c.createGain();
      this.env(g, t, 0.16, 0.16);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.18);
    }

    // sparkle arp on bars 1 & 3
    if ((bar === 1 || bar === 3) && step16 % 4 === 0) {
      const arp = [0, 3, 7, 12];
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = this.midi(roots[bar] + 36 + arp[(step16 / 4) | 0]);
      const g = c.createGain();
      this.env(g, t, 0.05, 0.24);
      o.connect(g);
      g.connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.26);
    }
  }
}
