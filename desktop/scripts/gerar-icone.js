/* Gera build/icon.png (512x512) com o símbolo Route VORTEX (vórtice) sobre fundo Navy Vortex.
   Uso: npm run icone   (só precisa rodar de novo se o logo mudar) */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="112" fill="#0B1426"/>
  <rect x="17.5" y="17.5" width="477" height="477" rx="110.5" fill="none" stroke="#1E2E50" stroke-width="3"/>
  <g transform="translate(256 256) scale(5.6) translate(-36 -32)">
    <g fill="none" stroke-linecap="round" stroke-width="5"><path stroke="#22D3EE" d="M32 32a12 12 0 0 1 24 0"/><path stroke="#3B82F6" d="M32 32a12 12 0 0 1 24 0" transform="rotate(120 32 32)"/><path stroke="#E8F1FF" d="M32 32a12 12 0 0 1 24 0" transform="rotate(240 32 32)"/></g>
    <g stroke-width="2.4" fill="#0B1426"><circle stroke="#22D3EE" cx="56" cy="32" r="3.3"/><circle stroke="#3B82F6" cx="56" cy="32" r="3.3" transform="rotate(120 32 32)"/><circle stroke="#E8F1FF" cx="56" cy="32" r="3.3" transform="rotate(240 32 32)"/></g>
    <circle fill="#F97316" stroke="#0B1426" cx="32" cy="32" r="5.4" stroke-width="2.9"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const destino = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(destino, img.resize({ width: 512, height: 512 }).toPNG());
  console.log('Ícone gerado: ' + destino);
  app.quit();
});
