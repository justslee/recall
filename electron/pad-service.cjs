const { PaperStore } = require("./paper-store.cjs"),
  { PaperSessions } = require("./paper-sessions.cjs"),
  { HandwritingService } = require("./handwriting.cjs"),
  { PadBridge } = require("./pad-bridge.cjs"),
  { createPadHandoff } = require("./pad-handoff.cjs");
class PadService {
  constructor({
    store,
    key,
    decodeImage,
    copyImage,
    emit = () => {},
    login = () => {},
    helperFactory = createPadHandoff,
    fetchImpl,
  }) {
    Object.assign(this, { store, copyImage, emit, login });
    this.jobs = [];
    this.closed = false;
    this.paper = new PaperStore(store, { decodeImage });
    this.helper = helperFactory({
      onEvent: () => this.emit({ type: "status" }),
    });
    this.assessment = new HandwritingService({
      paper: this.paper,
      key,
      model: () => store.get("pad:model", "gpt-6-astra"),
      consent: () => store.get("pad:assessmentConsent", false),
      fetchImpl,
      emit: (e) => this.event(e),
    });
    this.bridge = new PadBridge({
      store,
      paper: this.paper,
      helper: this.helper,
      assessment: this.assessment,
      emit: (e) => this.emit(e),
      received: (a) => this.received(a),
    });
    this.paperSessions = new PaperSessions({
      store,
      paper: this.paper,
      onChange: (session) => this.bridge.setAssistantSession(session),
      onRead: (id) => this.event({ type: "attempt", id }),
    });
    this.bridge.assistantSession = () => this.paperSessions.activeSession();
  }
  event(e) {
    this.emit(e);
    if (e.type === "attempt" && this.bridge.identity) {
      const a = this.paper.attempt(e.id),
        receipt = this.paper.receipt(a.deviceId, e.id);
      for (const [ws, id] of this.bridge.sockets)
        if (id === a.deviceId && ws.readyState === 1)
          ws.send(JSON.stringify({ type: "receipt", receipt }));
    }
  }
  async start() {
    if (this.store.get("pad:enabled", false))
      try {
        await this.bridge.start();
        this.bridge.setAssistantSession(this.paperSessions.activeSession());
      } catch {
        this.store.set("pad:enabled", false);
        this.bridge.transportError =
          "The local receiver could not start. Enable it again in iPad & handwriting.";
      }
  }
  async configure(input = {}) {
    if (input.pasteEnabled !== undefined || input.target !== undefined)
      throw Error("Draft pasting settings are no longer supported.");

    for (const field of ["enabled", "assessmentConsent", "loginAtStartup"])
      if (input[field] !== undefined && typeof input[field] !== "boolean")
        throw Error("Invalid companion setting.");
    if (
      input.model !== undefined &&
      (typeof input.model !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(input.model.trim()))
    )
      throw Error("Choose a valid handwriting assessment model.");
    if (input.enabled === true) {
      await this.bridge.start();
      this.bridge.setAssistantSession(this.paperSessions.activeSession());
    }
    if (input.enabled === false) {
      this.cancel();
      await this.bridge.stop();
    }
    for (const field of [
      "enabled",
      "model",
      "assessmentConsent",
      "loginAtStartup",
    ])
      if (input[field] !== undefined)
        this.store.set(
          "pad:" + field,
          field === "model" ? input[field].trim() : input[field],
        );
    if (input.assessmentConsent === false) this.cancel();
    if (input.loginAtStartup !== undefined) this.login(input.loginAtStartup);
    this.emit({ type: "status" });
    return this.bridge.status();
  }
  async tutorStatus() {
    const enabled = !!this.bridge.server,
      receiving = enabled && this.bridge.tutorSession.mode === "tutor";
    return {
      enabled,
      receiving,
      manualReady: receiving,
      target: this.bridge.tutorSession.target ?? "clipboard",
      lastState: receiving ? "receiving" : "idle",
    };
  }
  async tutorStart() {
    if (this.closed) throw Error("Recall is closing. Your work is saved.");
    if (!this.bridge.server)
      throw Error("Enable Recall Pad in iPad & handwriting settings first.");

    await this.bridge.startTutor();
    this.emit({ type: "tutor" });
    return this.tutorStatus();
  }
  async paperSessionCall(operation, input) {
    const result = await this.paperSessions.call(operation, input),
      receiverReady = !!this.bridge.server;
    return {
      ...result,
      receiverReady,
      displayed:
        receiverReady &&
        result.sessionId === this.bridge.tutorSession.handoffId,
    };
  }
  async copyPage({ attemptId, index }) {
    if (this.closed) throw Error("Recall is closing. Your work is saved.");
    const attempt = this.paper.attempt(attemptId);
    if (attempt.mode !== "tutor") throw Error("Choose a Tutor Pad sheet.");

    const page = this.paper
      .pages(attemptId)
      .find((p) => p.page_index === index);
    if (!page) throw Error("Page not found.");

    // Only this explicit Mac action may change the clipboard. Receiving,
    // reconnecting, starting the receiver and old paste settings never do.
    this.copyImage(page.bytes);
    return { state: "copied", copiedPage: index };
  }
  async received(a) {
    if (this.closed) return;
    if (a.mode === "tutor") {
      this.paperSessions.notify();
      return;
    }

    const restoredAt = this.store.get("pad:restoredAt", null),
      restored = this.store.get("pad:restoreNeedsResubmission", false);
    const requiresResubmission =
      restored &&
      (!restoredAt || Date.parse(a.createdAt) <= Date.parse(restoredAt));
    if (
      a.manifest.evaluate &&
      this.store.get("pad:assessmentConsent", false) &&
      !requiresResubmission
    ) {
      this.paper.state(a.id, "queued");
      this.jobs.push(a.id);
      this.event({ type: "attempt", id: a.id });
      this.drain();
    }
  }
  async drain() {
    if (this.draining || this.assessment.active) return;
    this.draining = true;
    try {
      while (this.jobs.length && !this.closed) {
        const attemptId = this.jobs.shift();
        try {
          await this.assessment.evaluate({ attemptId });
        } catch {}
      }
    } finally {
      this.draining = false;
    }
  }
  async evaluate(input) {
    if (this.draining || this.jobs.length)
      throw Error(
        "Another handwriting evaluation is running. Your attempt is saved.",
      );
    try {
      return await this.assessment.evaluate(input);
    } finally {
      this.drain();
    }
  }
  cancel() {
    this.assessment.cancel();
    for (const id of this.jobs)
      this.paper.state(id, "received", {
        error: "Evaluation stopped. Retry when ready.",
      });
    this.jobs = [];
  }
  async suspend() {
    this.bridge.invalidateTutor();
  }
  async close() {
    this.closed = true;
    this.paperSessions.close();
    this.cancel();
    this.assessment.close();
    await this.bridge.stop();
    this.helper.dispose();
  }
}
module.exports = { PadService };
