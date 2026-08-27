'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokengotchi', {
  onState: (handler) => ipcRenderer.on('pet:state', (_event, state) => handler(state)),
  snapshot: () => ipcRenderer.invoke('pet:snapshot'),
  hatch: () => ipcRenderer.invoke('pet:hatch'),
  rename: (name) => ipcRenderer.invoke('pet:rename', name),
  onRenameRequest: (handler) => ipcRenderer.on('pet:rename-request', () => handler()),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  openUpdate: () => ipcRenderer.send('update:open')
});
