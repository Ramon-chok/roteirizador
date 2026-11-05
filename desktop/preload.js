/* Informa à interface web que ela está rodando no app de Windows. Nada além disso é exposto. */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('rrmDesktop', {
  desktop: true,
  plataforma: process.platform,
  versaoElectron: process.versions.electron
});
