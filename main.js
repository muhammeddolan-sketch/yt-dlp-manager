const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, globalShortcut, shell } = require('electron');
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
const crypto = require('crypto');
const { fork } = require('child_process');
const http = require('http');

// Must match server.js getAppDataDir(): both processes share the API token file.
function getUniGetDataDir() {
    const homeDir = require('os').homedir();
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'uniget');
    }
    return path.join(homeDir, '.config', 'uniget');
}

let apiToken = null;
function ensureApiToken() {
    if (apiToken) return apiToken;
    const tokenPath = path.join(getUniGetDataDir(), 'api-token');
    try {
        const existing = fs.readFileSync(tokenPath, 'utf8').trim();
        if (/^[a-f0-9]{64}$/.test(existing)) return (apiToken = existing);
    } catch (e) {}
    apiToken = crypto.randomBytes(32).toString('hex');
    try {
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(tokenPath, apiToken, { mode: 0o600 });
    } catch (e) {}
    return apiToken;
}

// Optimization: Disable hardware acceleration
app.disableHardwareAcceleration();

// Windows may only show our own UI; anything else (links in remote metadata,
// window.open, drag-and-drop) goes to the system browser or is dropped.
function isAppUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') {
            return path.resolve(decodeURIComponent(parsed.pathname).replace(/^\/([a-zA-Z]:)/, '$1')) === path.join(__dirname, 'public', 'mini.html');
        }
        return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === '3000';
    } catch {
        return false;
    }
}

function openExternalIfWeb(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(parsed.toString());
    } catch (e) {}
}

app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        openExternalIfWeb(url);
        return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
        if (!isAppUrl(url)) {
            event.preventDefault();
            openExternalIfWeb(url);
        }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
});

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

// ─── Auto-update (electron-updater) ───────────────────────────────
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 saat
let updateCheckInFlight = false;
let updateState = { status: 'idle', currentVersion: app.getVersion() };

function broadcastUpdateState(patch = {}) {
    updateState = { ...updateState, ...patch, updatedAt: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('update-status', updateState); } catch (e) {}
    }
    return updateState;
}

function setupAutoUpdater() {
    if (!autoUpdater || !app.isPackaged) return;
    try {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
    } catch (e) {}
    autoUpdater.on('checking-for-update', () => broadcastUpdateState({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => broadcastUpdateState({ status: 'available', latestVersion: info?.version || null }));
    autoUpdater.on('update-not-available', (info) => broadcastUpdateState({ status: 'up-to-date', latestVersion: info?.version || null }));
    autoUpdater.on('download-progress', (progress) => broadcastUpdateState({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))),
        bytesPerSecond: progress?.bytesPerSecond || 0
    }));
    autoUpdater.on('update-downloaded', (info) => broadcastUpdateState({ status: 'downloaded', latestVersion: info?.version || null }));
    autoUpdater.on('error', (err) => broadcastUpdateState({
        status: 'error',
        error: String(err?.message || err || 'güncelleme hatası').slice(0, 300)
    }));
}

async function checkForUpdates() {
    if (!app.isPackaged) return broadcastUpdateState({ status: 'disabled' });
    if (!autoUpdater) return broadcastUpdateState({ status: 'error', error: 'Güncelleme modülü bulunamadı' });
    if (updateCheckInFlight) return updateState;
    updateCheckInFlight = true;
    try {
        await autoUpdater.checkForUpdates();
    } catch (e) {
        broadcastUpdateState({ status: 'error', error: String(e?.message || e).slice(0, 300) });
    } finally {
        updateCheckInFlight = false;
    }
    return updateState;
}

async function downloadUpdate() {
    if (!app.isPackaged || !autoUpdater) return { success: false, error: 'Güncelleme yalnızca kurulu sürümde çalışır' };
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (e) {
        broadcastUpdateState({ status: 'error', error: String(e?.message || e).slice(0, 300) });
        return { success: false, error: e?.message || 'indirme başarısız' };
    }
}

function installUpdate() {
    if (!app.isPackaged || !autoUpdater) return { success: false, error: 'Güncelleme yalnızca kurulu sürümde çalışır' };
    isQuitting = true;
    setImmediate(() => {
        try {
            autoUpdater.quitAndInstall();
        } catch (e) {
            isQuitting = false;
            broadcastUpdateState({ status: 'error', error: String(e?.message || e).slice(0, 300) });
        }
    });
    return { success: true };
}

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

const pairDialogTexts = {
    tr: { message: 'Bir tarayıcı yardımcısı UniGet\'e bağlanmak istiyor.', detail: 'Kaynak: {origin}\n\nİzin verirseniz bu yardımcı UniGet\'e indirme gönderebilir. Tarayıcıda UniGet düğmesine az önce siz basmadıysanız Reddet\'i seçin.', allow: 'İzin Ver', deny: 'Reddet', unknown: 'bilinmeyen yerel istemci' },
    en: { message: 'A browser helper wants to connect to UniGet.', detail: 'Source: {origin}\n\nIf you allow it, this helper can send downloads to UniGet. Choose Deny unless you just clicked a UniGet button in your browser.', allow: 'Allow', deny: 'Deny', unknown: 'unknown local client' },
    de: { message: 'Ein Browser-Helfer möchte sich mit UniGet verbinden.', detail: 'Quelle: {origin}\n\nWenn Sie zustimmen, kann dieser Helfer Downloads an UniGet senden. Wählen Sie Ablehnen, wenn Sie nicht gerade im Browser auf eine UniGet-Schaltfläche geklickt haben.', allow: 'Erlauben', deny: 'Ablehnen', unknown: 'unbekannter lokaler Client' },
    fr: { message: 'Un assistant de navigateur souhaite se connecter à UniGet.', detail: 'Source : {origin}\n\nSi vous l\'autorisez, cet assistant pourra envoyer des téléchargements à UniGet. Choisissez Refuser si vous n\'avez pas cliqué sur un bouton UniGet dans votre navigateur.', allow: 'Autoriser', deny: 'Refuser', unknown: 'client local inconnu' },
    es: { message: 'Un asistente del navegador quiere conectarse a UniGet.', detail: 'Origen: {origin}\n\nSi lo permites, este asistente podrá enviar descargas a UniGet. Elige Rechazar si no acabas de pulsar un botón de UniGet en tu navegador.', allow: 'Permitir', deny: 'Rechazar', unknown: 'cliente local desconocido' }
};
let currentLang = 'tr';

async function handlePairRequest(child, msg) {
    const t = pairDialogTexts[currentLang] || pairDialogTexts.en;
    const origin = String(msg.origin || '') || t.unknown;
    // The server forgets the request after 120s; close the dialog before that.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 115000);
    let approved = false;
    try {
        createMainWindow();
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) mainWindow.restore();
        const options = {
            type: 'question',
            title: 'UniGet',
            message: t.message,
            detail: t.detail.replace('{origin}', origin),
            buttons: [t.deny, t.allow],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            signal: controller.signal
        };
        const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
        const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        approved = result.response === 1;
    } catch (e) {
        approved = false;
    } finally {
        clearTimeout(timer);
    }
    try {
        if (child.connected) child.send({ type: 'pair-response', requestId: msg.requestId, approved });
    } catch (e) {}
}

async function startServer() {
    ensureApiToken();
    // If something is already listening (likely a previous instance), don't start a new one.
    const alive = await isServerAlive('http://127.0.0.1:3000');
    if (alive) return;

    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: '3000', UNIGET_API_TOKEN: ensureApiToken() }
    });

    serverProcess.on('message', (msg) => {
        if (msg && msg.type === 'pair-request' && typeof msg.requestId === 'string') {
            handlePairRequest(serverProcess, msg);
        }
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
        width: 1180,
        height: 720,
        minWidth: 860,
        minHeight: 560,
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
    // Version-tagged URL bypasses stale HTTP-cached documents after an update.
    const appUrl = `http://127.0.0.1:3000/?v=${encodeURIComponent(app.getVersion())}`;
    try {
        await waitForServer('http://127.0.0.1:3000');
        if (mainWindow && !mainWindow.isDestroyed()) {
            await mainWindow.loadURL(appUrl);
        }
    } catch (error) {
        dialog.showErrorBox('Server Error', 'UniGet backend server failed to start. Please try restarting the application.');
        if (mainWindow && !mainWindow.isDestroyed()) {
            await mainWindow.loadURL(appUrl);
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
    if (typeof lang === 'string' && pairDialogTexts[lang]) currentLang = lang;
    updateTrayMenu(lang);
});

// Only our own UI may read the API token.
ipcMain.handle('get-api-token', (event) => {
    let senderUrl = '';
    try { senderUrl = event.senderFrame ? event.senderFrame.url : ''; } catch (e) {}
    try {
        const parsed = new URL(senderUrl);
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '3000') return null;
    } catch (e) {
        return null;
    }
    return ensureApiToken();
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

ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:download', () => downloadUpdate());
ipcMain.handle('update:install', () => installUpdate());
ipcMain.handle('update:status', () => updateState);

// Open the managed sideload folder so the user can load/refresh the
// unpacked extension once; the app keeps its files up to date.
ipcMain.handle('extension:open-folder', async () => {
    const appData = process.env.APPDATA || require('path').join(require('os').homedir(), 'AppData', 'Roaming');
    const extDir = require('path').join(appData, 'uniget', 'extension');
    try {
        if (!require('fs').existsSync(extDir)) require('fs').mkdirSync(extDir, { recursive: true });
        if (shell && typeof shell.openPath === 'function') {
            const err = await shell.openPath(extDir);
            if (err) return { ok: false, error: err, path: extDir };
        }
        return { ok: true, path: extDir };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), path: extDir };
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
    setupAutoUpdater();
    if (app.isPackaged && autoUpdater) {
        setTimeout(() => { checkForUpdates(); }, 10000);
        const timer = setInterval(() => { checkForUpdates(); }, UPDATE_CHECK_INTERVAL_MS);
        if (timer.unref) timer.unref();
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
