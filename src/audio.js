// AdaptiveAudioManager — a living, fully procedural score.
// Everything is synthesised with the Web Audio API so no audio files are shipped.
// Layers: ambient pad (music), wind (nature), birds/crickets (nature), interaction cues.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.enabled = true;
    this.buses = {};
    this.vol = { master: 0.66, music: 0.5, nature: 0.8, ui: 0.7 };
    this._windGain = null;
    this._birdTimer = null;
    this._chordTimer = null;
    this._nightAmount = 0; // 0 day .. 1 night (drives crickets vs birds)
    this._reverb = null;
  }

  async start() {
    if (this.started) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    // bus graph: source -> bus -> master -> destination
    const master = ctx.createGain();
    master.gain.value = this.vol.master;
    master.connect(ctx.destination);

    const mk = (name, v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(master);
      this.buses[name] = g;
      return g;
    };
    this.buses.master = master;
    mk('music', this.vol.music);
    mk('nature', this.vol.nature);
    mk('ui', this.vol.ui);

    // shared reverb (algorithmic impulse) for long felt-piano tails
    this._reverb = ctx.createConvolver();
    this._reverb.buffer = this._makeImpulse(3.6, 2.6);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.9;
    this._reverb.connect(revGain).connect(master);

    this.started = true;
    this._startWind();
    this._scheduleBirds();
    this._scheduleChords();
    this.applyVolumes();
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // ---- continuous wind bed (filtered noise) ----
  _startWind() {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf; noise.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.4;

    const g = ctx.createGain();
    g.gain.value = 0.08;
    noise.connect(lp).connect(g).connect(this.buses.nature);
    noise.start();
    this._windGain = g;

    // slow gusts
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06; lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }

  setWind(intensity) {
    if (!this._windGain) return;
    const t = this.ctx.currentTime;
    this._windGain.gain.cancelScheduledValues(t);
    this._windGain.gain.linearRampToValueAtTime(0.05 + intensity * 0.16, t + 3);
  }

  setNight(amount) { this._nightAmount = Math.max(0, Math.min(1, amount)); }

  // ---- birds by day, crickets by night ----
  _scheduleBirds() {
    const loop = () => {
      if (!this.started) return;
      const night = this._nightAmount;
      if (Math.random() > (night > 0.6 ? 0.35 : 0.6)) {
        if (night > 0.6) this._cricket();
        else this._birdCall();
      }
      this._birdTimer = setTimeout(loop, 2600 + Math.random() * 5200);
    };
    this._birdTimer = setTimeout(loop, 2000);
  }

  _birdCall() {
    const ctx = this.ctx;
    const base = 1600 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.11;
      osc.frequency.setValueAtTime(base * (1 + i * 0.08), t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.3 + i * 0.08), t + 0.06);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g).connect(this.buses.nature);
      osc.start(t); osc.stop(t + 0.16);
    }
  }

  _cricket() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 4200 + Math.random() * 300;
      const tt = t + i * 0.05;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.018, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      osc.connect(g).connect(this.buses.nature);
      osc.start(tt); osc.stop(tt + 0.04);
    }
  }

  // ---- felt-piano chord bed, sparse and unresolved ----
  _scheduleChords() {
    // pentatonic-ish, open fifths + add9 flavour (Hz)
    const palette = [
      [174.6, 261.6, 329.6, 392.0],   // F add
      [196.0, 293.7, 349.2, 440.0],
      [146.8, 220.0, 329.6, 392.0],
      [164.8, 246.9, 329.6, 493.9],
    ];
    let i = 0;
    const loop = () => {
      if (!this.started) return;
      const chord = palette[i % palette.length];
      i++;
      chord.forEach((f, n) => this._pianoNote(f, this.ctx.currentTime + n * 0.18 + Math.random() * 0.1, 0.09));
      this._chordTimer = setTimeout(loop, 11000 + Math.random() * 7000);
    };
    // first note comes with the opening
    this._chordTimer = setTimeout(loop, 6000);
  }

  // a soft felt-piano-ish tone with long reverb tail
  _pianoNote(freq, when = this.ctx.currentTime, peak = 0.12) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = 'triangle'; osc2.type = 'sine';
    osc.frequency.value = freq; osc2.frequency.value = freq * 2.003;
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 4.2);
    osc.connect(g); osc2.connect(g);
    g.connect(lp);
    lp.connect(this.buses.music);
    lp.connect(this._reverb);
    osc.start(when); osc2.start(when);
    osc.stop(when + 4.4); osc2.stop(when + 4.4);
  }

  // single hero note used in the opening
  openingNote() {
    if (!this.started) return;
    this._pianoNote(261.6, this.ctx.currentTime + 0.2, 0.16);
  }

  // ---- interaction cues ----
  cue(type) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    switch (type) {
      case 'seed': this._thud(150, 0.5, 0.09); break;
      case 'bloom': this._pianoNote(392.0, t, 0.14); this._pianoNote(587.3, t + 0.25, 0.1); break;
      case 'ripple': this._pianoNote(659.3, t, 0.05); break;
      case 'open': this._pianoNote(329.6, t, 0.07); break;
      case 'gate': this._creak(); break;
      case 'error': this._pianoNote(146.8, t, 0.06); break;
      default: this._pianoNote(440, t, 0.06);
    }
  }

  _thud(freq, dur, peak) {
    const ctx = this.ctx; const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.buses.ui);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _creak() {
    const ctx = this.ctx; const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(60, t + 2.2);
    lp.type = 'lowpass'; lp.frequency.value = 300;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(lp).connect(g).connect(this.buses.ui);
    osc.start(t); osc.stop(t + 2.5);
  }

  // duck music while personal audio plays (kept for API completeness)
  duck(on) {
    if (!this.buses.music) return;
    const t = this.ctx.currentTime;
    const target = on ? this.vol.music * 0.25 : this.vol.music;
    this.buses.music.gain.linearRampToValueAtTime(target, t + 0.6);
  }

  // bench mode: fade music to near-silence, keep nature
  benchMode(on) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.buses.music.gain.linearRampToValueAtTime(on ? 0.0 : this.vol.music * this.vol.master, t + 7);
  }

  setVolume(bus, value) {
    this.vol[bus] = value;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const m = this.enabled ? 1 : 0;
    this.buses.master.gain.linearRampToValueAtTime(this.vol.master * m, t + 0.3);
    this.buses.music.gain.linearRampToValueAtTime(this.vol.music, t + 0.3);
    this.buses.nature.gain.linearRampToValueAtTime(this.vol.nature, t + 0.3);
    this.buses.ui.gain.linearRampToValueAtTime(this.vol.ui, t + 0.3);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.started) {
      const t = this.ctx.currentTime;
      this.buses.master.gain.linearRampToValueAtTime(on ? this.vol.master : 0, t + 0.4);
    }
  }
}
