const { app, BrowserWindow, ipcMain, screen, Tray, Menu } = require('electron');
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

function startServer() {
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: 3000 }
    });
}

function createMainWindow() {
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

    mainWindow.on('hide', () => {
        // Disabled mini window popup when the main window hides
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
    // Note: Usually tray needs a .png or .ico. I'll use a placeholder or system icon if I can.
    // Since I don't have a dedicated icon file, I'll try to find a system icon or just use a label.
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'YT-DLM UniDownloader', enabled: false },
        { type: 'separator' },
        { label: 'Göster / Gizle', click: () => {
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
        { label: 'İndirmeleri Aç', click: () => {
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
        { label: 'Kapat', click: () => {
            isQuitting = true;
            app.quit();
        }}
    ]);

    tray.setToolTip('YT-DLM UniDownloader');
    tray.setContextMenu(contextMenu);

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
        skipTaskbar: true, // Don't show in taskbar
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    miniWindow.loadFile(path.join(__dirname, 'public', 'mini.html'));
    miniWindow.hide(); // Start hidden

    miniWindow.on('closed', () => {
        miniWindow = null;
    });
}

ipcMain.on('open-main', () => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createMainWindow();
        }
    } catch(e) {}
});

app.on('ready', () => {
    if (!gotTheLock) return;
    startServer();
    createTray();
    createMiniWindow();
    createMainWindow();
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
