/* Gera build/icon.png a partir do logo se ele ainda não existir (o instalador precisa do ícone). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const icone = path.join(__dirname, '..', 'build', 'icon.png');
if (fs.existsSync(icone)) { console.log('Ícone: ' + icone); process.exit(0); }
fs.mkdirSync(path.dirname(icone), { recursive: true });
const r = spawnSync(process.execPath, [path.join(__dirname, 'rodar-electron.js'), path.join(__dirname, 'gerar-icone.js')], { stdio: 'inherit' });
if (r.status !== 0 || !fs.existsSync(icone)) { console.error('Não foi possível gerar o ícone (build/icon.png).'); process.exit(1); }
