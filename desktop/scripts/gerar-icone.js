/* Gera build/icon.png (512x512) com o logo da barra superior da versão web.
   Uso: npm run icone   (só precisa rodar de novo se o logo mudar) */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="108" fill="#0E6B57"/>
  <g transform="translate(64 64) scale(16)" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="6" r="2.2"/>
    <path d="M7 17c4-1 3-6 7-7s3-2 3.2-2.6" stroke-dasharray="3 3"/>
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
