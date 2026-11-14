import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sygmaDesktop', {
  getRuntimeInfo: () => ipcRenderer.invoke('sygma:get-runtime-info'),
});
