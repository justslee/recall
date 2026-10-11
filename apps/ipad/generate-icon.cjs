// Regenerate the committed opaque iOS app icon from Recall's public SVG brand.
// Run with the installed Electron binary; ordinary builds use the committed PNG.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { app, BrowserWindow } = require('electron');

function chunk(kind, bytes) {
  const name = Buffer.from(kind, 'ascii');
  const payload = Buffer.concat([name, bytes]);
  let crc = 0xffffffff;
  for (const value of payload) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '../..');
  const svg = fs.readFileSync(path.join(root, 'packaging/icon.svg'), 'utf8');
  const window = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<title>Recall Pad icon</title>');
  const scanlines = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
      const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#f7f2e7';context.fillRect(0,0,1024,1024);context.drawImage(image,0,0,1024,1024);
      const pixels=context.getImageData(0,0,1024,1024).data, rgb=new Uint8Array(1024*(1+1024*3));
      let cursor=0;for(let row=0;row<1024;row++){rgb[cursor++]=0;for(let x=0;x<1024;x++){const at=(row*1024+x)*4;rgb[cursor++]=pixels[at];rgb[cursor++]=pixels[at+1];rgb[cursor++]=pixels[at+2];}}resolve(rgb);};
    image.onerror=()=>reject(new Error('The public brand SVG could not be rendered'));
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(svg)});
  })`);
  // PNG color type 2 has no alpha channel, including fully opaque alpha metadata.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024, 0); header.writeUInt32BE(1024, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from(scanlines))), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(__dirname, 'RecallPad/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png'), png);
  window.destroy();
  app.quit();
}).catch(error => { process.stderr.write(`${error.message}\n`); app.exit(1); });
