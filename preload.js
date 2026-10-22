const { contextBridge, ipcRenderer, clipboard, shell } = require('electron');

const allowedExternalProtocols = new Set(['http:', 'https:']);

contextBridge.exposeInMainWorld('unigetAPI', {
    changeLang: (lang) => ipcRenderer.send('change-lang', lang),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getApiToken: () => ipcRenderer.invoke('get-api-token'),
    focusWindow: () => ipcRenderer.send('focus-window'),
    openMain: () => ipcRenderer.send('open-main'),
    setAlwaysOnTop: (enabled) => ipcRenderer.send('toggle-always-on-top', !!enabled),
    getAutostart: () => ipcRenderer.invoke('get-autostart'),
    setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', !!enabled),
    setHotkey: (hotkey) => ipcRenderer.invoke('set-hotkey', String(hotkey || '')),
    getUpdateStatus: () => ipcRenderer.invoke('update:status'),
    openExtensionFolder: () => ipcRenderer.invoke('extension:open-folder'),
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    downloadUpdate: () => ipcRenderer.invoke('update:download'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    onUpdateStatus: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('update-status', listener);
        return () => ipcRenderer.removeListener('update-status', listener);
    },
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
