/** Tiny synthesized sound effects (no audio files needed). */
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('gu.muted') === '1';
} catch {}

export function isMuted() {
  return muted;
}
export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem('gu.muted', m ? '1' : '0');
  } catch {}
}

function ac() {
  if (muted) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq, dur = 0.12, type = 'sine', gain = 0.15, slide = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise(dur = 0.5, gain = 0.4) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  good: () => {
    tone(660, 0.08, 'triangle');
    setTimeout(() => tone(990, 0.12, 'triangle'), 70);
  },
  bad: () => tone(160, 0.18, 'square', 0.08),
  boom: () => {
    noise(0.7, 0.5);
    tone(90, 0.5, 'sine', 0.3, -60);
  },
  life: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle'), i * 80)),
  turn: () => tone(880, 0.06, 'sine', 0.08),
  bell: () => tone(1320, 0.4, 'sine', 0.12),
  win: () => [523, 659, 784, 659, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle'), i * 120)),
};
