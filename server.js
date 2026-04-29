const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'],
    perMessageDeflate: false,
    pingInterval: 25000,
    pingTimeout: 20000
});

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const homeDir = os.homedir();

// ─── Cached tool checks ───────────────────────────────────────────
let _cachedYtDlpPath = null;
let _cachedFfmpegAvailable = null;

function getConfigPath() {
    // On Windows, prefer AppData; on *nix keep ~/.config
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        return path.join(appData, 'uniget', 'config.json');
    }
    return path.join(homeDir, '.config', 'uniget', 'config.json');
}

let appConfig = {
    downloadDir: (() => {
        if (process.platform === 'win32') return path.join(homeDir, 'Videos', 'IDM');
        // Turkish/English folder variance on some Linux desktops
        const tr = path.join(homeDir, 'Videolar', 'IDM');
        const en = path.join(homeDir, 'Videos', 'IDM');
        return fs.existsSync(path.join(homeDir, 'Videolar')) ? tr : en;
    })(),
    powerMode: 'auto',
    rateLimitKbps: 0,
    smartRetry: true,
    lowNoiseNotifications: true
};

try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) appConfig = JSON.parse(fs.readFileSync(cp, 'utf8'));
    else {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, JSON.stringify(appConfig, null, 2));
    }
} catch(e) {}

let DOWNLOADS_DIR = appConfig.downloadDir;

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors());
app.use(compression());
app.use(express.json());
// Static assets with long cache (css, js, images don't change between restarts)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

let downloads = {};
const progressEmitState = {};

// ─── Request Deduplication & Cache ────────────────────────────────
const infoCache = new Map(); // Simple cache: URL -> Promise
const MAX_INFO_CACHE_SIZE = 20;

function addToInfoCache(url, promise) {
    if (infoCache.size >= MAX_INFO_CACHE_SIZE) {
        const firstKey = infoCache.keys().next().value;
        infoCache.delete(firstKey);
    }
    infoCache.set(url, promise);
}

// ─── Concurrent download limiter ──────────────────────────────────
const MAX_CONCURRENT = 5;

function getActiveDownloadCount() {
    let count = 0;
    for (const id in downloads) {
        const st = downloads[id].status;
        if (st === 'downloading' || st === 'starting') count++;
    }
    return count;
}

function getAppDataDir() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'uniget');
    }
    return path.join(os.homedir(), '.config', 'uniget');
}

function getBundledYtDlpPath() {
    // Preferred location we control (works in dev + packaged).
    const binDir = path.join(getAppDataDir(), 'bin');
    const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    return path.join(binDir, exe);
}

function resolveYtDlpCmd() {
    const bundled = getBundledYtDlpPath();
    if (fs.existsSync(bundled)) return bundled;

    // Fallback to PATH.
    if (process.platform === 'win32') return 'yt-dlp.exe';
    return 'yt-dlp';
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const file = fs.createWriteStream(destPath);

        const request = https.get(url, { headers: { 'User-Agent': 'UniGet Pro v1.5.1' } }, (res) => {
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close(() => {
                    try { fs.unlinkSync(destPath); } catch {}
                    downloadFile(res.headers.location, destPath).then(resolve, reject);
                });
                return;
            }

            if (res.statusCode !== 200) {
                file.close(() => {
                    try { fs.unlinkSync(destPath); } catch {}
                    reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                });
                return;
            }

            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        });

        request.on('error', (err) => {
            file.close(() => {
                try { fs.unlinkSync(destPath); } catch {}
                reject(err);
            });
        });
    });
}

async function ensureYtDlpAvailable() {
    // Return cached path if already resolved
    if (_cachedYtDlpPath) return _cachedYtDlpPath;

    const cmd = resolveYtDlpCmd();
    if (cmd !== 'yt-dlp' && cmd !== 'yt-dlp.exe') {
        _cachedYtDlpPath = cmd;
        return cmd; // bundled exists
    }

    // If PATH has it, leave as-is (can't reliably check without spawning).
    // We'll only auto-download on Windows where this is the common failure.
    if (process.platform !== 'win32') {
        _cachedYtDlpPath = cmd;
        return cmd;
    }

    const bundled = getBundledYtDlpPath();
    if (fs.existsSync(bundled)) {
        _cachedYtDlpPath = bundled;
        return bundled;
    }

    // Download yt-dlp.exe (stable) from official GitHub release.
    // If GitHub is blocked, the spawn handler will show a clear error.
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    try {
        await downloadFile(url, bundled);
        _cachedYtDlpPath = bundled;
        return bundled;
    } catch (e) {
        console.warn('Failed to auto-download yt-dlp:', e?.message || e);
        _cachedYtDlpPath = cmd;
        return cmd;
    }
}

function checkToolAvailable(cmd, args = ['-version']) {
    return new Promise((resolve) => {
        const p = spawn(cmd, args);
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };
        p.once('error', () => done(false));
        p.once('close', (code) => done(code === 0));
    });
}

async function hasFfmpeg() {
    // Return cached result after first check
    if (_cachedFfmpegAvailable !== null) return _cachedFfmpegAvailable;

    let result;
    if (process.platform === 'win32') {
        // Check both typical executable names on Windows.
        result = await checkToolAvailable('ffmpeg.exe');
        if (!result) result = await checkToolAvailable('ffmpeg');
    } else {
        result = await checkToolAvailable('ffmpeg');
    }
    _cachedFfmpegAvailable = result;
    return result;
}

// ─── Optimised progress emission ──────────────────────────────────
function emitDownloadProgress(dl, force = false) {
    const now = Date.now();
    const state = progressEmitState[dl.id] || { ts: 0, lastData: null };
    if (!force && now - state.ts < 400) return;  // Throttle to 400ms (was 300ms)

    // Build a minimal payload
    const payload = {
        id: dl.id,
        progress: dl.progress,
        speed: dl.speed,
        eta: dl.eta,
        status: dl.status
    };

    // Title and quality rarely change, only send if forced or first time
    if (force) {
        payload.title = dl.title;
        payload.quality = dl.quality;
        payload.isPlaylist = dl.isPlaylist;
    }

    progressEmitState[dl.id] = { ts: now, lastData: payload };
    // Use volatile emit for non-critical progress updates (drops if client can't keep up)
    if (force) {
        io.emit('progress', payload);
    } else {
        io.volatile.emit('progress', payload);
    }
}

io.on('connection', (socket) => {
    // Send a clean copy without process handles
    const safeDownloads = {};
    for (const id in downloads) {
        const { process: _p, ...rest } = downloads[id];
        safeDownloads[id] = rest;
    }
    socket.emit('initial-state', safeDownloads);
});

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Deduplicate concurrent requests for the same URL
    if (infoCache.has(url)) {
        try {
            const info = await infoCache.get(url);
            return res.json(info);
        } catch (e) {
            return res.status(500).json({ error: e.message || 'yt-dlp failed' });
        }
    }

    const infoPromise = new Promise(async (resolve, reject) => {
        const ytDlpCmd = await ensureYtDlpAvailable();
        const proc = spawn(ytDlpCmd, ['-j', '--no-playlist', url]);
        let output = '';
        let stderr = '';

        proc.stdout.on('data', (data) => output += data);
        proc.stderr.on('data', (data) => {
            if (stderr.length < 4096) stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch {}
            reject(new Error('Timeout fetching info'));
        }, 30000);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                try {
                    const info = JSON.parse(output);
                    const result = {
                        title: info.title,
                        thumbnail: info.thumbnail,
                        duration: info.duration_string,
                        uploader: info.uploader
                    };
                    resolve(result);
                } catch (e) {
                    reject(new Error('Failed to parse info'));
                }
            } else {
                reject(new Error('yt-dlp failed'));
            }
            // Clear from cache after a short delay (e.g. 5s) to allow new requests if needed
            setTimeout(() => infoCache.delete(url), 5000);
        });
    });

    addToInfoCache(url, infoPromise);

    try {
        const info = await infoPromise;
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function startDownloadTask(id) {
    const dl = downloads[id];

    // Enforce concurrent download limit
    if (getActiveDownloadCount() >= MAX_CONCURRENT) {
        dl.status = 'queued';
        emitDownloadProgress(dl, true);
        // Re-check after a delay
        setTimeout(() => {
            if (downloads[id] && dl.status === 'queued') startDownloadTask(id);
        }, 3000);
        return;
    }

    const ffmpegAvailable = await hasFfmpeg();
    let formatOption = ffmpegAvailable
        ? 'bestvideo[height<=2160]+bestaudio/best[height<=2160]'
        : 'best[ext=mp4]/best';

    if (ffmpegAvailable) {
        if (dl.quality === '2160') formatOption = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]';
        else if (dl.quality === '1440') formatOption = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]';
        else if (dl.quality === '1080') formatOption = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
        else if (dl.quality === '720') formatOption = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
        else if (dl.quality === '480') formatOption = 'bestvideo[height<=480]+bestaudio/best[height<=480]';
    } else {
        if (dl.quality === '1080') formatOption = 'best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best';
        else if (dl.quality === '720') formatOption = 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best';
        else if (dl.quality === '480') formatOption = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
    }

    const mode = dl.effectivePowerMode || 'normal';
    const modeThreads = {
        eco: 3,
        normal: 6,
        performance: 8
    };
    const turboThreads = modeThreads[mode] || 6;
    const retryLimit = dl.retryEnabled ? 3 : 1;
    const rateLimitKbps = Number.parseInt(dl.rateLimitKbps || 0, 10) || 0;
    let args = [
        '--newline',
        dl.isPlaylist ? '--yes-playlist' : '--no-playlist',
        '--force-overwrites',
        '--no-abort-on-error',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--extractor-args', 'youtube:player-client=android,web;player-skip=webpage,configs',
        '--progress',
        '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--retries', String(retryLimit),
        '-N', String(turboThreads)
    ];

    if (ffmpegAvailable) {
        args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart');
        args.push('--embed-metadata');
        args.push('--embed-thumbnail');
    }

    if (rateLimitKbps > 0) {
        args.push('--limit-rate', `${rateLimitKbps}K`);
    }

    // Trimming support
    if (dl.startTime || dl.endTime) {
        const start = dl.startTime || '00:00:00';
        const end = dl.endTime || '99:59:59';
        args.push('--download-sections', `*${start}-${end}`);
        args.push('--force-keyframes-at-cuts');
    }

    if (dl.quality === 'audio') {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push('--format', formatOption);
        if (ffmpegAvailable) {
            args.push('--merge-output-format', 'mp4');
        } else {
            // Without ffmpeg, force single-file progressive streams to avoid separate audio/video files.
            dl.status = 'ffmpeg yok: tek dosya (progressive) format kullaniliyor';
            emitDownloadProgress(dl, true);
        }
    }
    args.push('-P', DOWNLOADS_DIR, '-o', '%(title)s.%(ext)s', dl.url);

    const ytDlpCmd = await ensureYtDlpAvailable();
    console.log(`Starting yt-dlp with args: ${ytDlpCmd} ${args.join(' ')}`);
    dl.process = spawn(ytDlpCmd, args);
    dl.status = 'downloading';

    dl.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            if (line.includes('|')) {
                const parts = line.split('|');
                if (parts.length >= 3) {
                    dl.progress = parseFloat(parts[0].replace('%', '').trim()) || dl.progress;
                    dl.speed = parts[1].trim();
                    dl.eta = parts[2].trim();
                    emitDownloadProgress(dl);
                }
            }
        }
    });

    dl.process.on('error', (err) => {
        console.error('Download spawn error:', err);
        if (err && err.code === 'ENOENT') {
            dl.status = 'Hata: yt-dlp bulunamadı. Ayarlar/kurulumdan yt-dlp yükleyin veya internet varsa uygulama otomatik indirmeyi deneyecek.';
        } else {
            dl.status = `Hata: ${err.message}`;
        }
        emitDownloadProgress(dl, true);
    });

    // Buffer stderr to avoid memory explosion from verbose error output
    let stderrBuf = '';
    dl.process.stderr.on('data', (data) => {
        const chunk = data.toString();
        if (stderrBuf.length < 4096) stderrBuf += chunk;
        if (chunk.includes('ERROR:')) {
            console.warn(`[yt-dlp stderr]: ${chunk}`);
            dl.status = `Hata: ${chunk.substring(0, 100)}...`;
            emitDownloadProgress(dl, true);
        }
    });

    dl.process.on('close', (code) => {
        console.log(`yt-dlp process closed with code: ${code}`);
        dl.process = null;
        if (code === 0) {
            dl.status = 'completed';
            dl.progress = 100;
            if (dl.autoOpen) {
                let command;
                if (process.platform === 'win32') command = `start "" "${DOWNLOADS_DIR}"`;
                else if (process.platform === 'darwin') command = `open "${DOWNLOADS_DIR}"`;
                else command = `xdg-open "${DOWNLOADS_DIR}"`;
                exec(command, () => {});
            }
        } else if (dl.status === 'paused') {
            // Stay paused
        } else {
            if (!dl.status.toLowerCase().includes('hata')) dl.status = 'failed';
        }
        emitDownloadProgress(dl, true);
        delete progressEmitState[dl.id];

        // Kick queued downloads
        for (const qid in downloads) {
            if (downloads[qid].status === 'queued') {
                startDownloadTask(qid);
                break;
            }
        }

        // Auto-cleanup memory: keep only last 50 downloads
        const downloadIds = Object.keys(downloads);
        if (downloadIds.length > 50) {
            const toDelete = downloadIds.slice(0, downloadIds.length - 50);
            toDelete.forEach(tid => {
                if (downloads[tid].status === 'completed' || downloads[tid].status === 'failed') {
                    delete downloads[tid];
                    delete progressEmitState[tid];
                }
            });
        }
    });
}

app.post('/api/download', (req, res) => {
    const { url, title, quality, isPlaylist, autoOpen, startTime, endTime, isOnBattery, profile } = req.body;
    const id = Date.now().toString();
    const configuredMode = appConfig.powerMode || 'auto';
    let effectivePowerMode = configuredMode;
    if (configuredMode === 'auto') {
        effectivePowerMode = isOnBattery ? 'eco' : 'normal';
    }

    downloads[id] = {
        id,
        url,
        title: title || 'processed',
        quality: quality || 'best',
        isPlaylist: !!isPlaylist,
        autoOpen: !!autoOpen,
        startTime: startTime || null,
        endTime: endTime || null,
        profile: profile || 'custom',
        effectivePowerMode,
        rateLimitKbps: appConfig.rateLimitKbps || 0,
        retryEnabled: appConfig.smartRetry !== false,
        lowNoiseNotifications: appConfig.lowNoiseNotifications !== false,
        progress: 0,
        speed: '0 KiB/s',
        eta: 'loading',
        status: 'starting'
    };
    
    emitDownloadProgress(downloads[id], true);
    startDownloadTask(id);
    res.json({ id });
});

app.post('/api/action', (req, res) => {
    const { id, action } = req.body;
    const dl = downloads[id];
    if (!dl) return res.status(404).json({ error: 'Bulunamadı' });

    if (action === 'pause' && dl.process) {
        dl.status = 'paused';
        dl.process.kill('SIGINT');
        emitDownloadProgress(dl, true);
    } else if (action === 'resume' && (dl.status === 'paused' || dl.status === 'failed')) {
        startDownloadTask(id);
        emitDownloadProgress(dl, true);
    }
    res.json({ success: true });
});

app.post('/api/open-folder', (req, res) => {
    let command;
    if (process.platform === 'win32') command = `start "" "${DOWNLOADS_DIR}"`;
    else if (process.platform === 'darwin') command = `open "${DOWNLOADS_DIR}"`;
    else command = `xdg-open "${DOWNLOADS_DIR}"`;
    exec(command, () => {});
    res.json({ success: true });
});

app.post('/api/clear-completed', (req, res) => {
    let changed = false;
    Object.keys(downloads).forEach(id => {
        if (downloads[id].status === 'completed' || downloads[id].status === 'failed' || downloads[id].status.toLowerCase().includes('hata')) {
            // Cleanup progress state
            delete progressEmitState[id];
            delete downloads[id];
            changed = true;
        }
    });
    if (changed) {
        const safeDownloads = {};
        for (const id in downloads) {
            const { process: _p, ...rest } = downloads[id];
            safeDownloads[id] = rest;
        }
        io.emit('initial-state', safeDownloads);
    }
    res.json({ success: true });
});

app.get('/api/status/:id', (req, res) => {
    const dl = downloads[req.params.id];
    if (dl) {
        // Strip sensitive process data just in case
        const { process: _p, ...safeDl } = dl;
        res.json(safeDl);
    } else {
        res.status(404).json({ error: 'Bulunamadı' });
    }
});

app.post('/api/autostart', (req, res) => {
    if (process.platform === 'win32') {
        // Linux desktop autostart is not supported on Windows.
        return res.json({ success: true, enabled: false, supported: false });
    }
    const { enabled } = req.body;
    const autostartDir = path.join(os.homedir(), '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'uniget.desktop');
    const sourceFile = path.join(__dirname, 'YT-DLM.desktop');

    try {
        if (enabled) {
            if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
            const desktopContent = `[Desktop Entry]
Name=UniGet
Comment=Modern YouTube Downloader
Exec=/home/slawn/Projeler/yt-dlp-manager/start-uniget.sh --hidden
Icon=/home/slawn/Projeler/yt-dlp-manager/public/icon.png
Terminal=false
Type=Application
Categories=Network;WebBrowser;`;
            fs.writeFileSync(desktopFile, desktopContent);
            res.json({ success: true, enabled: true });
        } else {
            if (fs.existsSync(desktopFile)) {
                fs.unlinkSync(desktopFile);
            }
            res.json({ success: true, enabled: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/autostart/status', (req, res) => {
    if (process.platform === 'win32') {
        return res.json({ enabled: false, supported: false });
    }
    const desktopFile = path.join(os.homedir(), '.config', 'autostart', 'uniget.desktop');
    res.json({ enabled: fs.existsSync(desktopFile), supported: true });
});

// Debounce config writes to avoid rapid disk I/O
let _configWriteTimer = null;
function debouncedConfigWrite() {
    if (_configWriteTimer) clearTimeout(_configWriteTimer);
    _configWriteTimer = setTimeout(() => {
        try {
            const cp = getConfigPath();
            fs.writeFileSync(cp, JSON.stringify(appConfig, null, 2));
        } catch(e) {}
    }, 500);
}

app.post('/api/settings', (req, res) => {
    if (req.body.downloadDir) {
        appConfig.downloadDir = req.body.downloadDir;
        DOWNLOADS_DIR = appConfig.downloadDir;
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        } catch(e) {}
    }
    if (['auto', 'eco', 'normal', 'performance'].includes(req.body.powerMode)) {
        appConfig.powerMode = req.body.powerMode;
    }
    if (typeof req.body.rateLimitKbps !== 'undefined') {
        const limit = Math.max(0, Number.parseInt(req.body.rateLimitKbps, 10) || 0);
        appConfig.rateLimitKbps = limit;
    }
    if (typeof req.body.smartRetry !== 'undefined') {
        appConfig.smartRetry = !!req.body.smartRetry;
    }
    if (typeof req.body.lowNoiseNotifications !== 'undefined') {
        appConfig.lowNoiseNotifications = !!req.body.lowNoiseNotifications;
    }
    debouncedConfigWrite();
    res.json({ success: true, config: appConfig });
});

app.get('/api/settings', (req, res) => {
    res.json(appConfig);
});

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        // Another instance (or previous run) is already listening on this port.
        // Exit gracefully so Electron can still connect to the existing server.
        console.warn(`Port ${PORT} is already in use. Assuming server is already running.`);
        process.exit(0);
    }
    console.error('Server error:', err);
    process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    // Kill all active yt-dlp processes
    for (const id in downloads) {
        const dl = downloads[id];
        if (dl.process) {
            try { dl.process.kill('SIGTERM'); } catch {}
        }
    }
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    // Force exit after 5s if server doesn't close
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
