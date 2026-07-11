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
const crypto = require('crypto');

const APP_VERSION = require('./package.json').version;

const app = express();
const server = http.createServer(app);
function isAllowedOrigin(origin) {
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        const host = parsed.hostname;
        const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLoopback) return true;
        if (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:') return true;
    } catch {}
    return false;
}

const corsOptions = {
    allowedHeaders: ['Content-Type', 'X-UniGet-Client'],
    methods: ['GET', 'POST', 'OPTIONS'],
    origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
    }
};

const io = new Server(server, {
    cors: corsOptions,
    allowRequest(req, callback) {
        callback(null, isAllowedOrigin(req.headers.origin));
    },
    transports: ['websocket', 'polling'],
    perMessageDeflate: false,
    pingInterval: 25000,
    pingTimeout: 20000
});

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const IS_TEST_RUNNER_DISABLED = process.env.UNIGET_TEST_DISABLE_RUNNER === '1';
const homeDir = os.homedir();

// ─── Cached tool checks ───────────────────────────────────────────
let _cachedYtDlpPath = null;
let _cachedFfmpegAvailable = null;
let _ffmpegInstallPromise = null;

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
    lowNoiseNotifications: true,
    useBrowserCookies: false,
    cookiesBrowser: 'chrome'
};

try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) appConfig = JSON.parse(fs.readFileSync(cp, 'utf8'));
    else {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, JSON.stringify(appConfig, null, 2));
    }
} catch(e) {}

if (isSafeDownloadDir(process.env.UNIGET_DOWNLOAD_DIR)) {
    appConfig.downloadDir = process.env.UNIGET_DOWNLOAD_DIR;
}

let DOWNLOADS_DIR = appConfig.downloadDir;

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());
app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS' || req.method === 'GET') return next();
    const client = String(req.get('X-UniGet-Client') || '');
    if (!['desktop', 'extension', 'userscript'].includes(client)) {
        return res.status(403).json({ error: 'UniGet client header is required' });
    }
    next();
});
// Static assets with long cache (css, js, images don't change between restarts)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

app.get('/extension/chrome-package', (req, res) => {
    let packageName = null;
    try {
        packageName = fs.readdirSync(__dirname)
            .filter(name => /^UniGet-Extension-v[\d.]+\.zip$/.test(name))
            .sort()
            .pop() || null;
    } catch {}
    if (!packageName) {
        return res.status(404).json({ error: 'Chrome extension package not found' });
    }
    res.download(path.join(__dirname, packageName), packageName);
});

let downloads = {};
const progressEmitState = {};

function parseHttpUrl(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 4096) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

function normalizeQuality(value) {
    const quality = String(value || 'best');
    return ['best', '2160', '1440', '1080', '720', '480', 'audio'].includes(quality) ? quality : 'best';
}

function getConfiguredCookiesBrowser() {
    return ['chrome', 'firefox', 'edge', 'brave', 'vivaldi', 'opera'].includes(appConfig.cookiesBrowser)
        ? appConfig.cookiesBrowser
        : 'chrome';
}

function appendBrowserCookieArgs(args) {
    if (appConfig.useBrowserCookies) {
        args.push('--cookies-from-browser', getConfiguredCookiesBrowser());
    }
    return args;
}

function classifyMediaInfo(info) {
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
    const stack = [];
    if (info) stack.push(info);
    if (Array.isArray(info?.entries)) {
        for (const entry of info.entries) {
            if (entry) stack.push(entry);
        }
    }

    let hasVideo = false;
    let hasAudio = false;
    let hasImage = false;

    for (const item of stack) {
        const ext = String(item.ext || '').toLowerCase();
        if (imageExts.has(ext)) hasImage = true;
        if ((item.duration || item.duration_string || item._type === 'video') && !imageExts.has(ext)) hasVideo = true;
        if (Array.isArray(item.formats)) {
            for (const f of item.formats) {
                const vcodec = String(f.vcodec || '').toLowerCase();
                const acodec = String(f.acodec || '').toLowerCase();
                const formatNote = String(f.format_note || '').toLowerCase();
                const resolution = String(f.resolution || '').toLowerCase();
                if (vcodec && vcodec !== 'none' && !imageExts.has(String(f.ext || '').toLowerCase())) hasVideo = true;
                if (resolution && !resolution.includes('audio only') && !imageExts.has(String(f.ext || '').toLowerCase())) hasVideo = true;
                if (formatNote.includes('storyboard') || formatNote.includes('thumbnail')) hasImage = true;
                if (acodec && acodec !== 'none') hasAudio = true;
            }
        }
    }

    if (hasVideo) return { mediaType: 'video', downloadable: true };
    if (hasAudio) return { mediaType: 'audio', downloadable: true };
    if (hasImage) return { mediaType: 'image', downloadable: false };
    return { mediaType: 'unknown', downloadable: false };
}

function getUsefulYtDlpError(stderr, fallback = 'yt-dlp failed') {
    const lines = String(stderr || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const useful = lines.filter(line => !/^WARNING:/i.test(line));
    return (useful.join('\n') || lines.find(line => /^ERROR:/i.test(line)) || fallback).substring(0, 300);
}

function parseYtDlpJson(output) {
    const text = String(output || '').trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function buildInfoResponse(url, info) {
    const media = classifyMediaInfo(info);
    return {
        url,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration_string,
        uploader: info.uploader,
        mediaType: media.mediaType,
        downloadable: media.downloadable
    };
}

function normalizeTime(value) {
    if (!value) return null;
    const time = String(value).trim();
    if (!/^\d{1,2}(:[0-5]\d){1,2}$/.test(time)) return null;
    return time;
}

function hasInvalidTime(value) {
    return !!value && normalizeTime(value) === null;
}

function normalizeTitle(value) {
    if (typeof value !== 'string') return 'processed';
    return value.trim().slice(0, 300) || 'processed';
}

function isSafeDownloadDir(value) {
    if (typeof value !== 'string') return false;
    const dir = value.trim();
    return dir.length > 0 && dir.length <= 1024 && path.isAbsolute(dir);
}

function isDirectMediaUrl(value) {
    try {
        const parsed = new URL(value);
        return /\.(mp4|m4v|webm|mov|mkv|mp3|m4a|aac|wav|flac|ogg)(?:$|[?#])/i.test(parsed.pathname);
    } catch {
        return false;
    }
}

// ─── Persist completed/failed downloads across restarts ──────────
function getDownloadsStatePath() {
    return path.join(getAppDataDir(), 'downloads-state.json');
}

function loadPersistedDownloads() {
    try {
        const p = getDownloadsStatePath();
        if (!fs.existsSync(p)) return;
        const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const id in saved) {
            const dl = saved[id];
            // Only restore terminal states — don't re-run active downloads
            const st = String(dl.status || '');
            if (st === 'completed' || st === 'failed' || st.startsWith('error:')) {
                downloads[id] = { ...dl, process: null };
            }
        }
    } catch(e) {}
}

let _stateWriteTimer = null;
function persistDownloadsState() {
    if (_stateWriteTimer) clearTimeout(_stateWriteTimer);
    _stateWriteTimer = setTimeout(() => {
        try {
            const toSave = {};
            for (const id in downloads) {
                const { process: _p, ...rest } = downloads[id];
                toSave[id] = rest;
            }
            const p = getDownloadsStatePath();
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(toSave, null, 2));
        } catch(e) {}
    }, 600);
}

function getFileDownloadId(filePath) {
    return `file-${crypto.createHash('sha1').update(path.resolve(filePath).toLowerCase()).digest('hex').slice(0, 20)}`;
}

function getTitleFromFilePath(filePath) {
    const base = path.basename(filePath, path.extname(filePath));
    return normalizeTitle(base.replace(/\s+/g, ' '));
}

function getDownloadFilesFromDisk() {
    const results = [];
    const maxFiles = 300;
    const maxDepth = 2;
    try {
        if (!DOWNLOADS_DIR || !fs.existsSync(DOWNLOADS_DIR)) return results;
        const stack = [{ dir: DOWNLOADS_DIR, depth: 0 }];
        while (stack.length && results.length < maxFiles) {
            const { dir, depth } = stack.pop();
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch(e) {
                continue;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
                    continue;
                }
                if (!entry.isFile() || !isFinalMediaFile(full)) continue;
                let stat;
                try {
                    stat = fs.statSync(full);
                } catch(e) {
                    continue;
                }
                if (!stat.size) continue;
                results.push({ filePath: full, size: stat.size, mtimeMs: stat.mtimeMs });
                if (results.length >= maxFiles) break;
            }
        }
    } catch(e) {}
    return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function syncDownloadsFromDisk() {
    let changed = false;
    const diskFiles = getDownloadFilesFromDisk();
    const knownPaths = new Map();

    for (const id in downloads) {
        const filePath = downloads[id]?.filePath;
        if (filePath) knownPaths.set(path.resolve(filePath).toLowerCase(), id);
    }

    for (const file of diskFiles) {
        const resolved = path.resolve(file.filePath).toLowerCase();
        const existingId = knownPaths.get(resolved);
        if (existingId) {
            const existing = downloads[existingId];
            if (existing && existing.status === 'completed') {
                if (existing.fileSize !== file.size || !existing.completedAt) {
                    existing.fileSize = file.size;
                    existing.completedAt = existing.completedAt || new Date(file.mtimeMs).toISOString();
                    changed = true;
                }
            }
            continue;
        }

        const id = getFileDownloadId(file.filePath);
        if (!downloads[id]) {
            downloads[id] = {
                id,
                url: '',
                title: getTitleFromFilePath(file.filePath),
                thumbnail: null,
                quality: 'file',
                isPlaylist: false,
                autoOpen: false,
                startTime: null,
                endTime: null,
                profile: 'disk-scan',
                effectivePowerMode: 'normal',
                rateLimitKbps: 0,
                retryEnabled: false,
                lowNoiseNotifications: true,
                progress: 100,
                speed: '0 KiB/s',
                eta: 'done',
                status: 'completed',
                filePath: file.filePath,
                fileSize: file.size,
                completedAt: new Date(file.mtimeMs).toISOString(),
                source: 'disk-scan'
            };
            knownPaths.set(resolved, id);
            changed = true;
        }
    }

    for (const id of Object.keys(downloads)) {
        const dl = downloads[id];
        if (dl?.source !== 'disk-scan') continue;
        if (!dl.filePath || !fs.existsSync(dl.filePath) || !isFinalMediaFile(dl.filePath) || !isPathInside(DOWNLOADS_DIR, dl.filePath)) {
            delete downloads[id];
            delete progressEmitState[id];
            changed = true;
        }
    }

    if (changed) persistDownloadsState();
    return changed;
}

loadPersistedDownloads();
syncDownloadsFromDisk();

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

// ─── Safe folder opener (no shell injection) ─────────────────────
function openFolder(folderPath) {
    try {
        if (process.platform === 'win32') {
            spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch(e) {}
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

function isPathInside(parentDir, childPath) {
    const parent = path.resolve(parentDir);
    const child = path.resolve(childPath);
    const relative = path.relative(parent, child);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function openFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath) || !isPathInside(DOWNLOADS_DIR, filePath)) return false;
        if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '', filePath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        } else if (process.platform === 'darwin') {
            spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
        }
        return true;
    } catch(e) {
        return false;
    }
}

function findNewestCompletedFile() {
    try {
        const ignored = new Set(['.part', '.ytdl', '.temp', '.tmp']);
        return fs.readdirSync(DOWNLOADS_DIR)
            .map(name => path.join(DOWNLOADS_DIR, name))
            .filter(filePath => {
                if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
                const ext = path.extname(filePath).toLowerCase();
                return !ignored.has(ext) && isFinalMediaFile(filePath);
            })
            .map(filePath => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
    } catch(e) {
        return null;
    }
}

function getAppDataDir() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'uniget');
    }
    return path.join(os.homedir(), '.config', 'uniget');
}

function getTempDownloadsDir() {
    return path.join(getAppDataDir(), 'tmp', 'downloads');
}

function isFinalMediaFile(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    return ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'].includes(ext);
}

function getHeightLimit(quality) {
    if (['2160', '1440', '1080', '720', '480'].includes(String(quality))) return String(quality);
    return null;
}

function getVideoFormatOption(quality, ffmpegAvailable) {
    const height = getHeightLimit(quality);
    const cap = height ? `[height<=${height}]` : '';

    if (!ffmpegAvailable) {
        // FFmpeg yokken sadece birleşik tek dosya formatları seçilir.
        // Böylece video+ses parçaları kullanıcının klasörüne ayrı ayrı düşmez.
        return height
            ? `b${cap}[ext=mp4]/b${cap}/b[ext=mp4]/b`
            : 'b[ext=mp4]/b';
    }

    // FFmpeg varken önce MP4/H.264 uyumlu tek veya birleşebilir formatlar denenir.
    // X/Twitter bazı MP4 videolarında codec bilgisini "unknown" döndürdüğü için
    // fallback tarafında vcodec filtresi kasıtlı olarak kullanılmıyor.
    return height
        ? `bv*${cap}[ext=mp4]+ba[ext=m4a]/bv*${cap}+ba/b${cap}[ext=mp4]/b${cap}/b[ext=mp4]/b`
        : 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b';
}

function getBundledYtDlpPath() {
    // Preferred location we control (works in dev + packaged).
    const binDir = path.join(getAppDataDir(), 'bin');
    const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    return path.join(binDir, exe);
}

function getBundledFfmpegPath() {
    return path.join(getAppDataDir(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function resolveYtDlpCmd() {
    const bundled = getBundledYtDlpPath();
    if (fs.existsSync(bundled)) return bundled;

    // Fallback to PATH.
    if (process.platform === 'win32') return 'yt-dlp.exe';
    return 'yt-dlp';
}

function resolveFfmpegCmd() {
    const bundled = getBundledFfmpegPath();
    if (fs.existsSync(bundled)) return bundled;
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getFfmpegLocationArg() {
    const bundled = getBundledFfmpegPath();
    if (fs.existsSync(bundled)) return path.dirname(bundled);
    return null;
}

function downloadFile(url, destPath, timeoutMs = 60000, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const file = fs.createWriteStream(destPath);

        const request = https.get(url, { headers: { 'User-Agent': `UniGet Pro v${APP_VERSION}` } }, (res) => {
            // Follow redirects (bounded), keeping the caller's timeout budget
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close(() => {
                    try { fs.unlinkSync(destPath); } catch {}
                    if (redirectsLeft <= 0) {
                        reject(new Error('Download failed: too many redirects'));
                        return;
                    }
                    downloadFile(res.headers.location, destPath, timeoutMs, redirectsLeft - 1).then(resolve, reject);
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
            file.on('finish', () => {
                file.close(() => resolve());
            });
        });

        request.on('error', (err) => {
            file.close(() => {
                try { fs.unlinkSync(destPath); } catch {}
                reject(err);
            });
        });
        
        request.setTimeout(timeoutMs, () => {
            request.destroy();
            file.close(() => {
                try { fs.unlinkSync(destPath); } catch {}
                reject(new Error('Download timeout'));
            });
        });
    });
}

async function ensureYtDlpAvailable() {
    // Return cached path if already resolved
    if (_cachedYtDlpPath) {
        // Double check it's not a corrupted/tiny file
        if (fs.existsSync(_cachedYtDlpPath) && fs.statSync(_cachedYtDlpPath).size > 1000000) {
            return _cachedYtDlpPath;
        }
    }

    const cmd = resolveYtDlpCmd();
    const bundled = getBundledYtDlpPath();

    // Check if bundled exists and is valid size (>1MB)
    if (fs.existsSync(bundled)) {
        if (fs.statSync(bundled).size > 1000000) {
            _cachedYtDlpPath = bundled;
            return bundled;
        } else {
            console.warn('Bundled yt-dlp seems corrupted (too small), redownloading...');
            try { fs.unlinkSync(bundled); } catch {}
        }
    }

    if (cmd && cmd !== 'yt-dlp' && cmd !== 'yt-dlp.exe' && path.isAbsolute(cmd) && fs.existsSync(cmd)) {
        if (fs.statSync(cmd).size > 1000000) {
           _cachedYtDlpPath = cmd;
           return cmd; 
        }
    }

    // Only auto-download on Windows where this is the common failure.
    if (process.platform !== 'win32') {
        _cachedYtDlpPath = cmd;
        return cmd;
    }

    // Download yt-dlp.exe (stable) from official GitHub release.
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    try {
        console.log('Downloading yt-dlp.exe...');
        await downloadFile(url, bundled);
        // Verify size after download
        if (fs.existsSync(bundled) && fs.statSync(bundled).size > 1000000) {
            _cachedYtDlpPath = bundled;
            return bundled;
        } else {
            throw new Error('Downloaded file is too small, likely corrupted.');
        }
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

function runPowerShell(args) {
    return new Promise((resolve, reject) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
            windowsHide: true
        });
        let stderr = '';
        p.stderr.on('data', data => {
            if (stderr.length < 2048) stderr += data.toString();
        });
        p.once('error', reject);
        p.once('close', code => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `PowerShell exited with ${code}`));
        });
    });
}

async function installPortableFfmpeg() {
    if (process.platform !== 'win32') return false;
    const bundled = getBundledFfmpegPath();
    if (fs.existsSync(bundled)) return true;
    if (_ffmpegInstallPromise) return _ffmpegInstallPromise;

    _ffmpegInstallPromise = (async () => {
        const binDir = path.dirname(bundled);
        const tmpDir = path.join(getAppDataDir(), 'tmp');
        const zipPath = path.join(tmpDir, 'ffmpeg-release-essentials.zip');
        const extractDir = path.join(tmpDir, 'ffmpeg-extract');
        const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

        fs.mkdirSync(binDir, { recursive: true });
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.mkdirSync(tmpDir, { recursive: true });
        console.log('Downloading portable FFmpeg...');
        await downloadFile(url, zipPath, 10 * 60 * 1000);
        await runPowerShell(['-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zipPath, extractDir]);

        const stack = [extractDir];
        let found = null;
        while (stack.length && !found) {
            const current = stack.pop();
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) stack.push(full);
                else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
                    found = full;
                    break;
                }
            }
        }
        if (!found) throw new Error('ffmpeg.exe not found in downloaded package');
        fs.copyFileSync(found, bundled);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return fs.existsSync(bundled);
    })().finally(() => {
        _ffmpegInstallPromise = null;
    });

    return _ffmpegInstallPromise;
}

async function hasFfmpeg() {
    // Return cached result after first check
    if (_cachedFfmpegAvailable !== null) return _cachedFfmpegAvailable;

    let result;
    if (process.platform === 'win32') {
        const bundled = getBundledFfmpegPath();
        if (fs.existsSync(bundled)) {
            result = await checkToolAvailable(bundled);
        } else {
            result = await checkToolAvailable('ffmpeg.exe');
        }
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
        payload.thumbnail = dl.thumbnail || null;
        payload.quality = dl.quality;
        payload.isPlaylist = dl.isPlaylist;
        payload.filePath = dl.filePath || null;
        payload.errorDetail = dl.errorDetail || null;
    }

    progressEmitState[dl.id] = { ts: now, lastData: payload };
    // Use volatile emit for non-critical progress updates (drops if client can't keep up)
    if (force) {
        io.emit('progress', payload);
        // Persist state on significant changes (completion, failure, etc.)
        persistDownloadsState();
    } else {
        io.volatile.emit('progress', payload);
    }
}

function toSafeDownload(dl) {
    if (!dl) return null;
    const { process: _p, ...safeDl } = dl;
    return safeDl;
}

function getSafeDownloads() {
    const safeDownloads = {};
    for (const id in downloads) {
        safeDownloads[id] = toSafeDownload(downloads[id]);
    }
    return safeDownloads;
}

io.on('connection', (socket) => {
    socket.emit('initial-state', getSafeDownloads());
});

app.get('/api/downloads', (req, res) => {
    syncDownloadsFromDisk();
    res.json(getSafeDownloads());
});

app.post('/api/info', async (req, res) => {
    const url = parseHttpUrl(req.body.url);
    if (!url) return res.status(400).json({ error: 'Valid HTTP(S) URL is required' });

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
        const args = appendBrowserCookieArgs(['--js-runtimes', 'node', '-j', '--no-playlist', url]);
        const proc = spawn(ytDlpCmd, args);
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
            const info = parseYtDlpJson(output);
            if (info) {
                resolve(buildInfoResponse(url, info));
            } else if (code === 0) {
                reject(new Error('Failed to parse info'));
            } else {
                reject(new Error(getUsefulYtDlpError(stderr)));
            }
            // Clear from cache after a short delay (e.g. 5s) to allow new requests if needed
            setTimeout(() => infoCache.delete(url), 5000);
        });
    });

    addToInfoCache(url, infoPromise);
    // On failure, remove from cache immediately so retries work
    infoPromise.catch(() => infoCache.delete(url));

    try {
        const info = await infoPromise;
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/validate-media', async (req, res) => {
    const url = parseHttpUrl(req.body.url);
    if (!url) return res.status(400).json({ error: 'Valid HTTP(S) URL is required' });

    try {
        const ytDlpCmd = await ensureYtDlpAvailable();
        const args = appendBrowserCookieArgs(['--js-runtimes', 'node', '-J', '--no-playlist', url]);
        const proc = spawn(ytDlpCmd, args);
        let output = '';
        let stderr = '';

        proc.stdout.on('data', data => {
            if (output.length < 2 * 1024 * 1024) output += data.toString();
        });
        proc.stderr.on('data', data => {
            if (stderr.length < 4096) stderr += data.toString();
        });

        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            try { proc.kill('SIGTERM'); } catch {}
        }, 20000);

        proc.on('close', code => {
            clearTimeout(timeout);
            const info = parseYtDlpJson(output);
            if (info) {
                const media = classifyMediaInfo(info);
                if (media.downloadable || code === 0) {
                    return res.json({
                        ...media,
                        title: info.title || null,
                        thumbnail: info.thumbnail || null
                    });
                }
            }
            if (timedOut) {
                return res.status(422).json({
                    downloadable: false,
                    mediaType: 'unknown',
                    error: 'Media verification timed out'
                });
            }
            if (code !== 0) {
                return res.status(422).json({
                    downloadable: false,
                    mediaType: 'unknown',
                    error: getUsefulYtDlpError(stderr, 'Media could not be verified')
                });
            }
            res.status(422).json({ downloadable: false, mediaType: 'unknown', error: 'Media info could not be parsed' });
        });
    } catch (e) {
        res.status(500).json({ downloadable: false, mediaType: 'unknown', error: e.message || 'Media validation failed' });
    }
});

async function startDownloadTask(id) {
    const dl = downloads[id];
    if (!dl) return;

    if (IS_TEST_RUNNER_DISABLED) {
        dl.status = 'queued';
        dl.progress = 0;
        emitDownloadProgress(dl, true);
        return;
    }

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
    const formatOption = getVideoFormatOption(dl.quality, ffmpegAvailable);

    if (!ffmpegAvailable && dl.quality !== 'best' && dl.quality !== 'audio' && Number.parseInt(dl.quality, 10) > 720) {
        dl.status = 'ffmpeg yok: tek dosya MP4/progressive mod kullaniliyor';
        emitDownloadProgress(dl, true);
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
    const tempDownloadsDir = getTempDownloadsDir();
    try { fs.mkdirSync(tempDownloadsDir, { recursive: true }); } catch {}

    let args = [
        '--newline',
        dl.isPlaylist ? '--yes-playlist' : '--no-playlist',
        '--continue',
        '--no-abort-on-error',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--js-runtimes', 'node',
        '--progress',
        '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--print', 'after_move:filepath',
        '--match-filters', "ext!='jpg' & ext!='jpeg' & ext!='png' & ext!='webp' & ext!='avif'",
        '--retries', String(retryLimit),
        '-N', String(turboThreads),
        '--paths', `home:${DOWNLOADS_DIR}`,
        '--paths', `temp:${tempDownloadsDir}`,
        '--no-keep-video',
        '--no-keep-fragments'
    ];

    if (ffmpegAvailable) {
        const ffmpegLocation = getFfmpegLocationArg();
        if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation);
        // Force AAC audio codec in output — prevents Opus/WebM audio ending up in mp4
        args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart -c:a aac -b:a 192k');
        args.push('--embed-metadata');
    }

    if (rateLimitKbps > 0) {
        args.push('--limit-rate', `${rateLimitKbps}K`);
    }

    appendBrowserCookieArgs(args);

    // Trimming support
    if (dl.startTime || dl.endTime) {
        const start = dl.startTime || '00:00:00';
        const end = dl.endTime || '99:59:59';
        args.push('--download-sections', `*${start}-${end}`);
        args.push('--force-keyframes-at-cuts');
    }

    const directMediaUrl = isDirectMediaUrl(dl.url);
    if (dl.quality === 'audio') {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else if (directMediaUrl) {
        dl.status = 'direct media download';
        emitDownloadProgress(dl, true);
    } else {
        args.push('--format', formatOption);
        if (ffmpegAvailable) {
            args.push('--merge-output-format', 'mp4');
        } else {
            dl.status = 'ffmpeg yok: tek dosya (progressive) format kullaniliyor';
            emitDownloadProgress(dl, true);
        }
    }
    args.push('-o', '%(title).180B [%(id)s].%(ext)s', dl.url);

    const ytDlpCmd = await ensureYtDlpAvailable();
    console.log(`Starting yt-dlp with args: ${ytDlpCmd} ${args.join(' ')}`);
    dl.process = spawn(ytDlpCmd, args);
    dl.status = 'downloading';

    dl.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            if (line.includes('|')) {
                const parts = line.split('|');
                if (parts.length >= 3) {
                    dl.progress = parseFloat(parts[0].replace('%', '').trim()) || dl.progress;
                    dl.speed = parts[1].trim();
                    dl.eta = parts[2].trim();
                    emitDownloadProgress(dl);
                }
            } else if (fs.existsSync(line) && isPathInside(DOWNLOADS_DIR, line)) {
                dl.filePath = line;
            }
        }
    });

    dl.process.on('error', (err) => {
        console.error('Download spawn error:', err);
        if (err && err.code === 'ENOENT') {
            dl.status = 'error:yt-dlp-not-found';
            dl.errorDetail = 'yt-dlp bulunamadi veya baslatilamadi.';
        } else {
            dl.errorDetail = err.message || 'unknown';
            dl.status = `error:${dl.errorDetail.substring(0, 80)}`;
        }
        emitDownloadProgress(dl, true);
    });

    // Buffer stderr to avoid memory explosion from verbose error output
    let stderrBuf = '';
    dl.process.stderr.on('data', (data) => {
        const chunk = data.toString();
        if (stderrBuf.length < 4096) stderrBuf += chunk;
        if (chunk.includes('ERROR:')) {
            const cleanErr = chunk.replace('ERROR:', '').trim();
            console.warn(`[yt-dlp error]: ${cleanErr}`);
            dl.errorDetail = cleanErr.substring(0, 300);
            dl.status = `error:${cleanErr.substring(0, 100)}`;
            emitDownloadProgress(dl, true);
        }
    });

    dl.process.on('close', (code) => {
        console.log(`yt-dlp process closed with code: ${code}`);
        dl.process = null;
        if (code === 0) {
            if (!dl.filePath) dl.filePath = findNewestCompletedFile();
            if (!dl.filePath || !fs.existsSync(dl.filePath) || !isPathInside(DOWNLOADS_DIR, dl.filePath) || !isFinalMediaFile(dl.filePath)) {
                dl.status = 'failed';
                dl.errorDetail = 'Indirme tamamlandi ancak final video/ses dosyasi bulunamadi.';
            } else {
                dl.status = 'completed';
                dl.progress = 100;
            }
            if (dl.status === 'completed' && dl.autoOpen) {
                openFolder(DOWNLOADS_DIR);
            }
        } else if (dl.status === 'paused') {
            // Stay paused
        } else {
            if (!String(dl.status || '').startsWith('error:')) dl.status = 'failed';
            if (!dl.errorDetail && stderrBuf) dl.errorDetail = stderrBuf.trim().substring(0, 300);
        }
        emitDownloadProgress(dl, true);
        if (syncDownloadsFromDisk()) {
            io.emit('initial-state', getSafeDownloads());
        }
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
                const st = String(downloads[tid]?.status || '');
                if (st === 'completed' || st === 'failed' || st.startsWith('error:')) {
                    delete downloads[tid];
                    delete progressEmitState[tid];
                }
            });
        }
    });
}

app.post('/api/download', (req, res) => {
    const { isPlaylist, autoOpen, isOnBattery, profile, thumbnail } = req.body;
    const url = parseHttpUrl(req.body.url);
    if (!url) return res.status(400).json({ error: 'Valid HTTP(S) URL is required' });
    if (hasInvalidTime(req.body.startTime) || hasInvalidTime(req.body.endTime)) {
        return res.status(400).json({ error: 'Time values must be HH:MM or HH:MM:SS' });
    }
    const id = crypto.randomUUID();
    const configuredMode = appConfig.powerMode || 'auto';
    let effectivePowerMode = configuredMode;
    if (configuredMode === 'auto') {
        effectivePowerMode = isOnBattery ? 'eco' : 'normal';
    }

    downloads[id] = {
        id,
        url,
        title: normalizeTitle(req.body.title),
        thumbnail: thumbnail || null,
        quality: normalizeQuality(req.body.quality),
        isPlaylist: !!isPlaylist,
        autoOpen: !!autoOpen,
        startTime: normalizeTime(req.body.startTime),
        endTime: normalizeTime(req.body.endTime),
        profile: typeof profile === 'string' ? profile.slice(0, 80) : 'custom',
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
    res.json({ id, download: toSafeDownload(downloads[id]) });
});

app.post('/api/action', (req, res) => {
    const { id, action } = req.body;
    const dl = downloads[id];
    if (!dl) return res.status(404).json({ error: 'Bulunamadı' });

    if (action === 'pause' && dl.process) {
        dl.status = 'paused';
        if (process.platform === 'win32') {
            try { dl.process.kill(); } catch(e) {}
        } else {
            try { dl.process.kill('SIGINT'); } catch(e) {}
        }
        emitDownloadProgress(dl, true);
    } else if (action === 'resume' && (dl.status === 'paused' || dl.status === 'failed')) {
        startDownloadTask(id);
        emitDownloadProgress(dl, true);
    } else if (action === 'cancel') {
        // Kill the process if running
        if (dl.process) {
            try { dl.process.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch(e) {}
            dl.process = null;
        }
        // Remove from downloads map and notify clients
        delete downloads[id];
        delete progressEmitState[id];
        io.emit('download-cancelled', { id });
        persistDownloadsState();

        // Kick queued downloads
        for (const qid in downloads) {
            if (downloads[qid].status === 'queued') {
                startDownloadTask(qid);
                break;
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/open-folder', (req, res) => {
    openFolder(DOWNLOADS_DIR);
    res.json({ success: true });
});

app.post('/api/open-file', (req, res) => {
    const id = typeof req.body.id === 'string' ? req.body.id : '';
    const dl = downloads[id];
    if (!dl || !dl.filePath) return res.status(404).json({ error: 'Dosya bulunamadi' });
    const success = openFile(dl.filePath);
    if (!success) return res.status(404).json({ error: 'Dosya acilamadi' });
    res.json({ success: true });
});

app.post('/api/clear-completed', (req, res) => {
    let changed = false;
    Object.keys(downloads).forEach(id => {
        const status = String(downloads[id].status || '');
        if (status === 'completed' || status === 'failed' || status.startsWith('error:')) {
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
        persistDownloadsState();
    }
    res.json({ success: true });
});

app.get('/api/status/:id', (req, res) => {
    const dl = downloads[req.params.id];
    if (dl) {
        res.json(toSafeDownload(dl));
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

    try {
        if (enabled) {
            if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
            const appExec = process.execPath || process.argv[0];
        const appDir = path.dirname(appExec);
        const desktopContent = `[Desktop Entry]
Name=UniGet
Comment=Modern YouTube Downloader
Exec=${appExec} --hidden
Icon=${path.join(appDir, 'resources', 'app', 'public', 'icon.png')}
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
        if (!isSafeDownloadDir(req.body.downloadDir)) {
            return res.status(400).json({ error: 'Download directory must be an absolute path' });
        }
        appConfig.downloadDir = req.body.downloadDir.trim();
        DOWNLOADS_DIR = appConfig.downloadDir;
        try {
            if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
            if (syncDownloadsFromDisk()) io.emit('initial-state', getSafeDownloads());
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
    if (typeof req.body.useBrowserCookies !== 'undefined') {
        appConfig.useBrowserCookies = !!req.body.useBrowserCookies;
    }
    if (typeof req.body.cookiesBrowser !== 'undefined') {
        const browser = String(req.body.cookiesBrowser || '').toLowerCase();
        if (['chrome', 'firefox', 'edge', 'brave', 'vivaldi', 'opera'].includes(browser)) {
            appConfig.cookiesBrowser = browser;
        }
    }
    debouncedConfigWrite();
    res.json({ success: true, config: appConfig });
});

app.get('/api/settings', (req, res) => {
    res.json(appConfig);
});

app.get('/api/tools', async (req, res) => {
    try {
        const ytDlpCmd = resolveYtDlpCmd();
        const ffmpegAvailable = await hasFfmpeg();
        res.json({
            ytDlp: {
                command: ytDlpCmd,
                bundled: ytDlpCmd === getBundledYtDlpPath()
            },
            ffmpeg: {
                available: ffmpegAvailable,
                mode: ffmpegAvailable ? 'full-quality' : 'progressive-fallback'
            }
        });
    } catch (e) {
        res.json({
            ytDlp: {
                command: resolveYtDlpCmd(),
                bundled: false
            },
            ffmpeg: {
                available: false,
                mode: 'progressive-fallback'
            }
        });
    }
});

app.post('/api/tools/install-ffmpeg', async (req, res) => {
    if (process.platform !== 'win32') {
        return res.status(400).json({ error: 'Portable FFmpeg install is only supported on Windows' });
    }
    try {
        const installed = await installPortableFfmpeg();
        _cachedFfmpegAvailable = null;
        const available = installed && await hasFfmpeg();
        if (!available) return res.status(500).json({ error: 'FFmpeg install failed' });
        res.json({ success: true, ffmpeg: { available: true, path: getBundledFfmpegPath() } });
    } catch (e) {
        _cachedFfmpegAvailable = null;
        res.status(500).json({ error: e.message || 'FFmpeg install failed' });
    }
});

function compareVersions(a, b) {
    const pa = String(a).split('.').map(n => Number.parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

app.get('/api/update-check', (req, res) => {
    const currentVersion = APP_VERSION;
    const options = {
        hostname: 'api.github.com',
        path: '/repos/muhammeddolan-sketch/yt-dlp-manager/releases/latest',
        headers: {
            'User-Agent': 'UniGet Pro',
            'Accept': 'application/vnd.github+json'
        },
        timeout: 8000
    };

    const request = https.get(options, response => {
        let body = '';
        response.on('data', chunk => {
            if (body.length < 256 * 1024) body += chunk.toString();
        });
        response.on('end', () => {
            if (response.statusCode !== 200) {
                return res.status(502).json({ error: `GitHub returned HTTP ${response.statusCode}` });
            }
            try {
                const release = JSON.parse(body);
                const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
                res.json({
                    currentVersion,
                    latestVersion,
                    hasUpdate: !!latestVersion && compareVersions(latestVersion, currentVersion) > 0,
                    url: release.html_url || 'https://github.com/muhammeddolan-sketch/yt-dlp-manager/releases'
                });
            } catch (e) {
                res.status(502).json({ error: 'Update response could not be parsed' });
            }
        });
    });
    request.on('timeout', () => request.destroy(new Error('Update check timeout')));
    request.on('error', error => {
        res.status(502).json({ error: error.message || 'Update check failed' });
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: APP_VERSION, app: 'UniGet' });
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

server.listen(PORT, '127.0.0.1', () => {
    const addr = server.address();
    const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
    console.log(`Server running on loopback at http://127.0.0.1:${addr.port}`);
}).on('error', (err) => {
    console.error(`Server binding to 127.0.0.1 failed (${err.code}).`);
    process.exit(1);
});
