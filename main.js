const { app, BrowserWindow, ipcMain, screen, Tray, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// SINGLE INSTANCE LOCK
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
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
        width: 1200,
        height: 800,
        title: "YT-DLM Downloader",
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
            mainWindow.hide();
        }
        return false;
    });

    mainWindow.on('hide', () => {
        if (miniWindow) miniWindow.show();
    });

    mainWindow.on('show', () => {
        if (miniWindow) miniWindow.hide();
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
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
            }
        }},
        { label: 'İndirmeleri Aç', click: () => {
             mainWindow.show();
             mainWindow.focus();
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
        mainWindow.show();
    });
}

function createMiniWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    miniWindow = new BrowserWindow({
        width: 130,
        height: 45,
        x: width - 140,
        y: height - 60,
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
}

ipcMain.on('open-main', () => {
    if (mainWindow) {
        mainWindow.focus();
    } else {
        createMainWindow();
    }
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
