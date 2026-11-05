/* Roteirizador RRM para Windows.
   Carrega a mesma interface da versão web (index.html, css e js da raiz do projeto, copiados para web/ no build).
   Os arquivos são servidos pelo endereço app://rrm/, que mantém o localStorage e a sessão entre aberturas. */
const { app, BrowserWindow, protocol, net, shell, session, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

if (process.platform !== 'win32') {
  console.error('O Roteirizador RRM desktop roda somente no Windows.');
  app.exit(1);
}

const ESQUEMA = 'app';
const HOST = 'rrm';
const INICIO = `${ESQUEMA}://${HOST}/index.html`;
const PASTA_WEB = path.join(__dirname, 'web');

protocol.registerSchemesAsPrivileged([
  { scheme: ESQUEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.setAppUserModelId('tech.rrmind.roteirizador');

// Uma janela só: abrir o atalho de novo traz a janela que já está aberta.
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;

// Tamanho e posição da janela são lembrados entre aberturas.
const arqEstado = () => path.join(app.getPath('userData'), 'janela.json');
function lerEstado() {
  try { return JSON.parse(fs.readFileSync(arqEstado(), 'utf8')); } catch (e) { return { width: 1366, height: 820, maximizada: true }; }
}
function salvarEstado() {
  if (!janela || janela.isDestroyed()) return;
  const b = janela.getNormalBounds();
  try { fs.writeFileSync(arqEstado(), JSON.stringify({ ...b, maximizada: janela.isMaximized() })); } catch (e) { /* ignora */ }
}

function servirArquivos() {
  protocol.handle(ESQUEMA, req => {
    const url = new URL(req.url);
    if (url.host !== HOST) return new Response('Não encontrado', { status: 404 });
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const alvo = path.normalize(path.join(PASTA_WEB, rel));
    if (!alvo.startsWith(PASTA_WEB)) return new Response('Proibido', { status: 403 });
    return net.fetch(pathToFileURL(alvo).toString());
  });
}

const interno = u => u.startsWith(`${ESQUEMA}://${HOST}/`);
const externo = u => /^(https?:|mailto:|tel:)/i.test(u);

function criarJanela() {
  const est = lerEstado();
  janela = new BrowserWindow({
    x: est.x, y: est.y, width: est.width || 1366, height: est.height || 820,
    minWidth: 980, minHeight: 600,
    show: false,
    title: 'Route VORTEX',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0B1426',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  if (est.maximizada) janela.maximize();
  janela.once('ready-to-show', () => janela.show());
  janela.on('close', salvarEstado);
  janela.on('closed', () => { janela = null; });

  // Links externos abrem no navegador padrão; a janela do app só mostra a interface.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (externo(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (ev, url) => {
    if (interno(url)) return;
    ev.preventDefault();
    if (externo(url)) shell.openExternal(url);
  });

  // Atalhos de teclado do navegador, já que a janela não tem menu.
  janela.webContents.on('before-input-event', (ev, inp) => {
    if (inp.type !== 'keyDown') return;
    const k = inp.key, ctrl = inp.control || inp.meta, wc = janela.webContents;
    let feito = true;
    if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) inp.shift ? wc.reloadIgnoringCache() : wc.reload();
    else if (k === 'F11') janela.setFullScreen(!janela.isFullScreen());
    else if (k === 'F12' || (ctrl && inp.shift && k.toLowerCase() === 'i')) wc.toggleDevTools();
    else if (ctrl && (k === '+' || k === '=')) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (ctrl && k === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (ctrl && k === '0') wc.setZoomLevel(0);
    else if (inp.alt && k === 'ArrowLeft' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else feito = false;
    if (feito) ev.preventDefault();
  });

  janela.webContents.on('render-process-gone', () => { if (janela) janela.reload(); });
  janela.loadURL(INICIO);
}

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  servirArquivos();
  // A interface só pede a área de transferência (botão "Copiar"); o resto é negado.
  session.defaultSession.setPermissionRequestHandler((wc, perm, ok) => ok(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(perm)));
  // Arquivos exportados (modelos, planilhas, backups) vão para Downloads, com a janela de "Salvar como".
  session.defaultSession.on('will-download', (ev, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
