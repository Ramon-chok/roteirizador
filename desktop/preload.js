/* Informa à interface web que ela está rodando no app de Windows e oferece só o necessário: versão, atualização e "Sobre". */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rrmDesktop', {
  desktop: true,
  plataforma: process.platform,
  versaoElectron: process.versions.electron,
  versao: () => ipcRenderer.invoke('rrm:versao'),
  verificarAtualizacao: () => ipcRenderer.invoke('rrm:atualizar'),
  sobre: () => ipcRenderer.invoke('rrm:sobre')
});
