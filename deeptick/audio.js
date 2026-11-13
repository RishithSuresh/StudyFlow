/* ==========================================================================
   DeepTick Pomodoro - Web Audio API Sound Synthesizer
   ========================================================================== */

class SoundSynthesizer {
  constructor() {
    this.ctx = null;
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(soundType = 'bell', volume = 75, repeatCount = 1) {
    this.initContext();
    if (!this.ctx) return;

    const vol = Math.max(0, Math.min(1, volume / 100));
    let repeatsLeft = repeatCount;

    const executeSound = () => {
      const now = this.ctx.currentTime;
      switch (soundType) {
        case 'digital':
          this._playDigital(now, vol);
          break;
        case 'marimba':
          this._playMarimba(now, vol);
          break;
        case 'gong':
          this._playGong(now, vol);
          break;
        case 'chime':
          this._playChime(now, vol);
          break;
        case 'kitchen':
          this._playKitchen(now, vol);
          break;
        case 'bell':
        default:
          this._playBell(now, vol);
          break;
      }

      repeatsLeft--;
      if (repeatsLeft > 0) {
        setTimeout(executeSound, 900);
      }
    };

    executeSound();
  }

  _playBell(time, vol) {
    const frequencies = [880, 1760, 2640];
    const gains = [0.6 * vol, 0.25 * vol, 0.15 * vol];

    frequencies.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gainNode.gain.setValueAtTime(gains[idx], time);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 2.0);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 2.0);
    });
  }

  _playDigital(time, vol) {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const noteTime = time + i * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.2 * vol, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.25);
    });
  }

  _playMarimba(time, vol) {
    const chord = [440, 554.37, 659.25]; // A major
    chord.forEach((freq, i) => {
      const noteTime = time + i * 0.04;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.5 * vol, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 1.2);
    });
  }

  _playGong(time, vol) {
    const freqs = [180, 275, 410, 550];
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime((0.4 / (i + 1)) * vol, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.0);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 3.0);
    });
  }

  _playChime(time, vol) {
    const freqs = [659.25, 830.61, 987.77, 1318.51];
    freqs.forEach((freq, i) => {
      const noteTime = time + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.35 * vol, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.8);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 1.8);
    });
  }

  _playKitchen(time, vol) {
    for (let i = 0; i < 4; i++) {
      const ringTime = time + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1480, ringTime);

      gain.gain.setValueAtTime(0.35 * vol, ringTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ringTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(ringTime);
      osc.stop(ringTime + 0.08);
    }
  }

  playTick(volume = 30) {
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const vol = Math.max(0, Math.min(1, volume / 100)) * 0.1;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }
}

export const soundManager = new SoundSynthesizer();
