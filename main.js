const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// SINGLE INSTANCE LOCK
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
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

function startServer() {
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: 3000 }
    });
}

const trayTranslations = {
    tr: { title: 'YT-DLM UniDownloader', show: 'Göster / Gizle', open: 'İndirmeleri Aç', exit: 'Kapat' },
    en: { title: 'YT-DLM UniDownloader', show: 'Show / Hide', open: 'Open Downloads', exit: 'Exit' },
    de: { title: 'YT-DLM UniDownloader', show: 'Anzeigen / Ausblenden', open: 'Downloads öffnen', exit: 'Beenden' },
    fr: { title: 'YT-DLM UniDownloader', show: 'Afficher / Masquer', open: 'Ouvrir les téléchargements', exit: 'Quitter' },
    es: { title: 'YT-DLM UniDownloader', show: 'Mostrar / Ocultar', open: 'Abrir descargas', exit: 'Salir' }
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
        title: "YT-DLM Downloader",
        icon: path.join(__dirname, 'public', 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 1000);

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

function createTray() {
    tray = new Tray(path.join(__dirname, 'public', 'icon.png'));
    tray.setToolTip('YT-DLM UniDownloader');
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
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    miniWindow = new BrowserWindow({
        width: 130,
        height: 45,
        x: width - 140,
        y: height - 60,
        icon: path.join(__dirname, 'public', 'icon.png'),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
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

app.on('ready', () => {
    if (!gotTheLock) return;
    startServer();
    createTray();
    createMiniWindow();
    if (!isHiddenStartup) {
        createMainWindow();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});
