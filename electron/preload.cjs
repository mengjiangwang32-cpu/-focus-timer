const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('focusApp', {
  getState: () => ipcRenderer.invoke('focus:get'),
  command: command => ipcRenderer.invoke('focus:command', command),
  fullscreen: enabled => ipcRenderer.invoke('focus:fullscreen', enabled),
  confirm: options => ipcRenderer.invoke('focus:confirm', options),
  exportBackup: () => ipcRenderer.invoke('focus:export'),
  importBackup: () => ipcRenderer.invoke('focus:import'),
  openDataDirectory: () => ipcRenderer.invoke('focus:directory'),
  onUpdate: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('focus:update', listener);
    return () => ipcRenderer.removeListener('focus:update', listener);
  }
});
