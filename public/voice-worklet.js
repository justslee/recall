// Mono PCM16, little endian, in 100 ms chunks. The AudioContext runs at 24 kHz.
// Audio exists only in memory and is transferred to the desktop process.
class RecallPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        this.stopped = true;
        this.flush();
        this.port.postMessage({ stopped: true });
      }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const buffer = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < this.samples.length; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[i]));
      view.setInt16(
        i * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
    this.samples = [];
    this.port.postMessage({ audio: buffer }, [buffer]);
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (input) {
      for (const sample of input) this.samples.push(sample);
      if (this.samples.length >= 2400) this.flush();
    }
    return true;
  }
}
registerProcessor("recall-pcm", RecallPCM);
