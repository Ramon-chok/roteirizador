/* Copia a versão web oficial (index.html, css, js) da raiz do projeto para desktop/web.
   O app de Windows usa exatamente os mesmos arquivos: mudou na web, mudou no desktop no próximo build.
   Além disso, embute as bibliotecas e as fontes que a web carrega de CDN (Leaflet, SheetJS, Supabase, QR code, Google Fonts):
   elas são baixadas uma vez para desktop/vendor (cache) e o index.html copiado passa a apontar para web/vendor.
   Assim o app abre e funciona sem depender dos CDNs. Mapa, rotas, endereços e banco continuam pela internet. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const DESKTOP = path.resolve(__dirname, '..');
const DESTINO = path.join(DESKTOP, 'web');
const CACHE = path.join(DESKTOP, 'vendor');
const ITENS = ['index.html', 'css', 'js'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const nomeDe = url => {
  const u = new URL(url), base = path.basename(u.pathname) || 'arquivo';
  const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  if (/\.(js|css|woff2?|ttf)$/i.test(base)) return `${h}-${base}`;
  return u.hostname === 'fonts.gstatic.com' ? `${h}-fonte.woff2` : `${h}-${base}.css`;
};
async function baixar(url) {
  const arq = path.join(CACHE, nomeDe(url));
  if (fs.existsSync(arq)) return arq;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ao baixar ${url}`);
  fs.writeFileSync(arq, Buffer.from(await r.arrayBuffer()));
  console.log('  baixado: ' + url);
  return arq;
}
/* CSS do Google Fonts: baixa cada arquivo de fonte e reescreve as URLs para a pasta local */
async function baixarFontes(url) {
  const arq = await baixar(url);
  let css = fs.readFileSync(arq, 'utf8');
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
  for (const f of urls) css = css.split(f).join(path.basename(await baixar(f)));
  const local = path.join(CACHE, 'fontes-' + path.basename(arq));
  fs.writeFileSync(local, css);
  return local;
}

async function main() {
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  for (const item of ITENS) {
    const de = path.join(RAIZ, item);
    if (!fs.existsSync(de)) { console.error('Arquivo da versão web não encontrado: ' + de); process.exit(1); }
    fs.cpSync(de, path.join(DESTINO, item), { recursive: true });
  }

  const idx = path.join(DESTINO, 'index.html');
  let html = fs.readFileSync(idx, 'utf8');
  const usados = new Set();
  try {
    // Scripts de CDN → web/vendor (os atributos integrity/crossorigin saem: o arquivo passa a ir dentro do instalador)
    for (const m of [...html.matchAll(/<script src="(https:\/\/[^"]+)"[^>]*><\/script>/g)]) {
      const arq = await baixar(m[1]); usados.add(arq);
      html = html.replace(m[0], `<script src="vendor/${path.basename(arq)}"></script>`);
    }
    // Fontes do Google → web/vendor (CSS + arquivos .woff2)
    for (const m of [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(https:\/\/fonts\.googleapis\.com[^"]+)"\s*\/?>/g)]) {
      const href = m[1].replace(/&amp;/g, '&');
      const css = await baixarFontes(href); usados.add(css);
      for (const f of fs.readFileSync(css, 'utf8').matchAll(/url\(([^)]+)\)/g)) usados.add(path.join(CACHE, f[1]));
      html = html.replace(m[0], `<link rel="stylesheet" href="vendor/${path.basename(css)}" />`);
    }
    html = html.replace(/\s*<link rel="preconnect"[^>]*>/g, '');
    // QR code das duas etapas, que o app.js carrega sob demanda
    const appJs = path.join(DESTINO, 'js', 'app.js');
    let js = fs.readFileSync(appJs, 'utf8');
    const qr = js.match(/'(https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\/[^']+)'/);
    if (qr) { const arq = await baixar(qr[1]); usados.add(arq); js = js.replace(qr[1], 'vendor/' + path.basename(arq)); fs.writeFileSync(appJs, js); }

    fs.mkdirSync(path.join(DESTINO, 'vendor'));
    for (const arq of usados) fs.copyFileSync(arq, path.join(DESTINO, 'vendor', path.basename(arq)));
    console.log(`Bibliotecas embutidas: ${usados.size} arquivo(s) em web/vendor`);
  } catch (e) {
    // Sem internet na primeira vez: o app segue usando os CDNs, como a versão web
    console.warn('Aviso: não foi possível embutir as bibliotecas (' + e.message + '). O app vai carregá-las pela internet.');
    html = fs.readFileSync(idx, 'utf8');
  }
  fs.writeFileSync(idx, html);
  console.log('Interface web copiada para desktop/web');
}
main().catch(e => { console.error(e); process.exit(1); });
