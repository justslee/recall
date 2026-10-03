// Resource owner for one push-to-talk answer. Cancelling while permission or
// connection setup is pending must also stop any resources that arrive later.
export class VoiceRecorder {
  constructor(api, cardId, { onText, onError, onLevel }) {
    Object.assign(this, { api, cardId, onText, onError, onLevel });
    this.token = crypto.randomUUID();
    this.closed = false;
    this.pending = 0;
    this.queue = Promise.resolve();
  }
  check() {
    if (this.closed) throw Error("Dictation cancelled.");
  }
  async start() {
    this.unsubscribe = this.api.onVoiceEvent((event) => {
      if (event.token !== this.token || this.closed) return;
      if (event.type === "transcript" || event.type === "complete")
        this.onText(event.text);
      if (event.type === "error") this.fail(Error(event.message));
    });
    try {
      await this.api.voicePrepare(this.cardId);
      this.check();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (this.closed) {
        this.release();
        this.check();
      }
      this.context = new AudioContext({ sampleRate: 24000 });
      if (this.context.sampleRate !== 24000)
        throw Error("This microphone could not use the required audio format.");
      await this.context.resume();
      await this.context.audioWorklet.addModule(
        new URL("/voice-worklet.js", location.href).href,
      );
      this.check();
      this.node = new AudioWorkletNode(this.context, "recall-pcm");
      this.node.port.onmessage = ({ data }) => {
        if (data.stopped) {
          this.flushed?.();
          return;
        }
        if (this.closed || !data.audio) return;
        if (this.onLevel) {
          const pcm = new Int16Array(data.audio);
          const energy = pcm.reduce(
            (sum, sample) => sum + (sample / 32768) ** 2,
            0,
          );
          this.onLevel(Math.min(1, Math.sqrt(energy / pcm.length) * 8));
        }
        if (++this.pending > 20)
          return this.fail(
            Error("Audio could not be sent fast enough. Please try again."),
          );
        this.queue = this.queue
          .then(() => {
            if (!this.closed)
              return this.api.voiceAudio(
                this.token,
                new Uint8Array(data.audio),
              );
          })
          .catch((e) => this.fail(e))
          .finally(() => {
            this.pending--;
          });
      };
      await this.api.voiceStart(this.cardId, this.token);
      if (this.closed) {
        await this.api.voiceCancel(this.token);
        this.check();
      }
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.node);
      // The worklet emits silence on its output. Connecting keeps processing
      // active without playing the learner's voice through the speakers.
      this.node.connect(this.context.destination);
      for (const track of this.stream.getTracks())
        track.onended = () => {
          if (!this.closed && !this.finishing)
            this.fail(
              Error("Microphone disconnected. The partial transcript is kept."),
            );
        };
    } catch (e) {
      this.release();
      this.api.voiceCancel(this.token).catch(() => {});
      throw e;
    }
  }
  async finish() {
    this.check();
    this.finishing = true;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(
                "Microphone did not finish cleanly. Check the partial transcript.",
              ),
            ),
          2000,
        );
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.node.port.postMessage("stop");
      });
      this.releaseAudio();
      await this.queue;
      this.check();
      const result = await this.api.voiceFinish(this.token);
      this.check();
      this.onText(result.text);
      return result;
    } finally {
      this.cancel();
    }
  }
  fail(error) {
    if (this.closed) return;
    this.onError(error);
    this.cancel();
  }
  releaseAudio() {
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    if (this.context?.state !== "closed") this.context?.close().catch(() => {});
  }
  release() {
    this.releaseAudio();
    this.unsubscribe?.();
  }
  cancel() {
    this.closed = true;
    this.release();
    this.api.voiceCancel(this.token).catch(() => {});
  }
}
