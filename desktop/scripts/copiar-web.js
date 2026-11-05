/* Copia a interface web (index.html, css, js) da raiz do projeto para desktop/web.
   Assim o app de Windows usa exatamente os mesmos arquivos da versão web: mudou na web, mudou no desktop. */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const DESTINO = path.resolve(__dirname, '..', 'web');
const ITENS = ['index.html', 'css', 'js'];

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });
for (const item of ITENS) {
  const de = path.join(RAIZ, item);
  if (!fs.existsSync(de)) { console.error('Arquivo da versão web não encontrado: ' + de); process.exit(1); }
  fs.cpSync(de, path.join(DESTINO, item), { recursive: true });
}
console.log('Interface web copiada para desktop/web');
