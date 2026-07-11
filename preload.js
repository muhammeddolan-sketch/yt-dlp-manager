const { contextBridge, ipcRenderer, clipboard, shell } = require('electron');

const allowedExternalProtocols = new Set(['http:', 'https:']);

contextBridge.exposeInMainWorld('unigetAPI', {
    changeLang: (lang) => ipcRenderer.send('change-lang', lang),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    focusWindow: () => ipcRenderer.send('focus-window'),
    openMain: () => ipcRenderer.send('open-main'),
    setAlwaysOnTop: (enabled) => ipcRenderer.send('toggle-always-on-top', !!enabled),
    getAutostart: () => ipcRenderer.invoke('get-autostart'),
    setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', !!enabled),
    readClipboardText: () => clipboard.readText(),
    openExternal: (url) => {
        try {
            const parsed = new URL(url);
            if (!allowedExternalProtocols.has(parsed.protocol)) return false;
            shell.openExternal(parsed.toString());
            return true;
        } catch {
            return false;
        }
    }
});
