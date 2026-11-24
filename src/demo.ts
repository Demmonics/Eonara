import type { CueLine } from './model';

export const demoName = 'A room of blue';
export const demoDuration = 25_000;
const phrases: [number, number, string][] = [
  [0, 2800, 'Blue hours open slowly'],
  [3250, 6100, 'All the windows take the light'],
  [6500, 9600, 'Let the silence hold a shape'],
  [10000, 13200, 'Turn the edges into gold'],
  [13600, 16800, 'Trace a line around the moon'],
  [17200, 20300, 'Leave the door a little open'],
  [20750, 24200, 'I will meet you in the blue'],
];
export const demoLines: CueLine[] = phrases.map(([startMs, endMs, text]) => {
  const tokens = text.split(' ');
  const weights = tokens.map(t => Math.sqrt(t.length + 2));
  const total = weights.reduce((a, b) => a + b);
  let start = startMs;
  const words = tokens.map((token, i) => {
    const next = start + (endMs - startMs) * weights[i] / total;
    const word = { startMs: Math.round(start), endMs: Math.round(next), text: token };
    start = next;
    return word;
  });
  return { startMs, endMs, text, words };
});

export class DemoTone {
  #context?: AudioContext;
  #output?: GainNode;
  #last = -1;
  enabled = false;
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.#context ??= new AudioContext();
      this.#output ??= this.#context.createGain();
      this.#output.gain.value = 0.16;
      this.#output.connect(this.#context.destination);
      await this.#context.resume();
    } else this.#output?.disconnect();
    this.#last = -1;
  }
  silence() { this.#last = -1; }
  tick(position: number, playing: boolean) {
    if (!playing || !this.enabled || !this.#context || !this.#output) return;
    const slot = Math.floor(position / 625);
    if (slot === this.#last) return;
    this.#last = slot;
    const ctx = this.#context;
    const t = ctx.currentTime;
    const step = slot % 8;
    const chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
    const chord = chords[Math.floor(slot / 8) % chords.length];
    const notes = step === 0 ? [chord[0], chord[2], chord[3]] : [chord[[2, 4, 3, 2, 4, 3, 1, 3][step]] + 12];
    for (const note of notes) {
      const tone = ctx.createOscillator();
      const amp = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.value = 440 * 2 ** ((note - 69) / 12);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(step === 0 ? 0.13 : 0.085, t + 0.17);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + (step === 0 ? 1.8 : 0.7));
      tone.connect(amp).connect(this.#output);
      tone.start(t); tone.stop(t + 1.9);
      tone.onended = () => { tone.disconnect(); amp.disconnect(); };
    }
  }
}
