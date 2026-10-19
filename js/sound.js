'use strict';
/* Einfache Klangeffekte per WebAudio (keine Audiodateien nötig). */

const Sound = {
  ctx: null,
  enabled: true,

  init() {
    // Muss aus einer Nutzeraktion heraus aufgerufen werden (Autoplay-Regeln, v. a. iOS)
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
    } catch (e) { this.ctx = null; }
  },

  /** Sicher abspielen: Fehler der Audio-API dürfen das Spiel nie stören. */
  ok() { return this.enabled && this.ctx && this.ctx.state !== 'closed'; },

  tone(freq, dur, type, vol, slide) {
    if (!this.ok()) return;
    try { this._tone(freq, dur, type, vol, slide); } catch (e) { /* stumm */ }
  },
  _tone(freq, dur, type, vol, slide) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol, lowpass) {
    if (!this.ok()) return;
    try { this._noise(dur, vol, lowpass); } catch (e) { /* stumm */ }
  },
  _noise(dur, vol, lowpass) {
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass || 800;
    const g = this.ctx.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(this.ctx.destination);
    src.start(t);
  },

  build() { this.tone(520, 0.05, 'square', 0.05); },
  zone() { this.tone(330, 0.07, 'square', 0.06); setTimeout(() => this.tone(495, 0.08, 'square', 0.06), 70); },
  bulldoze() { this.noise(0.25, 0.25, 400); },
  error() { this.tone(160, 0.18, 'sawtooth', 0.06); },
  explosion() { this.noise(1.0, 0.5, 600); this.tone(80, 0.6, 'sine', 0.2, 30); },
  siren() {
    if (!this.enabled || !this.ctx) return;
    for (let i = 0; i < 3; i++) setTimeout(() => this.tone(700, 0.35, 'sawtooth', 0.04, 1000), i * 400);
  },
  monster() { this.tone(110, 0.9, 'sawtooth', 0.12, 55); this.noise(0.8, 0.15, 300); },
  quake() { this.noise(2.5, 0.5, 120); },
  honk() { this.tone(400, 0.12, 'square', 0.04); setTimeout(() => this.tone(400, 0.12, 'square', 0.04), 160); },
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.06), i * 150)); },
  cash() { this.tone(1200, 0.06, 'square', 0.05); setTimeout(() => this.tone(1600, 0.1, 'square', 0.05), 70); },
};
