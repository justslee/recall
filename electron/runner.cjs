const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
class Runner {
  constructor(options = {}) {
    this.scientificPython = options.scientificPython;
    this.active = null;
  }
  cancel() {
    if (this.active) {
      this.active.cancelled = true;
      this.kill(this.active.child);
    }
  }
  kill(child) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  process(command, args, cwd, job, timeout = 8000) {
    return new Promise((resolve) => {
      let output = "",
        timedOut = false,
        truncated = false;
      const child = spawn(command, args, {
        cwd,
        detached: true,
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin",
          HOME: cwd,
          TMPDIR: cwd,
          LANG: "en_US.UTF-8",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;
      const timer = setTimeout(() => {
        timedOut = true;
        this.kill(child);
      }, timeout);
      const collect = (b) => {
        output += b.toString();
        if (output.length > 64000) {
          output = output.slice(0, 64000);
          truncated = true;
          this.kill(child);
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ status: "error", output: e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          status: job.cancelled
            ? "cancelled"
            : timedOut
              ? "timeout"
              : truncated
                ? "output-limit"
                : code === 0
                  ? "passed"
                  : "failed",
          output: output || "Process exited with code " + code,
          code,
        });
      });
    });
  }
  scientificPythonPath() {
    if (!this.scientificPython || !fs.existsSync(this.scientificPython))
      throw Error(
        "This challenge needs the optional local NumPy environment. See Settings for setup instructions.",
      );
    return this.scientificPython;
  }
  async run(card, language, code) {
    if (this.active)
      throw Error("A program is already running. Stop it first.");
    if (card.kind !== "code" || !card.code?.[language])
      throw Error("Unsupported exercise language");
    if (typeof code !== "string" || code.length > 100000)
      throw Error("Code exceeds the 100 KB limit.");
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "recall-run-"));
    const job = { cancelled: false, child: null };
    this.active = job;
    try {
      const config = card.code[language];
      if (language === "python") {
        fs.writeFileSync(
          path.join(folder, "exercise.py"),
          code + "\n\n" + config.harness,
        );
        return await this.process(
          config.runtime === "scientific-python"
            ? this.scientificPythonPath()
            : "/usr/bin/python3",
          ["-I", "exercise.py"],
          folder,
          job,
        );
      }
      if (language !== "cpp") throw Error("Unsupported language");
      fs.writeFileSync(
        path.join(folder, "exercise.cpp"),
        code + "\n\n" + config.harness,
      );
      const compile = await this.process(
        "/usr/bin/clang++",
        [
          "-std=c++17",
          "-O1",
          "-Wall",
          "-Wextra",
          "-Wpedantic",
          "-pthread",
          "exercise.cpp",
          "-o",
          "exercise",
        ],
        folder,
        job,
        15000,
      );
      if (compile.status !== "passed") return { ...compile, phase: "compile" };
      if (job.cancelled) return { status: "cancelled", output: "Stopped." };
      return await this.process(path.join(folder, "exercise"), [], folder, job);
    } finally {
      this.active = null;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
}
module.exports = { Runner };
