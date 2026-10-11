const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os"),
  https = require("node:https");
const { WebSocketServer } = require("ws"),
  files = require("./private-files.cjs"),
  contract = require("../shared/handwriting-contract.cjs");
const Error = (message) => new contract.ProtocolError(message);
const HASH = (v) => crypto.createHash("sha256").update(v).digest("hex");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const privateAddress = (address) => {
  const a = String(address || "").replace(/^::ffff:/, "");
  return (
    a === "::1" ||
    a === "127.0.0.1" ||
    /^10\.\d+\.\d+\.\d+$/.test(a) ||
    /^192\.168\.\d+\.\d+$/.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(a) ||
    /^169\.254\.\d+\.\d+$/.test(a)
  );
};
function addresses() {
  const entries = Object.entries(os.networkInterfaces()).sort(
    ([a], [b]) => (a === "en0" ? -1 : 0) - (b === "en0" ? -1 : 0),
  );
  return [
    ...new Set(
      entries.flatMap(([, list]) =>
        list
          .filter(
            (n) =>
              n.family === "IPv4" && !n.internal && privateAddress(n.address),
          )
          .map((n) => n.address),
      ),
    ),
  ];
}
async function identity(folder, ips) {
  require("reflect-metadata");
  const x509 = require("@peculiar/x509");
  x509.cryptoProvider.set(crypto.webcrypto);
  const directory = files.directory(path.join(folder, "pad-identity")),
    file = path.join(directory, "installation.json");
  let data;
  // Earlier development builds embedded issued-question grants here. Read them
  // once for migration; current identities stay small and contain no grants.
  if (fs.existsSync(file))
    data = JSON.parse(files.read(file, 256 * 1024 * 1024));
  else {
    const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    data = {
      version: 1,
      installationId: crypto.randomUUID(),
      key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      devices: [],
    };
    files.atomicText(file, JSON.stringify(data));
  }
  contract.checkedId(data.installationId);
  if (
    data.version !== 1 ||
    !Array.isArray(data.devices) ||
    data.devices.length > 20
  )
    throw Error(
      "Recall Pad identity needs repair. Keep the identity folder safe before resetting pairing.",
    );
  const privateKey = crypto.createPrivateKey(data.key),
    publicDER = crypto
      .createPublicKey(privateKey)
      .export({ type: "spki", format: "der" }),
    privateDER = privateKey.export({ type: "pkcs8", format: "der" });
  const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  const keys = {
    privateKey: await crypto.webcrypto.subtle.importKey(
      "pkcs8",
      privateDER,
      alg,
      false,
      ["sign"],
    ),
    publicKey: await crypto.webcrypto.subtle.importKey(
      "spki",
      publicDER,
      alg,
      true,
      ["verify"],
    ),
  };
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.randomBytes(16).toString("hex"),
    name: "CN=Recall Pad",
    notBefore: new Date(Date.now() - 300000),
    notAfter: new Date(Date.now() + 365 * 86400000),
    signingAlgorithm: alg,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"], true),
      new x509.SubjectAlternativeNameExtension(
        [
          { type: "dns", value: "localhost" },
          ...new Set(["127.0.0.1", ...ips]),
        ].map((v) => (typeof v === "string" ? { type: "ip", value: v } : v)),
      ),
    ],
  });
  return {
    data,
    file,
    key: data.key,
    cert: cert.toString("pem"),
    spkiSha256: crypto.createHash("sha256").update(publicDER).digest("base64"),
  };
}
class PadBridge {
  constructor({
    store,
    paper,
    helper,
    assessment,
    emit = () => {},
    received = async () => {},
    host = "0.0.0.0",
    port = 0,
    now = () => Date.now(),
  }) {
    Object.assign(this, {
      store,
      paper,
      helper,
      assessment,
      emit,
      received,
      host,
      port,
      now,
    });
    this.server = null;
    this.sockets = new Map();
    this.pending = new Map();
    this.bootstrap = null;
    this.session = this.idle();
    this.tutorSession = this.idle();
    this.rates = new Map();
    this.transportError = null;
  }
  idle() {
    return {
      version: 1,
      installationId: this.identity?.data.installationId ?? null,
      mode: "idle",
      handoffId: null,
      currentQuestionId: null,
      questions: [],
    };
  }
  saveIdentity() {
    files.atomicText(this.identity.file, JSON.stringify(this.identity.data));
  }
  grant(deviceId, handoffId) {
    const row = this.paper.db
      .prepare(
        "SELECT mode,questions,offline FROM paper_device_grants WHERE device_id=? AND handoff_id=?",
      )
      .get(deviceId, handoffId);
    return row
      ? {
          id: handoffId,
          mode: row.mode,
          questions: JSON.parse(row.questions),
          offline: !!row.offline,
        }
      : null;
  }
  saveGrant(deviceId, grant) {
    this.paper.db
      .prepare(
        "INSERT INTO paper_device_grants(device_id,handoff_id,mode,questions,offline) VALUES(?,?,?,?,?) ON CONFLICT(device_id,handoff_id) DO UPDATE SET mode=excluded.mode,questions=excluded.questions,offline=excluded.offline",
      )
      .run(
        deviceId,
        grant.id,
        grant.mode,
        JSON.stringify(grant.questions),
        grant.offline ? 1 : 0,
      );
  }
  async start() {
    if (this.server) return;
    this.identity = await identity(this.store.folder, addresses());
    let migrated = false;
    this.store.transaction(() => {
      for (const device of this.identity.data.devices) {
        if (!Array.isArray(device.grants)) continue;
        for (const grant of device.grants) this.saveGrant(device.id, grant);
        delete device.grants;
        migrated = true;
      }
    });
    if (migrated) this.saveIdentity();
    this.session = this.idle();
    this.tutorSession = this.idle();
    this.server = https.createServer(
      {
        key: this.identity.key,
        cert: this.identity.cert,
        minVersion: "TLSv1.2",
        requestTimeout: 90000,
        headersTimeout: 15000,
        maxHeaderSize: 8192,
      },
      (req, res) => this.request(req, res),
    );
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    this.server.on("upgrade", (req, socket, head) => {
      try {
        if (
          !privateAddress(req.socket.remoteAddress) ||
          req.headers.origin ||
          req.url !== "/v1/events"
        )
          throw Error();
        const device = this.auth(req);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.sockets.set(ws, device.id);
          ws.isAlive = true;
          ws.on("pong", () => (ws.isAlive = true));
          ws.on("message", () => ws.close(1008, "Server events only"));
          ws.on("close", () => {
            this.sockets.delete(ws);
            this.invalidateTutor(device.id);
            this.emit({ type: "status" });
          });
          ws.on("error", () => {});
          ws.send(
            JSON.stringify({
              type: "session",
              channel: this.session.mode === "study" ? "study" : "tutor",
              session: this.forDevice(device),
            }),
          );
          this.emit({ type: "status" });
        });
      } catch {
        socket.destroy();
      }
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.server.on("error", () => {
      this.transportError =
        "Local receiver stopped. Toggle the companion to reconnect.";
      this.emit({ type: "status" });
    });
    this.network = addresses().join(",");
    this.timer = setInterval(() => this.tick(), 15000);
    this.timer.unref();
    await this.helper
      ?.advertise({
        port: this.server.address().port,
        installationId: this.identity.data.installationId,
      })
      .catch(() => {});
    this.transportError = null;
    this.emit({ type: "status" });
  }
  async tick() {
    for (const [ws] of this.sockets) {
      if (!ws.isAlive) ws.terminate();
      else {
        ws.isAlive = false;
        ws.ping();
      }
    }
    const ips = addresses();
    if (this.server && ips.join(",") !== this.network && !this.refreshing) {
      this.refreshing = true;
      try {
        const i = await identity(this.store.folder, ips);
        if (this.server) {
          this.server.setSecureContext({
            key: i.key,
            cert: i.cert,
            minVersion: "TLSv1.2",
          });
          this.identity = { ...i, data: this.identity.data };
          this.network = ips.join(",");
          this.emit({ type: "status" });
        }
      } catch {
        this.transportError =
          "Network changed. Toggle the companion to reconnect.";
      } finally {
        this.refreshing = false;
      }
    }
    for (const [id, p] of this.pending)
      if (p.expiresAt <= this.now()) {
        this.pending.delete(id);
        this.emit({ type: "status" });
      }
    for (const [key, r] of this.rates)
      if (r.until < this.now()) this.rates.delete(key);
  }
  async stop() {
    this.bootstrap = null;
    this.pending.clear();
    clearInterval(this.timer);
    for (const [ws] of this.sockets) ws.terminate();
    this.sockets.clear();
    this.wss?.close();
    const server = this.server;
    this.server = null;
    if (server)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    await this.helper?.stopAdvertising().catch(() => {});
    this.session = this.idle();
    this.tutorSession = this.idle();
    this.emit({ type: "status" });
  }
  invalidateTutor(deviceId) {
    if (this.tutorSession.mode !== "tutor" || !this.identity) return;
    for (const device of this.identity.data.devices) {
      if (deviceId && device.id !== deviceId) continue;
      this.paper.db
        .prepare(
          "UPDATE paper_device_grants SET offline=1 WHERE device_id=? AND handoff_id=?",
        )
        .run(device.id, this.tutorSession.handoffId);
    }
  }
  endpoint() {
    return this.server
      ? `https://${this.host === "127.0.0.1" ? this.host : addresses()[0] || "127.0.0.1"}:${this.server.address().port}`
      : null;
  }
  async status() {
    return {
      version: 1,
      enabled: !!this.server,
      endpoint: this.endpoint(),
      installationId: this.identity?.data.installationId ?? null,
      error: this.transportError,
      devices: (this.identity?.data.devices || []).map((d) => ({
        id: d.id,
        name: d.name,
        lastSeen: d.lastSeen,
        connected: [...this.sockets.values()].includes(d.id),
      })),
      pendingPairings: [...this.pending]
        .filter(([, p]) => p.state === "pending" && p.expiresAt > this.now())
        .map(([id, p]) => ({
          id,
          name: p.name,
          expiresAt: new Date(p.expiresAt).toISOString(),
        })),
      model: this.store.get("pad:model", "gpt-6-astra"),
      assessmentConsent: this.store.get("pad:assessmentConsent", false),
      loginAtStartup: this.store.get("pad:loginAtStartup", false),
      study: this.session.mode === "study",
      helper: await this.helper?.status(),
      assessmentBusy: !!this.assessment?.active,
    };
  }
  async pairing() {
    if (!this.server) throw Error("Enable the iPad companion first.");
    if (!addresses().length && this.host !== "127.0.0.1")
      throw Error("Connect this Mac to a local network before pairing.");
    const expiresAt = this.now() + 300000,
      bootstrapSecret = crypto.randomBytes(32).toString("base64url");
    this.bootstrap = { hash: HASH(bootstrapSecret), expiresAt };
    const payload = {
      version: 1,
      installationId: this.identity.data.installationId,
      endpoint: this.endpoint(),
      spkiSha256: this.identity.spkiSha256,
      bootstrapSecret,
      expiresAt: new Date(expiresAt).toISOString(),
    };
    return {
      payload,
      qrDataUrl: await require("qrcode").toDataURL(JSON.stringify(payload), {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 300,
      }),
      expiresAt: payload.expiresAt,
    };
  }
  confirm({ id, allow }) {
    const p = this.pending.get(id);
    if (!p || p.state !== "pending" || p.expiresAt <= this.now())
      throw Error("This pairing request expired. Scan a fresh code.");
    if (allow !== true) {
      p.state = "rejected";
      this.emit({ type: "status" });
      return;
    }
    if (this.identity.data.devices.some((d) => d.id === p.deviceId))
      throw Error(
        "This device is already paired. Remove it before pairing again.",
      );
    if (this.identity.data.devices.length >= 20)
      throw Error("Remove a device before adding another.");
    const credential = crypto.randomBytes(32).toString("base64url");
    const device = {
      id: p.deviceId,
      name: p.name,
      hash: HASH(credential),
      lastSeen: null,
    };
    this.identity.data.devices.push(device);
    this.saveIdentity();
    p.state = "approved";
    p.credential = credential;
    this.emit({ type: "status" });
  }
  revoke(id) {
    contract.checkedId(id);
    if (!this.identity)
      throw Error("Enable the companion to manage paired devices.");
    this.identity.data.devices = this.identity.data.devices.filter(
      (d) => d.id !== id,
    );
    this.saveIdentity();
    this.paper.db
      .prepare("DELETE FROM paper_device_grants WHERE device_id=?")
      .run(id);
    for (const [ws, deviceId] of this.sockets)
      if (deviceId === id) {
        ws.close(1008, "Device removed");
        this.sockets.delete(ws);
      }
    for (const [key, p] of this.pending)
      if (p.deviceId === id) this.pending.delete(key);
    this.emit({ type: "status" });
  }
  auth(req) {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token)
      throw Object.assign(Error("Pair this iPad again."), { status: 401 });
    const d = this.identity.data.devices.find((d) => same(d.hash, HASH(token)));
    if (!d)
      throw Object.assign(Error("Device credential is no longer valid."), {
        status: 401,
      });
    if (!d.lastSeen || this.now() - Date.parse(d.lastSeen) > 60000) {
      d.lastSeen = new Date(this.now()).toISOString();
      this.saveIdentity();
    }
    return d;
  }
  legacySession() {
    return this.session.mode === "study" ? this.session : this.tutorSession;
  }
  forDevice(d, session = this.legacySession()) {
    if (!session.handoffId) return session;
    const grant = this.grant(d.id, session.handoffId) || {
      id: session.handoffId,
      mode: session.mode,
      questions: [],
      offline: false,
    };
    if (grant) {
      for (const q of [...session.questions, ...(session.problems ?? [])])
        if (!grant.questions.includes(q.id)) grant.questions.push(q.id);
      this.saveGrant(d.id, grant);
    }
    return session;
  }
  broadcast(event) {
    for (const [ws, id] of this.sockets)
      try {
        const d = this.identity.data.devices.find((d) => d.id === id);
        ws.send(
          JSON.stringify(
            event.type === "session"
              ? {
                  type: "session",
                  channel: event.channel,
                  session: this.forDevice(d, event.session),
                }
              : event,
          ),
        );
      } catch {}
    this.emit(event);
  }
  startStudy(
    { cardId, sessionId, cardIds },
    { allowCodingCurrent = false } = {},
  ) {
    if (typeof cardId !== "string" || cardId.length > 512)
      throw Error("Choose a concept or math card.");
    const handoffId = crypto.randomUUID(),
      ids = Array.isArray(cardIds)
        ? [cardId, ...cardIds.filter((id) => id !== cardId)]
        : [cardId];
    const questions = this.paper.questions(handoffId, ids),
      current = questions.find((q) => q.cardId === cardId);
    if (!current && !allowCodingCurrent)
      throw Error("Writing is available for concept and math cards.");
    this.studySessionId = sessionId || null;
    this.session = {
      version: 1,
      installationId: this.identity?.data.installationId ?? null,
      mode: "study",
      handoffId,
      currentQuestionId: current?.id ?? null,
      questions,
      pendingQuestionIds: questions.map((question) => question.id),
    };
    this.broadcast({
      type: "session",
      channel: "study",
      session: this.session,
    });
    return this.status();
  }
  followStudy(input) {
    if (this.session.mode !== "study") return this.status();
    if (!input?.cardId) {
      this.session = this.idle();
      this.broadcast({
        type: "session",
        channel: "study",
        session: this.session,
      });
      return this.status();
    }
    if (input.sessionId && input.sessionId !== this.studySessionId)
      return this.startStudy(input, { allowCodingCurrent: true });
    const fronts = this.paper.questions(this.session.handoffId, [
        input.cardId,
        ...(input.cardIds || []),
      ]),
      current = fronts.find((q) => q.cardId === input.cardId);
    this.session = {
      ...this.session,
      currentQuestionId: current?.id ?? null,
      // Retained fronts and device grants keep earlier offline work valid.
      // The desk follows only the ordered, remaining Mac study queue.
      pendingQuestionIds: fronts.map((question) => question.id),
      questions: [
        ...fronts,
        ...this.session.questions.filter(
          (q) => !fronts.some((f) => f.cardId === q.cardId),
        ),
      ].slice(0, contract.LIMITS.questions),
    };
    let frontBytes = 0;
    this.session.questions = this.session.questions.filter((question) => {
      const bytes = Buffer.byteLength(JSON.stringify(question));
      if (frontBytes + bytes > contract.LIMITS.frontBytes) return false;
      frontBytes += bytes;
      return true;
    });
    this.broadcast({
      type: "session",
      channel: "study",
      session: this.session,
    });
    return this.status();
  }
  async startTutor(target = "clipboard") {
    if (!["clipboard", "chatgpt", "codex"].includes(target))
      throw Error("Invalid Tutor Pad receiver request.");
    // An older iPad may request its historical destination. That is accepted
    // only for compatibility; every live session now receives pages generically.
    const assistant = this.assistantSession?.();
    if (assistant) {
      this.setAssistantSession(assistant);
      return this.tutorSession;
    }
    if (this.tutorSession.mode === "tutor") return this.tutorSession;

    this.tutorSession = {
      version: 1,
      installationId: this.identity?.data.installationId ?? null,
      mode: "tutor",
      handoffId: crypto.randomUUID(),
      currentQuestionId: null,
      questions: [],
      target: "clipboard",
    };
    this.broadcast({
      type: "session",
      channel: "tutor",
      session: this.tutorSession,
    });
    return this.tutorSession;
  }
  setAssistantSession(session) {
    if (!session && this.tutorSession.target !== "assistant") return;
    this.tutorSession = session
      ? {
          ...session,
          installationId: this.identity?.data.installationId ?? null,
        }
      : this.idle();
    this.broadcast({
      type: "session",
      channel: "tutor",
      session: this.tutorSession,
    });
  }
  rate(req) {
    const key = req.socket.remoteAddress,
      r = this.rates.get(key) || { count: 0, until: this.now() + 60000 };
    if (r.until < this.now()) {
      r.count = 0;
      r.until = this.now() + 60000;
    }
    r.count++;
    this.rates.set(key, r);
    if (r.count > 200)
      throw Object.assign(Error("Too many requests. Try shortly."), {
        status: 429,
      });
  }
  async body(req, limit = contract.LIMITS.manifestBytes) {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit)
      throw Object.assign(Error("Upload is too large."), { status: 413 });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > limit)
        throw Object.assign(Error("Upload is too large."), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async json(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
      throw Object.assign(Error("Use a JSON request."), { status: 415 });
    try {
      return JSON.parse((await this.body(req)).toString("utf8"));
    } catch (e) {
      if (e.status) throw e;
      throw Error("Invalid JSON request.");
    }
  }
  async request(req, res) {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!privateAddress(req.socket.remoteAddress) || req.headers.origin)
        throw Object.assign(
          Error("Only the native local companion is supported."),
          { status: 403 },
        );
      this.rate(req);
      const url = new URL(req.url, "https://localhost");
      if (url.search) throw Error("Unexpected URL parameters.");
      const route = url.pathname,
        method = req.method;
      if (route === "/v1/pair/request" && method === "POST") {
        const b = await this.json(req);
        contract.checkedId(b.deviceId);
        if (
          !this.bootstrap ||
          this.bootstrap.expiresAt <= this.now() ||
          typeof b.bootstrapSecret !== "string" ||
          !same(HASH(b.bootstrapSecret), this.bootstrap.hash) ||
          b.version !== 1
        )
          throw Object.assign(
            Error("This pairing code expired or was already used."),
            { status: 401 },
          );
        if (
          typeof b.deviceName !== "string" ||
          !b.deviceName.trim() ||
          b.deviceName.length > 80 ||
          /[\u0000-\u001f]/.test(b.deviceName) ||
          this.identity.data.devices.some((d) => d.id === b.deviceId)
        )
          throw Error("Invalid or already paired device.");
        const requestId = crypto.randomUUID(),
          p = {
            deviceId: b.deviceId,
            name: b.deviceName,
            hash: this.bootstrap.hash,
            expiresAt: this.bootstrap.expiresAt,
            state: "pending",
          };
        this.pending.set(requestId, p);
        this.bootstrap = null;
        this.emit({ type: "status" });
        return send(202, {
          requestId,
          expiresAt: new Date(p.expiresAt).toISOString(),
        });
      }
      const pair = route.match(/^\/v1\/pair\/requests\/([a-f0-9-]+)(\/ack)?$/i);
      if (pair) {
        const p = this.pending.get(pair[1]);
        if (!p || p.expiresAt <= this.now())
          throw Object.assign(Error("Pairing request expired."), {
            status: 410,
          });
        if (method === "GET" && !pair[2]) {
          const secret = req.headers["x-pair-secret"];
          if (typeof secret !== "string" || !same(HASH(secret), p.hash))
            throw Object.assign(Error("Invalid pairing request."), {
              status: 401,
            });
          return send(
            200,
            p.state === "approved"
              ? {
                  state: p.state,
                  credential: p.credential,
                  deviceId: p.deviceId,
                  installationId: this.identity.data.installationId,
                }
              : { state: p.state },
          );
        }
        if (method === "POST" && pair[2]) {
          const d = this.auth(req);
          if (d.id !== p.deviceId)
            throw Error("Pairing belongs to another device.");
          this.pending.delete(pair[1]);
          return send(200, { acknowledged: true });
        }
      }
      const d = this.auth(req);
      if (route === "/v1/session" && method === "GET")
        return send(200, this.forDevice(d));
      if (route === "/v1/session/study" && method === "GET")
        return send(200, this.forDevice(d, this.session));
      if (route === "/v1/session/tutor" && method === "GET")
        return send(200, this.forDevice(d, this.tutorSession));
      if (route === "/v1/tutor/start" && method === "POST") {
        const b = await this.json(req);
        const s = await this.startTutor(b.target);
        this.forDevice(d, s);
        return send(200, s);
      }
      if (route === "/v1/tutor/arm" && method === "POST")
        return send(410, {
          error:
            "Draft pasting has been removed. Copy a received page on your Mac and paste it yourself.",
        });
      if (route === "/v1/tutor/end" && method === "POST") {
        if (this.tutorSession.target === "assistant")
          throw Error("End this paper learning session from its tutor chat.");
        this.invalidateTutor();
        this.tutorSession = this.idle();
        this.broadcast({
          type: "session",
          channel: "tutor",
          session: this.tutorSession,
        });
        return send(200, { ended: true });
      }
      const attempt = route.match(
        /^\/v1\/attempts\/([a-f0-9-]+)(?:\/(manifest|commit|assets\/([a-f0-9]{64})))?$/i,
      );
      if (attempt) {
        const id = contract.checkedId(attempt[1]),
          action = attempt[2];
        if (method === "POST" && action === "manifest") {
          const m = contract.manifest(await this.json(req));
          if (m.id !== id) throw Error("Submission IDs differ.");
          let grant = this.grant(d.id, m.handoffId);
          if (grant && grant.mode !== m.mode)
            throw Error("Submission mode conflicts with its issued handoff.");
          // A blank Tutor Pad can originate offline. It conveys no question access
          // and grants only durable image storage, never clipboard or app control.
          if (!grant && m.mode === "tutor" && m.version === 1) {
            if (
              this.paper.db
                .prepare(
                  "SELECT count(*) n FROM paper_device_grants WHERE device_id=? AND mode='tutor'",
                )
                .get(d.id).n >= 1000
            )
              throw Error("Finish older handoffs before creating more.");
            grant = {
              id: m.handoffId,
              mode: "tutor",
              questions: [],
              offline: true,
            };
            this.saveGrant(d.id, grant);
          }
          if (
            !grant ||
            ((m.mode === "study" || m.version === 2) &&
              !grant.questions.includes(m.questionId))
          )
            throw Object.assign(
              Error("This question was not issued to this device."),
              { status: 403 },
            );
          if (
            this.paper.db
              .prepare("SELECT count(*) n FROM paper_staging WHERE device_id=?")
              .get(d.id).n >= 20 &&
            !this.paper.db
              .prepare(
                "SELECT id FROM paper_staging WHERE id=? AND device_id=?",
              )
              .get(id, d.id)
          )
            throw Error(
              "Finish or retry earlier uploads before starting more.",
            );
          return send(200, this.paper.prepare(d.id, m));
        }
        if (method === "PUT" && attempt[3]) {
          const staged = this.paper.db
            .prepare(
              "SELECT manifest FROM paper_staging WHERE id=? AND device_id=?",
            )
            .get(id, d.id);
          if (!staged) throw Error("Upload a manifest first.");
          const a = this.paper
            .assets(JSON.parse(staged.manifest))
            .find((a) => a.hash === attempt[3]);
          if (!a) throw Error("Asset is undeclared.");
          return send(
            200,
            this.paper.stage(d.id, id, a.hash, await this.body(req, a.limit)),
          );
        }
        if (method === "POST" && action === "commit") {
          const prior = this.paper.db
            .prepare("SELECT id FROM paper_attempts WHERE id=?")
            .get(id);
          const receipt = this.paper.commit(d.id, id);
          send(200, receipt);
          for (const [ws, deviceId] of this.sockets)
            if (deviceId === d.id && ws.readyState === 1)
              ws.send(JSON.stringify({ type: "receipt", receipt }));
          if (!prior) {
            this.emit({ type: "attempt", id });
            Promise.resolve(this.received(this.paper.attempt(id))).catch(
              () => {},
            );
          }
          return;
        }
        if (method === "GET" && !action)
          return send(200, this.paper.receipt(d.id, id));
      }
      send(404, { error: "Endpoint not found." });
    } catch (error) {
      const safe = error instanceof contract.ProtocolError,
        message = safe
          ? error.message
          : "The Mac could not save this upload. Your work stays saved on iPad; check disk space and retry.";
      if (!res.headersSent)
        send(
          safe ? error.status || (/conflicts/.test(message) ? 409 : 400) : 500,
          { error: message },
        );
      else res.end();
    }
  }
}
module.exports = { PadBridge, identity, privateAddress, addresses };
