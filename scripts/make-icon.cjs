// Render packaging/icon.svg into packaging/icon.png (1024 px, transparent) and
// packaging/icon.icns for the macOS bundle. Run with `npm run icon` after
// changing the SVG; the generated files are committed so builds never depend on
// the fonts of the machine that packages.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
const { app, BrowserWindow } = require("electron");
const dir = path.resolve(__dirname, "../packaging");
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1200,
      webPreferences: { offscreen: true, sandbox: true },
    });
    await win.loadURL("data:text/html,<title>icon</title>");
    const svg = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
    const dataUrl = await win.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      c.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("SVG failed to load"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(${JSON.stringify(svg)});
  })`);
    const png = path.join(dir, "icon.png");
    fs.writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));
    const set =
      fs.mkdtempSync(path.join(os.tmpdir(), "recall-icon-")) + "/icon.iconset";
    fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = size * scale,
          name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
        const r = spawnSync(
          "/usr/bin/sips",
          ["-z", String(px), String(px), png, "--out", path.join(set, name)],
          { encoding: "utf8" },
        );
        if (r.status !== 0) throw Error(r.stderr || "sips failed");
      }
    }
    const r = spawnSync(
      "/usr/bin/iconutil",
      ["-c", "icns", set, "-o", path.join(dir, "icon.icns")],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw Error(r.stderr || "iconutil failed");
    fs.rmSync(path.dirname(set), { recursive: true, force: true });
    console.log("Wrote packaging/icon.png and packaging/icon.icns");
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
