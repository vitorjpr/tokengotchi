'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokengotchi', {
  onState: (handler) => ipcRenderer.on('pet:state', (_event, state) => handler(state)),
  snapshot: () => ipcRenderer.invoke('pet:snapshot'),
  hatch: () => ipcRenderer.invoke('pet:hatch'),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit')
});
