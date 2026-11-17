// PianoPlay - input manager: microphone, Web MIDI and computer keyboard. Touch goes straight through the stage.
import { MicDetector } from './pitch.js';
import { MidiInput } from './midi.js';

const LOWER = 'zsxdcvgbhnjm,l.;/', UPPER = 'q2w3er5t6y7ui9o0p';

export class InputManager {
  constructor(app) {
    this.app = app; this.target = null; this.mic = null; this.midi = null; this.kbBase = 48; this.down = new Map();
    this.level = 0; this.onLevel = null; this.status = '';
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
  }
  attach(t) { this.target = t; this.apply(); }
  detach() { this.target = null; }
  get mode() { return this.app.store.settings.input; }
  /** Apply the current settings to the attached session (call after a change). */
  apply() {
    const t = this.target; if (!t) return;
    const s = this.app.store.settings;
    t.mic = (s.input === 'mic' && this.mic?.running) ? this.mic : null;
    t.accompaniment = s.accompaniment && s.input !== 'mic';
    t.userSound = s.sound;
    t.latency = s.input === 'mic' ? Math.max(0.1, s.latency || 0) : (s.latency || 0);
    t.window = ({ easy: 0.42, normal: 0.3, strict: 0.2 })[s.window] || 0.3;
    if (this.mic) this.mic.setSensitivity(2 ** ((s.sensitivity - 0.5) * 2));
  }
  /** Must be called from a user gesture. Returns the active mode ('touch'|'mic'|'midi'). */
  async enable() {
    const s = this.app.store.settings;
    await this.app.audio.resume();
    if (s.input === 'mic') {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available here (it needs https and a modern browser).');
        if (!this.mic) {
          this.mic = new MicDetector(this.app.audio.ctx);
          this.mic.on('on', (m, sal) => { if (this.target && this.target.mode !== 'watch') this.target.press(m, Math.min(1, 0.4 + sal / 20), 'mic', this.mic.lastOnset && performance.now() - this.mic.lastOnset < 250 ? this.mic.lastOnset : performance.now()); });
          this.mic.on('off', (m) => { this.target?.release(m); });
          this.mic.on('level', (v) => { this.level = v; this.onLevel?.(v); });
        }
        if (!this.mic.running) { await this.mic.start(); if (!this.mic.noise) await this.mic.calibrate(900).catch(() => {}); }
        this.status = 'mic';
      } catch (e) {
        s.input = 'touch'; this.app.store.save(); this.status = 'touch';
        this.app.toast(e.name === 'NotAllowedError' ? 'Microphone permission was denied – using touch instead.' : (e.message || 'Microphone unavailable – using touch.'));
      }
    } else if (s.input === 'midi') {
      try {
        if (!this.midi) { this.midi = new MidiInput(); this.midi.on('on', (m, v) => this.target?.press(m, v, 'midi')); this.midi.on('off', (m) => this.target?.release(m)); }
        const names = await this.midi.start(); this.status = 'midi';
        this.app.toast(names.length ? `MIDI: ${names[0]}` : 'No MIDI keyboard found – plug one in.');
      } catch (e) { s.input = 'touch'; this.app.store.save(); this.status = 'touch'; this.app.toast(e.message); }
    } else this.status = 'touch';
    if (s.input !== 'mic' && this.mic?.running) this.mic.stop();
    this.apply();
    return s.input;
  }
  stopMic() { if (this.mic?.running) this.mic.stop(); this.level = 0; }
  _key(e, down) {
    const t = this.target; if (!t || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    if (down && e.repeat) { return; }
    if (down && e.key === '-') { this.kbBase = Math.max(24, this.kbBase - 12); return; }
    if (down && e.key === '=') { this.kbBase = Math.min(84, this.kbBase + 12); return; }
    const k = e.key.toLowerCase();
    let i = LOWER.indexOf(k), off = 0;
    if (i < 0) { i = UPPER.indexOf(k); off = 12; }
    if (i < 0) return;
    const m = this.kbBase + off + i;
    if (down) { if (this.down.has(k)) return; this.down.set(k, m); t.press(m, 0.75, 'keys'); }
    else { const mm = this.down.get(k); this.down.delete(k); if (mm != null) t.release(mm); }
    e.preventDefault();
  }
}
