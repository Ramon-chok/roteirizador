/* Route VORTEX para Windows (Roteirizador RRM).
   Espelho da versão web oficial: carrega os mesmos index.html, css e js da raiz do projeto, copiados para web/ no build
   (com as bibliotecas de CDN embutidas em web/vendor). Os arquivos são servidos pelo endereço app://rrm/, que mantém
   o localStorage e a sessão entre aberturas. Os dados são os mesmos da web (mesmo Supabase). */
const { app, BrowserWindow, protocol, net, shell, session, Menu, dialog, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

if (process.platform !== 'win32') {
  console.error('O Route VORTEX desktop roda somente no Windows.');
  app.exit(1);
}

const NOME = 'Route VORTEX';
const ESQUEMA = 'app';
const HOST = 'rrm';
const INICIO = `${ESQUEMA}://${HOST}/index.html`;
const PASTA_WEB = path.join(__dirname, 'web');
const SITE = 'https://github.com/Ramon-chok/roteirizador/releases/latest';

protocol.registerSchemesAsPrivileged([
  { scheme: ESQUEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
app.setAppUserModelId('tech.rrmind.roteirizador');

// Uma janela só: abrir o atalho de novo traz a janela que já está aberta.
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;

/* ----- Preferências da janela (tamanho, posição, zoom) ----- */
const arqEstado = () => path.join(app.getPath('userData'), 'janela.json');
function lerEstado() {
  try { return { width: 1366, height: 820, maximizada: true, zoom: 0, ...JSON.parse(fs.readFileSync(arqEstado(), 'utf8')) }; }
  catch (e) { return { width: 1366, height: 820, maximizada: true, zoom: 0 }; }
}
function salvarEstado(extra = {}) {
  if (!janela || janela.isDestroyed()) return;
  const b = janela.getNormalBounds();
  try { fs.writeFileSync(arqEstado(), JSON.stringify({ ...lerEstado(), ...b, maximizada: janela.isMaximized(), zoom: janela.webContents.getZoomLevel(), ...extra })); } catch (e) { /* ignora */ }
}

/* ----- Arquivos da interface pelo endereço app://rrm/ ----- */
function servirArquivos() {
  protocol.handle(ESQUEMA, req => {
    const url = new URL(req.url);
    if (url.host !== HOST) return new Response('Não encontrado', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const alvo = path.normalize(path.join(PASTA_WEB, rel));
    if (!alvo.startsWith(PASTA_WEB)) return new Response('Proibido', { status: 403 });
    if (!fs.existsSync(alvo)) return new Response('Não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(alvo).toString());
  });
}
const interno = u => u.startsWith(`${ESQUEMA}://${HOST}/`);
const externo = u => /^(https?:|mailto:|tel:)/i.test(u);

/* ----- Zoom ----- */
function zoom(delta) {
  if (!janela) return;
  const wc = janela.webContents, z = delta === 0 ? 0 : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta));
  wc.setZoomLevel(z); salvarEstado({ zoom: z });
}

/* ----- Atualização automática (GitHub Releases, ver "publish" em package.json) ----- */
let updater = null, avisoManual = false;
function iniciarAtualizacao() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', info => { if (avisoManual) dialog.showMessageBox(janela, { type: 'info', title: NOME, message: `Versão ${info.version} disponível`, detail: 'O download começou em segundo plano. Você será avisado quando estiver pronta.' }); });
  updater.on('update-not-available', () => { if (avisoManual) dialog.showMessageBox(janela, { type: 'info', title: NOME, message: 'Você já está na versão mais recente', detail: `Versão instalada: ${app.getVersion()}` }); avisoManual = false; });
  updater.on('error', e => { if (avisoManual) dialog.showMessageBox(janela, { type: 'warning', title: NOME, message: 'Não foi possível verificar atualizações', detail: String((e && e.message) || e) }); avisoManual = false; });
  updater.on('update-downloaded', async info => {
    avisoManual = false;
    const r = await dialog.showMessageBox(janela, { type: 'info', title: NOME, buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1, message: `A versão ${info.version} está pronta`, detail: 'Reinicie para usar a versão nova. Se escolher "Depois", ela é instalada quando você fechar o aplicativo. Os dados não são afetados.' });
    if (r.response === 0) updater.quitAndInstall();
  });
  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
}
function verificarAtualizacao() {
  if (!updater) { dialog.showMessageBox(janela, { type: 'info', title: NOME, message: 'Atualização automática', detail: app.isPackaged ? 'O componente de atualização não está disponível nesta instalação. Baixe a versão nova na página de download.' : 'Disponível só no aplicativo instalado (npm run desktop:build).', buttons: ['OK', 'Abrir página de download'] }).then(r => { if (r.response === 1) shell.openExternal(SITE); }); return; }
  avisoManual = true; updater.checkForUpdates().catch(() => {});
}

/* ----- Sobre ----- */
function sobre() {
  dialog.showMessageBox(janela, {
    type: 'info', title: 'Sobre o ' + NOME, buttons: ['OK', 'Página de download'], defaultId: 0,
    message: `${NOME} ${app.getVersion()}`,
    detail: `Planejamento · Setorização · Roteirização\n\nVersão para Windows da interface web oficial: mesmas telas e mesmos dados.\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\nDados locais: ${app.getPath('userData')}\n\nDesenvolvido por RRM.`
  }).then(r => { if (r.response === 1) shell.openExternal(SITE); });
}

/* ----- Menu ----- */
function montarMenu() {
  const wc = () => janela && janela.webContents;
  const modelo = [
    { label: '&Arquivo', submenu: [
      { label: 'Recarregar', accelerator: 'F5', click: () => wc() && wc().reload() },
      { label: 'Recarregar sem cache', accelerator: 'Shift+F5', click: () => wc() && wc().reloadIgnoringCache() },
      { type: 'separator' },
      { label: 'Abrir pasta de downloads', click: () => shell.openPath(app.getPath('downloads')) },
      { type: 'separator' },
      { label: 'Sair', accelerator: 'Alt+F4', role: 'quit' }
    ] },
    { label: '&Editar', submenu: [
      { label: 'Desfazer', role: 'undo' }, { label: 'Refazer', role: 'redo' }, { type: 'separator' },
      { label: 'Recortar', role: 'cut' }, { label: 'Copiar', role: 'copy' }, { label: 'Colar', role: 'paste' }, { label: 'Selecionar tudo', role: 'selectAll' }
    ] },
    { label: '&Exibir', submenu: [
      { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
      { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
      { label: 'Tamanho original', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
      { type: 'separator' },
      { label: 'Tela cheia', accelerator: 'F11', click: () => janela && janela.setFullScreen(!janela.isFullScreen()) },
      { label: 'Mostrar barra de menus (Alt)', type: 'checkbox', checked: !lerEstado().semMenu, click: i => { janela.setAutoHideMenuBar(!i.checked); janela.setMenuBarVisibility(i.checked); salvarEstado({ semMenu: !i.checked }); } },
      { type: 'separator' },
      { label: 'Ferramentas de desenvolvedor', accelerator: 'F12', click: () => wc() && wc().toggleDevTools() }
    ] },
    { label: 'A&juda', submenu: [
      { label: 'Verificar atualizações…', click: verificarAtualizacao },
      { label: 'Página de download', click: () => shell.openExternal(SITE) },
      { label: 'Abrir pasta de dados do aplicativo', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      { label: 'Sobre o ' + NOME, click: sobre }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modelo));
}

/* Página mostrada se a interface não abrir */
function paginaErro(msg) {
  const html = `<!doctype html><meta charset="utf-8"><title>${NOME}</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0B1426;color:#E8F1FF;font:15px Segoe UI,system-ui,sans-serif">
    <div style="max-width:480px;text-align:center;padding:24px"><div style="width:56px;height:56px;margin:0 auto 18px;border-radius:16px;background:#111D35;border:1px solid #1E2E50;display:grid;place-items:center;font-size:26px;color:#F97316">!</div>
    <h1 style="font-size:20px;margin:0 0 8px">Não foi possível abrir a interface</h1><p style="color:#94A3B8;margin:0 0 20px">${msg}</p>
    <p style="color:#94A3B8;font-size:13px">Pressione <b style="color:#E8F1FF">F5</b> para tentar de novo. Se continuar, reinstale o aplicativo.</p></div>`;
  janela.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function criarJanela() {
  const est = lerEstado();
  janela = new BrowserWindow({
    x: est.x, y: est.y, width: est.width || 1366, height: est.height || 820,
    minWidth: 980, minHeight: 600, show: false, title: NOME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0B1426', autoHideMenuBar: !!est.semMenu,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  if (est.semMenu) janela.setMenuBarVisibility(false);
  if (est.maximizada) janela.maximize();
  janela.once('ready-to-show', () => janela.show());
  janela.on('close', () => salvarEstado());
  janela.on('closed', () => { janela = null; });
  janela.webContents.on('did-finish-load', () => { if (est.zoom) janela.webContents.setZoomLevel(est.zoom); });

  // Links externos abrem no navegador padrão; a janela do app só mostra a interface.
  janela.webContents.setWindowOpenHandler(({ url }) => { if (externo(url)) shell.openExternal(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (ev, url) => { if (interno(url) || url.startsWith('data:')) return; ev.preventDefault(); if (externo(url)) shell.openExternal(url); });

  // Atalhos extras (o menu cobre F5, F11, F12 e zoom)
  janela.webContents.on('before-input-event', (ev, inp) => {
    if (inp.type !== 'keyDown') return;
    const k = inp.key, ctrl = inp.control || inp.meta, wc = janela.webContents;
    if (ctrl && k.toLowerCase() === 'r') { inp.shift ? wc.reloadIgnoringCache() : wc.reload(); ev.preventDefault(); }
    else if (ctrl && inp.shift && k.toLowerCase() === 'i') { wc.toggleDevTools(); ev.preventDefault(); }
    else if (inp.alt && k === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); ev.preventDefault(); }
  });

  janela.webContents.on('render-process-gone', () => { if (janela) janela.reload(); });
  janela.webContents.on('did-fail-load', (ev, code, desc, url) => { if (interno(url) && code !== -3) paginaErro(`Erro ${code}: ${desc}`); });
  if (!fs.existsSync(path.join(PASTA_WEB, 'index.html'))) { paginaErro('Os arquivos da interface não foram encontrados (pasta web). Rode "npm run copiar-web" antes de abrir.'); janela.show(); return; }
  janela.loadURL(INICIO);
}

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  montarMenu();
  servirArquivos();
  ipcMain.handle('rrm:versao', () => app.getVersion());
  ipcMain.handle('rrm:atualizar', () => { verificarAtualizacao(); return true; });
  ipcMain.handle('rrm:sobre', () => { sobre(); return true; });
  // A interface só pede a área de transferência (botão "Copiar") e tela cheia; o resto é negado.
  session.defaultSession.setPermissionRequestHandler((wc, perm, ok) => ok(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(perm)));
  // Arquivos exportados (modelos, planilhas, backups) vão para Downloads, com a janela de "Salvar como".
  session.defaultSession.on('will-download', (ev, item) => {
    item.setSaveDialogOptions({ title: 'Salvar arquivo', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  criarJanela();
  iniciarAtualizacao();
});

app.on('window-all-closed', () => app.quit());
