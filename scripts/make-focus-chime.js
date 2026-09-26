/**
 * Generates assets/focus-complete.wav — the sound a finished focus block makes.
 *
 * WHY A GENERATOR AND NOT JUST THE FILE. A committed binary nobody can read is
 * a binary nobody can change: the next person who wants it a semitone lower, a
 * touch shorter or a shade quieter has to find a sample library and hope. The
 * sound is twenty lines of arithmetic, so the arithmetic is what lives in the
 * repo and the .wav is its build output. Re-run after editing:
 *
 *     node scripts/make-focus-chime.js
 *
 * THE SOUND. A rising A-major arpeggio — A5, C#6, E6 — struck like a
 * glockenspiel: instant attack, long exponential decay, and inharmonic upper
 * partials, which is what makes a struck metal bar sound struck rather than
 * synthesised. Rising and major because the end of a focus block is a REWARD;
 * a falling or minor figure reads as an alarm, and an alarm is the one thing
 * this must not be. Soft enough to land in a quiet room without a flinch.
 *
 * THE FORMAT. 22.05 kHz mono 16-bit PCM — ~78 KB, which matters because this
 * ships inside the OTA bundle. The top partial here is under 5.6 kHz, well
 * inside an 11 kHz Nyquist, so the lower rate costs nothing audible. WAV, not
 * mp3: it needs no decoder, and at this length the compression would save less
 * than the risk of a platform that won't decode it.
 */
const fs = require('fs');
const path = require('path');

const RATE = 22050;
const SECONDS = 1.8;
const PEAK = 0.82;            // headroom, so no platform's mixer clips it

/** The figure: an A-major arpeggio, each note struck a beat after the last. */
const NOTES = [
  { hz: 880.0, at: 0.00, gain: 1.00 },   // A5
  { hz: 1108.7, at: 0.13, gain: 0.92 },  // C#6
  { hz: 1318.5, at: 0.26, gain: 0.86 },  // E6
];

/**
 * A struck bar's partials: ratio to the fundamental, how loud, and how fast
 * each dies. Slightly stretched ratios (2.01, 3.03…) rather than exact
 * harmonics — a perfect harmonic series sounds like an organ, and the small
 * detuning is most of what the ear hears as "metal". Higher partials decay
 * FASTER, which is the other half: the strike is bright, the tail is pure.
 */
const PARTIALS = [
  { ratio: 1.000, amp: 1.00, tau: 0.62 },
  { ratio: 2.014, amp: 0.34, tau: 0.40 },
  { ratio: 3.032, amp: 0.15, tau: 0.26 },
  { ratio: 4.210, amp: 0.07, tau: 0.16 },
];

// 3 ms of attack. Not zero: a waveform that starts at full amplitude starts
// with a step, and a step is a click.
const ATTACK = 0.003;
// The last 120 ms ramps to true silence so the file cannot end on a step either.
const RELEASE = 0.12;

const total = Math.round(RATE * SECONDS);
const buf = new Float64Array(total);

for (const note of NOTES) {
  const onset = Math.round(note.at * RATE);
  for (let i = onset; i < total; i++) {
    const t = (i - onset) / RATE;
    let s = 0;
    for (const p of PARTIALS) {
      s += p.amp * Math.exp(-t / p.tau) * Math.sin(2 * Math.PI * note.hz * p.ratio * t);
    }
    const attack = t < ATTACK ? t / ATTACK : 1;
    buf[i] += note.gain * attack * s;
  }
}

// Normalise to the headroom, then ramp the tail out.
let max = 0;
for (let i = 0; i < total; i++) max = Math.max(max, Math.abs(buf[i]));
const scale = max > 0 ? PEAK / max : 0;
const releaseFrom = total - Math.round(RELEASE * RATE);

const pcm = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) {
  const fade = i >= releaseFrom ? (total - i) / (total - releaseFrom) : 1;
  const v = Math.max(-1, Math.min(1, buf[i] * scale * fade));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}

/** Canonical 44-byte RIFF/WAVE header for mono 16-bit PCM. */
function wavHeader(bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);          // fmt chunk size
  h.writeUInt16LE(1, 20);           // PCM
  h.writeUInt16LE(1, 22);           // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);    // byte rate
  h.writeUInt16LE(2, 32);           // block align
  h.writeUInt16LE(16, 34);          // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

const out = path.join(__dirname, '..', 'assets', 'focus-complete.wav');
fs.writeFileSync(out, Buffer.concat([wavHeader(pcm.length), pcm]));
console.log(`wrote ${out} — ${(pcm.length / 1024).toFixed(0)} KB, ${SECONDS}s @ ${RATE} Hz`);
