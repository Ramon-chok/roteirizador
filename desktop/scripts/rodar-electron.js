/* Abre o Electron sem a variável ELECTRON_RUN_AS_NODE (o terminal do VS Code a define e ela faz o Electron rodar como Node). */
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env, windowsHide: false });
p.on('close', code => process.exit(code ?? 0));
