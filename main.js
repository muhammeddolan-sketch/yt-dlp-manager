const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, globalShortcut } = require('electron');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

function getAppConfig() {
    try {
        const homeDir = require('os').homedir();
        let cp;
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA || require('path').join(homeDir, 'AppData', 'Roaming');
            cp = require('path').join(appData, 'uniget', 'config.json');
        } else {
            cp = require('path').join(homeDir, '.config', 'uniget', 'config.json');
        }
        if (require('fs').existsSync(cp)) {
            return JSON.parse(require('fs').readFileSync(cp, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function getGlobalHotkey() {
    const cfg = getAppConfig();
    return (cfg && cfg.globalHotkey) ? String(cfg.globalHotkey) : 'CommandOrControl+Shift+U';
}
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const http = require('http');

// Optimization: Disable hardware acceleration
app.disableHardwareAcceleration();

if (!app.isPackaged) {
    app.setPath('userData', path.join(__dirname, '.tmp', 'electron-user-data'));
}

// SINGLE INSTANCE LOCK
const gotTheLock = !app.isPackaged || app.requestSingleInstanceLock();
app.setName('UniGet');
app.setAppUserModelId('com.uniget.app');

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            } else {
                createMainWindow();
            }
        } catch (e) {}
    });
}

let mainWindow;
let miniWindow;
let tray;
let serverProcess;
let isQuitting = false;
const isHiddenStartup = process.argv.includes('--hidden');

function isServerAlive(url, timeoutMs = 600) {
    return new Promise((resolve) => {
        const checkUrl = url.endsWith('/') ? url + 'api/health' : url + '/api/health';
        const req = http.get(checkUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.status === 'ok' && json.app === 'UniGet');
                } catch (e) {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function startServer() {
    // If something is already listening (likely a previous instance), don't start a new one.
    const alive = await isServerAlive('http://127.0.0.1:3000');
    if (alive) return;

    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: '3000' }
    });

    serverProcess.on('error', (err) => {
        console.error('Failed to start server process:', err);
    });

    serverProcess.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM') {
            console.error(`Server process exited with code ${code} and signal ${signal}`);
        }
    });
}

const trayTranslations = {
    tr: { title: 'UniGet', show: 'Göster / Gizle', open: 'İndirmeleri Aç', exit: 'Kapat' },
    en: { title: 'UniGet', show: 'Show / Hide', open: 'Open Downloads', exit: 'Exit' },
    de: { title: 'UniGet', show: 'Anzeigen / Ausblenden', open: 'Downloads öffnen', exit: 'Beenden' },
    fr: { title: 'UniGet', show: 'Afficher / Masquer', open: 'Ouvrir les téléchargements', exit: 'Quitter' },
    es: { title: 'UniGet', show: 'Mostrar / Ocultar', open: 'Abrir descargas', exit: 'Salir' }
};

function updateTrayMenu(lang = 'tr') {
    if (!tray) return;
    const t = trayTranslations[lang] || trayTranslations['tr'];
    
    const contextMenu = Menu.buildFromTemplate([
        { label: t.title, enabled: false },
        { type: 'separator' },
        { label: t.show, click: () => {
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                    }
                } else {
                    createMainWindow();
                }
            } catch(e) {}
        }},
        { label: t.open, click: () => {
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                } else {
                    createMainWindow();
                }
            } catch(e) {}
        }},
        { type: 'separator' },
        { label: t.exit, click: () => {
            isQuitting = true;
            app.quit();
        }}
    ]);

    tray.setContextMenu(contextMenu);
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 750,
        height: 550,
        title: "UniGet",
        icon: path.join(__dirname, 'public', 'icon.png'),
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#120f1d',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: true,
            spellcheck: false,
            enableWebSQL: false,
            v8CacheOptions: 'bypassHeatCheckAndEagerCompile',
            webgl: false,
            navigateOnDragDrop: false,
            autoplayPolicy: 'document-user-activation-required'
        }
    });

    // Remove menu to save memory if not needed
    mainWindow.setMenu(null);

    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    });

    loadMainWindowWhenServerReady();

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            try { if (!mainWindow.isDestroyed()) mainWindow.hide(); } catch(e) {}
        }
        return false;
    });

    mainWindow.on('show', () => {
        try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide(); } catch (e) {}
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function waitForServer(url, retries = 30, delayMs = 200) {
    return new Promise((resolve, reject) => {
        const tryConnect = (attempt) => {
            const req = http.get(url, (res) => {
                res.resume();
                resolve();
            });

            req.on('error', () => {
                if (attempt >= retries) {
                    reject(new Error(`Server not ready after ${retries} attempts`));
                    return;
                }
                setTimeout(() => tryConnect(attempt + 1), delayMs);
            });

            req.setTimeout(800, () => {
                req.destroy();
            });
        };

        tryConnect(1);
    });
}

async function loadMainWindowWhenServerReady() {
    try {
        await waitForServer('http://127.0.0.1:3000');
        if (mainWindow && !mainWindow.isDestroyed()) {
            await mainWindow.loadURL('http://127.0.0.1:3000');
        }
    } catch (error) {
        dialog.showErrorBox('Server Error', 'UniGet backend server failed to start. Please try restarting the application.');
        if (mainWindow && !mainWindow.isDestroyed()) {
            await mainWindow.loadURL('http://127.0.0.1:3000');
        }
    }
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'public', 'icon.png'));
    tray.setToolTip('UniGet');
    updateTrayMenu('tr');

    tray.on('double-click', () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
            } else {
                createMainWindow();
            }
        } catch(e) {}
    });
}

function createMiniWindow() {
    if (miniWindow && !miniWindow.isDestroyed()) {
        return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    let savedBounds = null;
    try {
        const bp = path.join(app.getPath('userData'), 'mini-window-bounds.json');
        if (fs.existsSync(bp)) savedBounds = JSON.parse(fs.readFileSync(bp, 'utf8'));
    } catch (e) {}

    miniWindow = new BrowserWindow({
        width: 130,
        height: 45,
        x: (savedBounds && Number.isFinite(savedBounds.x)) ? savedBounds.x : width - 140,
        y: (savedBounds && Number.isFinite(savedBounds.y)) ? savedBounds.y : height - 60,
        icon: path.join(__dirname, 'public', 'icon.png'),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: true,
            spellcheck: false,
            enableWebSQL: false,
            webgl: false
        }
    });

    miniWindow.on('moved', () => {
        try {
            if (!miniWindow || miniWindow.isDestroyed()) return;
            const b = miniWindow.getBounds();
            fs.writeFileSync(path.join(app.getPath('userData'), 'mini-window-bounds.json'), JSON.stringify(b));
        } catch (e) {}
    });
    miniWindow.loadFile(path.join(__dirname, 'public', 'mini.html'));
    miniWindow.hide();

    miniWindow.on('closed', () => {
        miniWindow = null;
    });
}

ipcMain.on('open-main', () => {
    createMainWindow();
});

ipcMain.on('focus-window', () => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } else {
            createMainWindow();
        }
    } catch(e) {}
});

ipcMain.on('toggle-always-on-top', (event, isAlwaysOnTop) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
});

ipcMain.on('change-lang', (event, lang) => {
    updateTrayMenu(lang);
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

// Autostart is only meaningful for the packaged app; in dev it reports unsupported.
ipcMain.handle('get-autostart', () => {
    if (!app.isPackaged) return { supported: false, enabled: false };
    return { supported: true, enabled: !!app.getLoginItemSettings().openAtLogin };
});

ipcMain.handle('set-autostart', (event, enabled) => {
    if (!app.isPackaged) return { supported: false, enabled: false };
    app.setLoginItemSettings({
        openAtLogin: !!enabled,
        path: app.getPath('exe'),
        args: ['--hidden']
    });
    return { supported: true, enabled: !!enabled };
});

ipcMain.handle('set-hotkey', (event, hotkey) => {
    try {
        globalShortcut.unregisterAll();
        const hk = String(hotkey || '').trim() || getGlobalHotkey();
        const ok = globalShortcut.register(hk, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            } else {
                createMainWindow();
            }
        });
        return { success: !!ok, hotkey: hk };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

app.on('ready', () => {
    if (!gotTheLock) return;

    // Autostart is opt-in: do not enable it silently on first run.
    // The in-app toggle (set-autostart) remains the only way to enable it.

    startServer();
    createTray();

    // Global hotkey to show/focus the app
    try {
        globalShortcut.register(getGlobalHotkey(), () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            } else {
                createMainWindow();
            }
        });
    } catch (e) {}

    // Auto-update (packaged builds only)
    if (app.isPackaged && autoUpdater) {
        try {
            autoUpdater.autoDownload = true;
            autoUpdater.autoInstallOnAppQuit = true;
            autoUpdater.checkForUpdatesAndNotify().catch(() => {});
        } catch (e) {}
    }
    if (!isHiddenStartup) {
        createMainWindow();
    } else {
        createMiniWindow();
        if (miniWindow && !miniWindow.isDestroyed()) miniWindow.show();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // Ensure child process is killed properly when the app quits
    if (serverProcess) {
        try {
            serverProcess.kill('SIGTERM');
        } catch(e) {}
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverProcess) {
            try { serverProcess.kill('SIGTERM'); } catch(e) {}
        }
        app.quit();
    }
});
