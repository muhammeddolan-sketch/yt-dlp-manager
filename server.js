const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const cors = require('cors');
const crypto = require('crypto');

const APP_VERSION = require('./package.json').version;

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;

function isLoopbackHostname(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

// DNS rebinding guard: a hostile site can point its own domain at 127.0.0.1
// and then talk to us "same-origin". Only accept loopback Host headers.
function isAllowedHostHeader(hostHeader) {
    if (typeof hostHeader !== 'string' || !hostHeader) return false;
    try {
        const parsed = new URL(`http://${hostHeader}`);
        const port = parsed.port ? Number(parsed.port) : 80;
        return isLoopbackHostname(parsed.hostname) && port === PORT;
    } catch {
        return false;
    }
}

function isAllowedOrigin(origin) {
    if (!origin) return false;
    try {
        const parsed = new URL(origin);
        const host = parsed.hostname;
        // Only our own UI origin; other local web servers are not trusted.
        if (parsed.protocol === 'http:' && isLoopbackHostname(host) && Number(parsed.port || 80) === PORT) return true;
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
        callback(null, isAllowedHostHeader(req.headers.host) && isAllowedOrigin(req.headers.origin));
    },
    transports: ['websocket', 'polling'],
    perMessageDeflate: false,
    pingInterval: 25000,
    pingTimeout: 20000
});

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

const DEFAULT_OUTPUT_TEMPLATE = '%(title).180B [%(id)s].%(ext)s';

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
    cookiesBrowser: 'chrome',
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
    maxConcurrent: 5,
    sleepAfterDownload: false,
    historyRetentionDays: 30,
    postDownloadCommand: '',
    globalHotkey: 'CommandOrControl+Shift+U'
};

try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) {
        const saved = JSON.parse(fs.readFileSync(cp, 'utf8'));
        if (saved && typeof saved === 'object') {
            appConfig = { ...appConfig, ...saved };
        }
    } else {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, JSON.stringify(appConfig, null, 2));
    }
} catch(e) {}

if (isSafeDownloadDir(process.env.UNIGET_DOWNLOAD_DIR)) {
    appConfig.downloadDir = process.env.UNIGET_DOWNLOAD_DIR;
}

let DOWNLOADS_DIR = appConfig.downloadDir;

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use((req, res, next) => {
    if (!isAllowedHostHeader(req.headers.host)) {
        return res.status(421).json({ error: 'Invalid Host header' });
    }
    next();
});
app.use(cors(corsOptions));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});
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
// Static assets: HTML/JS/CSS must revalidate so an app update never reuses stale UI code.
// Images/fonts keep the long cache.
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (/\.(?:html|js|css)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
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

// ─── Managed extension folder (sideload auto-update) ─────────────────
// Chrome/Edge cannot auto-update unpacked extensions, but we can keep the
// files in a stable folder fresh. After an app update the folder is
// rewritten and the extension updates on browser restart / Reload.
function getExtensionDir() {
    return path.join(path.dirname(getConfigPath()), 'extension');
}

function findExtensionSourceDir() {
    const candidates = [
        path.join(__dirname, 'web-extension'),
        path.join(__dirname, 'public', 'extension')
    ];
    for (const dir of candidates) {
        try {
            if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
        } catch {}
    }
    return null;
}

function readExtensionVersion(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version || null;
    } catch {
        return null;
    }
}

function copyExtensionFolder(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        let stat;
        try { stat = fs.statSync(from); } catch { continue; }
        if (!stat.isFile()) continue;
        fs.copyFileSync(from, path.join(dest, name));
    }
}

// A stale version is the usual reason to re-copy, but a deleted or
// truncated file would also break the sideloaded extension silently.
function extensionFolderNeedsSync(src, dest) {
    try {
        for (const name of fs.readdirSync(src)) {
            const from = path.join(src, name);
            let stat;
            try { stat = fs.statSync(from); } catch { continue; }
            if (!stat.isFile()) continue;
            const to = path.join(dest, name);
            if (!fs.existsSync(to)) return true;
            if (fs.statSync(to).size !== stat.size) return true;
        }
    } catch {
        return true;
    }
    return false;
}

let extensionSyncState = { installedVersion: null, latestVersion: null, dir: null, syncedAt: 0 };
function syncExtensionFolder(force = false) {
    const source = findExtensionSourceDir();
    const dir = getExtensionDir();
    if (!source) {
        extensionSyncState = { ...extensionSyncState, dir };
        return extensionSyncState;
    }
    const latestVersion = readExtensionVersion(source);
    const installedVersion = readExtensionVersion(dir);
    let copied = false;
    if (force || !installedVersion || installedVersion !== latestVersion || extensionFolderNeedsSync(source, dir)) {
        try {
            copyExtensionFolder(source, dir);
            copied = true;
        } catch (e) {
            extensionSyncState = { ...extensionSyncState, dir, latestVersion, error: String(e && e.message || e) };
            return extensionSyncState;
        }
    }
    extensionSyncState = {
        installedVersion: readExtensionVersion(dir),
        latestVersion,
        dir,
        syncedAt: copied ? Date.now() : (extensionSyncState.syncedAt || Date.now()),
        error: null
    };
    return extensionSyncState;
}

app.get('/api/extension/status', (req, res) => {
    const state = syncExtensionFolder(false);
    res.json({
        ...state,
        updateAvailable: !!(state.latestVersion && state.installedVersion !== state.latestVersion),
        managed: true
    });
});

app.post('/api/extension/sync', (req, res) => {
    res.json(syncExtensionFolder(true));
});

app.post('/api/extension/open-folder', (req, res) => {
    const dir = getExtensionDir();
    try {
        fs.mkdirSync(dir, { recursive: true });
        if (process.platform === 'win32') {
            execFile('explorer.exe', [dir]);
        } else if (process.platform === 'darwin') {
            execFile('open', [dir]);
        } else {
            execFile('xdg-open', [dir]);
        }
        res.json({ ok: true, dir });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e && e.message || e), dir });
    }
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

// yt-dlp's -o accepts absolute paths and "..", which would escape --paths home
// (e.g. dropping a file into the Startup folder). Keep templates relative.
function normalizeOutputTemplate(value) {
    if (typeof value !== 'string') return null;
    const tpl = value.trim().slice(0, 200);
    if (!tpl) return null;
    if (/[\0\r\n]/.test(tpl)) return null;
    if (path.isAbsolute(tpl) || path.win32.isAbsolute(tpl) || /^[a-zA-Z]:/.test(tpl) || /^[\\/~]/.test(tpl)) return null;
    if (tpl.split(/[\\/]+/).some(part => part === '..')) return null;
    // Output-type prefixes ("thumbnail:/abs/path") bypass the checks above.
    if (/^(?:subtitle|thumbnail|description|annotation|infojson|link|pl_thumbnail|pl_description|pl_infojson|chapter|pl_video)\s*:/i.test(tpl)) return null;
    return tpl;
}

function normalizeThumbnail(value) {
    const url = parseHttpUrl(value);
    return url && url.length <= 2048 ? url : null;
}

function normalizeSubtitleLangs(value) {
    if (typeof value !== 'string') return '';
    const langs = value.trim().slice(0, 120);
    return /^[\w,.*+\-]*$/.test(langs) ? langs : '';
}

// Quote a value so the platform shell treats it as one literal argument.
function shellQuote(value) {
    const str = String(value);
    if (process.platform === 'win32') {
        // Windows paths cannot contain '"'; also neutralize %VAR% expansion.
        return `"${str.replace(/"/g, '').replace(/%/g, '"^%"')}"`;
    }
    return `'${str.replace(/'/g, `'\\''`)}'`;
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

function isYouTubeUrl(value) {
    try {
        const host = new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
        return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
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
            if (st === 'completed' || st === 'failed' || st.startsWith('error:') || st === 'scheduled') {
                downloads[id] = { ...dl, process: null, _timer: null };
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
                const { process: _p, _spawning, _timer, ...rest } = downloads[id];
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

function cleanupPartialFiles() {
    try {
        const partialExts = new Set(['.part', '.ytdl', '.temp', '.tmp']);
        const stack = [{ dir: DOWNLOADS_DIR, depth: 0 }];
        while (stack.length) {
            const { dir, depth } = stack.pop();
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < 2) stack.push({ dir: full, depth: depth + 1 });
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if (!partialExts.has(ext)) continue;
                try { fs.unlinkSync(full); } catch {}
            }
        }
    } catch {}
}

function cleanupOldHistory() {
    try {
        const days = Number.parseInt(appConfig.historyRetentionDays, 10);
        if (!Number.isFinite(days) || days <= 0) return;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let changed = false;
        for (const id of Object.keys(downloads)) {
            const dl = downloads[id];
            const st = String(dl?.status || '');
            if (!['completed', 'failed'].includes(st) && !st.startsWith('error:')) continue;
            const ts = dl.completedAt ? Date.parse(dl.completedAt) : 0;
            if (ts && ts < cutoff) {
                delete downloads[id];
                delete progressEmitState[id];
                changed = true;
            }
        }
        if (changed) persistDownloadsState();
    } catch {}
}

let _lastDiskSync = 0;
let _lastDiskMtimeMs = 0;
function syncDownloadsFromDisk(force = false) {
    // /api/downloads is polled every 5s; walking the whole downloads folder on
    // every poll is wasted disk I/O. A cheap statSync of the folder mtime tells
    // us whether anything actually changed (new/renamed files). Otherwise we
    // only do a safety rescan every 10s. Completion/startup/dir-change paths
    // still pass force=true for an immediate refresh.
    const now = Date.now();
    let dirMtimeMs = 0;
    try { dirMtimeMs = fs.statSync(DOWNLOADS_DIR).mtimeMs; } catch (e) { /* folder missing */ }
    if (!force && now - _lastDiskSync < 10000 && dirMtimeMs <= _lastDiskMtimeMs) return false;
    _lastDiskSync = now;
    _lastDiskMtimeMs = dirMtimeMs;
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
syncDownloadsFromDisk(true);
syncExtensionFolder(false);
cleanupPartialFiles();
cleanupOldHistory();
schedulePendingDownloads();

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
function getMaxConcurrent() {
    const configured = Number.parseInt(appConfig.maxConcurrent, 10);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.min(10, configured);
    }
    return 5;
}

function getActiveDownloadCount() {
    let count = 0;
    for (const id in downloads) {
        const st = downloads[id].status;
        if (st === 'downloading' || st === 'starting') count++;
    }
    return count;
}

function isPathInside(parentDir, childPath) {
    let parent = path.resolve(parentDir);
    let child = path.resolve(childPath);
    try { if (fs.existsSync(parent)) parent = fs.realpathSync(parent); } catch {}
    try { if (fs.existsSync(child)) child = fs.realpathSync(child); } catch {}
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function openFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath) || !isPathInside(DOWNLOADS_DIR, filePath) || !isFinalMediaFile(filePath)) return false;
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
        const files = getDownloadFilesFromDisk();
        return files.length ? files[0].filePath : null;
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
        // Son fallback olarak 'w' (worst) eklenir — hiç format bulunamazsa en azından
        // bir şey indirilebilsin.
        return height
            ? `b${cap}[ext=mp4]/b${cap}/b[ext=mp4]/b/w`
            : 'b[ext=mp4]/b/w';
    }

    // FFmpeg varken önce MP4/H.264 uyumlu tek veya birleşebilir formatlar denenir.
    // X/Twitter bazı MP4 videolarında codec bilgisini "unknown" döndürdüğü için
    // fallback tarafında vcodec filtresi kasıtlı olarak kullanılmıyor.
    // Son fallback: bv*+ba (filtresiz), b (best combined), w (worst) — her durumda
    // bir format bulunabilmesi garantilenir.
    return height
        ? `bv*${cap}[ext=mp4]+ba[ext=m4a]/bv*${cap}+ba/b${cap}[ext=mp4]/b${cap}/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b/w`
        : 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b/w';
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
        const requestModule = /^https:/i.test(String(url)) ? https : http;

        const request = requestModule.get(url, { headers: { 'User-Agent': `UniGet Pro v${APP_VERSION}` } }, (res) => {
            // Follow redirects (bounded), keeping the caller's timeout budget
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                file.close(() => {
                    try { fs.unlinkSync(destPath); } catch {}
                    if (redirectsLeft <= 0) {
                        reject(new Error('Download failed: too many redirects'));
                        return;
                    }
                    let next;
                    try { next = new URL(res.headers.location, url); } catch {
                        reject(new Error('Download failed: invalid redirect'));
                        return;
                    }
                    // Executables are fetched over HTTPS; never follow a downgrade.
                    if (next.protocol !== 'https:') {
                        reject(new Error('Download failed: insecure redirect'));
                        return;
                    }
                    downloadFile(next.toString(), destPath, timeoutMs, redirectsLeft - 1).then(resolve, reject);
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

const YTDLP_EXE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const YTDLP_SUMS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(filePath)
            .on('error', reject)
            .on('data', chunk => hash.update(chunk))
            .on('end', () => resolve(hash.digest('hex')));
    });
}

// Download yt-dlp.exe and check it against the release's SHA2-256SUMS so a
// tampered or truncated binary is never executed.
async function downloadVerifiedYtDlp(destPath, timeoutMs) {
    const sumsPath = `${destPath}.sums`;
    try {
        await downloadFile(YTDLP_SUMS_URL, sumsPath, 60000);
        const sums = fs.readFileSync(sumsPath, 'utf8');
        const line = sums.split(/\r?\n/).find(l => /^[a-f0-9]{64}\s+\*?yt-dlp\.exe$/i.test(l.trim()));
        if (!line) throw new Error('yt-dlp.exe checksum not found in SHA2-256SUMS');
        const expected = line.trim().slice(0, 64).toLowerCase();
        await downloadFile(YTDLP_EXE_URL, destPath, timeoutMs);
        const actual = await sha256File(destPath);
        if (actual !== expected) {
            try { fs.rmSync(destPath, { force: true }); } catch {}
            throw new Error('yt-dlp.exe checksum mismatch');
        }
    } finally {
        try { fs.rmSync(sumsPath, { force: true }); } catch {}
    }
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
    try {
        console.log('Downloading yt-dlp.exe...');
        await downloadVerifiedYtDlp(bundled, 60000);
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

function getYtDlpVersion(cmd, timeoutMs = 10000) {
    return new Promise((resolve) => {
        let settled = false;
        let stdout = '';
        const done = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        let proc;
        try {
            proc = spawn(cmd, ['--version']);
        } catch {
            return done(null);
        }
        const timer = setTimeout(() => {
            try { proc.kill(); } catch {}
            done(null);
        }, timeoutMs);
        proc.stdout.on('data', (data) => {
            if (stdout.length < 500) stdout += data.toString();
        });
        proc.once('error', () => {
            clearTimeout(timer);
            done(null);
        });
        proc.once('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) return done(null);
            done(stdout.trim().split(/\r?\n/)[0] || null);
        });
    });
}

let _ytDlpVersionPromise = null;
function getCachedYtDlpVersion(cmd, refresh = false) {
    if (refresh || !_ytDlpVersionPromise) {
        _ytDlpVersionPromise = getYtDlpVersion(cmd).then((version) => {
            // Başarısız okumayı önbelleğe almayalım; araç sonradan kurulabilir.
            if (!version) _ytDlpVersionPromise = null;
            return version;
        });
    }
    return _ytDlpVersionPromise;
}

let _ytDlpUpdatePromise = null;
async function updateYtDlp() {
    if (process.platform !== 'win32') {
        throw new Error('yt-dlp otomatik güncellemesi yalnızca Windows üzerinde destekleniyor');
    }
    if (_ytDlpUpdatePromise) return _ytDlpUpdatePromise;
    if (getActiveDownloadCount() > 0) {
        throw new Error('Aktif indirme varken yt-dlp güncellenemez. Önce indirmeleri durdurun.');
    }

    _ytDlpUpdatePromise = (async () => {
        const bundled = getBundledYtDlpPath();
        const binDir = path.dirname(bundled);
        const tempPath = `${bundled}.new`;
        const previousVersion = await getYtDlpVersion(resolveYtDlpCmd());

        fs.mkdirSync(binDir, { recursive: true });
        try { fs.rmSync(tempPath, { force: true }); } catch {}

        console.log('Downloading latest yt-dlp.exe...');
        await downloadVerifiedYtDlp(tempPath, 5 * 60 * 1000);

        const stat = fs.existsSync(tempPath) ? fs.statSync(tempPath) : null;
        if (!stat || stat.size < 1000000) {
            try { fs.rmSync(tempPath, { force: true }); } catch {}
            throw new Error('İndirilen yt-dlp dosyası geçersiz veya bozuk');
        }

        const downloadedVersion = await getYtDlpVersion(tempPath);
        if (!downloadedVersion) {
            try { fs.rmSync(tempPath, { force: true }); } catch {}
            throw new Error('İndirilen yt-dlp çalıştırılamadı');
        }

        try {
            fs.renameSync(tempPath, bundled);
        } catch (renameError) {
            // Windows, çalışan bir exe'nin üzerine yazılmasına izin vermez.
            try {
                fs.copyFileSync(tempPath, bundled);
                fs.rmSync(tempPath, { force: true });
            } catch {
                try { fs.rmSync(tempPath, { force: true }); } catch {}
                throw new Error('yt-dlp güncellenemedi. Çalışan indirmeleri kapatıp tekrar deneyin.');
            }
        }

        _cachedYtDlpPath = bundled;
        _ytDlpVersionPromise = Promise.resolve(downloadedVersion);
        return {
            updated: previousVersion !== downloadedVersion,
            previousVersion,
            version: downloadedVersion
        };
    })().finally(() => {
        _ytDlpUpdatePromise = null;
    });

    return _ytDlpUpdatePromise;
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
    const { process: _p, _spawning, _timer, ...safeDl } = dl;
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

function schedulePendingDownloads() {
    for (const id in downloads) {
        const dl = downloads[id];
        if (dl?.status !== 'scheduled' || !dl.scheduledAt) continue;
        const delay = new Date(dl.scheduledAt).getTime() - Date.now();
        if (delay <= 0) {
            startDownloadTask(id);
        } else {
            scheduleDownloadTask(id, delay);
        }
    }
}

function scheduleDownloadTask(id, delayMs) {
    const dl = downloads[id];
    if (!dl) return;
    if (dl._timer) clearTimeout(dl._timer);
    dl._timer = setTimeout(() => {
        dl._timer = null;
        if (downloads[id]) startDownloadTask(id);
    }, Math.max(1000, delayMs));
}

async function startDownloadTask(id) {
    const dl = downloads[id];
    if (!dl) return;

    // Guard against double-start: if this download already has a live process
    // or is mid-spawn, bail out. Both the 3s queue self-retry and the on-close
    // "kick next queued" path can otherwise fire for the same id and spawn two
    // yt-dlp processes for one download.
    if (dl.process || dl._spawning) return;

    if (IS_TEST_RUNNER_DISABLED) {
        dl.status = 'queued';
        dl.progress = 0;
        emitDownloadProgress(dl, true);
        return;
    }

    // Enforce concurrent download limit
    if (getActiveDownloadCount() >= getMaxConcurrent()) {
        dl.status = 'queued';
        emitDownloadProgress(dl, true);
        // Re-check after a delay
        setTimeout(() => {
            if (downloads[id] && dl.status === 'queued') startDownloadTask(id);
        }, 3000);
        return;
    }

    // Reserve this task synchronously (before any await) so a concurrent
    // invocation sees the flag and returns early.
    dl._spawning = true;

    const ffmpegAvailable = await hasFfmpeg();
    let formatOption = getVideoFormatOption(dl.quality, ffmpegAvailable);

    // Format retry: önceki denemede "Requested format is not available" alındıysa
    // filtre/codec kısıtlaması olmayan basit bir format stringi kullan.
    if (dl._useSimpleFormat) {
        formatOption = ffmpegAvailable ? 'bv*+ba/b/w' : 'b[ext=mp4]/b/w';
        console.log(`[yt-dlp] Using simple fallback format for ${dl.id}: ${formatOption}`);
    }

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

    // YouTube's default player clients (e.g. visionOS) may expose only
    // separate video/audio streams. Without FFmpeg we cannot merge them, so
    // ask for clients that still return a combined progressive format.
    // On a format-error retry, use the same clients even with FFmpeg.
    if (isYouTubeUrl(dl.url) && (!ffmpegAvailable || dl._formatRetried)) {
        args.push('--extractor-args', 'youtube:player_client=android,mweb');
    }

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
    if (dl.subtitles) {
        args.push('--write-subs', '--sub-langs', dl.subtitleLangs || 'all,-live_chat');
        if (ffmpegAvailable) args.push('--embed-subs');
        if (dl.subtitleFormat && dl.subtitleFormat !== 'best') {
            args.push('--convert-subs', dl.subtitleFormat);
        }
    }
    // Re-validate: persisted state/config from older versions may hold unsafe templates.
    const outputTemplate = normalizeOutputTemplate(dl.outputTemplate)
        || normalizeOutputTemplate(appConfig.outputTemplate)
        || DEFAULT_OUTPUT_TEMPLATE;
    args.push('-o', outputTemplate, '--', dl.url);

    const ytDlpCmd = await ensureYtDlpAvailable();
    console.log(`Starting yt-dlp with args: ${ytDlpCmd} ${args.join(' ')}`);
    dl.process = spawn(ytDlpCmd, args);
    dl._spawning = false;
    dl.status = 'downloading';

    dl.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // Check the printed file path first: titles can contain '|' and
            // must not be mistaken for (and rendered as) progress fields.
            if (fs.existsSync(line) && isPathInside(DOWNLOADS_DIR, line)) {
                dl.filePath = line;
            } else if (line.includes('|')) {
                const parts = line.split('|');
                if (parts.length >= 3) {
                    dl.progress = parseFloat(parts[0].replace('%', '').trim()) || dl.progress;
                    dl.speed = parts[1].trim().slice(0, 32);
                    dl.eta = parts[2].trim().slice(0, 32);
                    emitDownloadProgress(dl);
                }
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

            // "Requested format is not available" — format filtresi hiçbir formata
            // denk gelmediyse, basit bir fallback ile tekrar dene.
            if (/requested format/i.test(cleanErr) && !dl._formatRetried) {
                dl._formatRetried = true;
                console.log(`[yt-dlp] Format retry: killing process and retrying with fallback format for ${dl.id}`);
                try { dl.process.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch {}
                // Kısa bir gecikmeyle basit formatta tekrar başlat
                setTimeout(async () => {
                    if (!downloads[dl.id]) return;
                    dl.process = null;
                    dl._spawning = false;
                    dl._useSimpleFormat = true;
                    dl.status = 'starting';
                    dl.errorDetail = null;
                    emitDownloadProgress(dl, true);
                    startDownloadTask(dl.id);
                }, 500);
                return;
            }

            dl.errorDetail = cleanErr.substring(0, 300);
            // "Requested format is not available" hatası için daha açıklayıcı mesaj
            if (/requested format/i.test(cleanErr)) {
                dl.errorDetail = ffmpegAvailable
                    ? 'Bu video için uygun bir format bulunamadı. yt-dlp\'yi güncellemeyi deneyin (Ayarlar > yt-dlp Güncelle).'
                    : 'Bu video yalnızca ayrı video/ses akışları sunuyor. FFmpeg kurun (Ayarlar > Araçları Onar) veya yt-dlp\'yi güncelleyin.';
            }
            dl.status = `error:${dl.errorDetail.substring(0, 100)}`;
            emitDownloadProgress(dl, true);
        }
    });

    dl.process.on('close', (code) => {
        console.log(`yt-dlp process closed with code: ${code}`);
        dl.process = null;
        // If the download was cancelled/removed while the process was running,
        // do not resurrect it as a failed download on clients.
        if (!downloads[id]) return;
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
        if (syncDownloadsFromDisk(true)) {
            io.emit('initial-state', getSafeDownloads());
        }

        if (appConfig.postDownloadCommand && dl.status === 'completed' && dl.filePath) {
            // File names come from remote video titles, so they must never be
            // spliced into the shell unquoted. Drop any quotes the user put
            // around the placeholder and quote the value ourselves.
            const cmd = appConfig.postDownloadCommand
                .replace(/(["']?)\{(file|dir)\}\1/g, (_m, _q, key) => shellQuote(key === 'file' ? dl.filePath : path.dirname(dl.filePath)));
            try { exec(cmd, { windowsHide: true }); } catch {}
        }

        if (appConfig.sleepAfterDownload && dl.status === 'completed' && getActiveDownloadCount() === 0) {
            setTimeout(() => {
                try {
                    if (process.platform === 'win32') {
                        spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                    } else if (process.platform === 'darwin') {
                        spawn('pmset', ['sleepnow'], { detached: true, stdio: 'ignore' }).unref();
                    } else {
                        spawn('systemctl', ['suspend'], { detached: true, stdio: 'ignore' }).unref();
                    }
                } catch {}
            }, 5000);
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
    const subtitles = !!(req.body.subtitles || req.body.hasSubtitles);

    let scheduledAt = null;
    if (req.body.scheduleAt) {
        const ts = Date.parse(req.body.scheduleAt);
        if (Number.isFinite(ts) && ts > Date.now()) scheduledAt = new Date(ts).toISOString();
    }
    if (typeof req.body.outputTemplate === 'string' && req.body.outputTemplate.trim() && !normalizeOutputTemplate(req.body.outputTemplate)) {
        return res.status(400).json({ error: 'Output template must be a relative path' });
    }
    const outputTemplate = normalizeOutputTemplate(req.body.outputTemplate)
        || normalizeOutputTemplate(appConfig.outputTemplate)
        || DEFAULT_OUTPUT_TEMPLATE;
    const subtitleLangs = normalizeSubtitleLangs(req.body.subtitleLangs || req.body.subtitleLang);
    const subtitleFormat = ['srt', 'vtt', 'ass', 'best'].includes(String(req.body.subtitleFormat || ''))
        ? String(req.body.subtitleFormat)
        : 'best';
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
        thumbnail: normalizeThumbnail(thumbnail),
        quality: normalizeQuality(req.body.quality),
        isPlaylist: !!isPlaylist,
        autoOpen: !!autoOpen,
        subtitles,
        subtitleLangs,
        subtitleFormat,
        startTime: normalizeTime(req.body.startTime),
        endTime: normalizeTime(req.body.endTime),
        profile: typeof profile === 'string' ? profile.slice(0, 80) : 'custom',
        effectivePowerMode,
        rateLimitKbps: appConfig.rateLimitKbps || 0,
        retryEnabled: appConfig.smartRetry !== false,
        lowNoiseNotifications: appConfig.lowNoiseNotifications !== false,
        outputTemplate,
        scheduledAt,
        progress: 0,
        speed: '0 KiB/s',
        eta: 'loading',
        status: scheduledAt ? 'scheduled' : 'starting'
    };
    
    emitDownloadProgress(downloads[id], true);
    if (scheduledAt) {
        scheduleDownloadTask(id, new Date(scheduledAt).getTime() - Date.now());
    } else {
        startDownloadTask(id);
    }
    res.json({ id, download: toSafeDownload(downloads[id]) });
});

app.post('/api/action', (req, res) => {
    const { id, action } = req.body;
    const dl = downloads[id];
    if (!dl) return res.status(404).json({ error: 'Bulunamadı' });
    if (!['pause', 'resume', 'cancel'].includes(action)) {
        return res.status(400).json({ error: 'Geçersiz işlem' });
    }

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
        if (dl._timer) { clearTimeout(dl._timer); dl._timer = null; }
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

app.post('/api/reveal-file', (req, res) => {
    const id = typeof req.body.id === 'string' ? req.body.id : '';
    const dl = downloads[id];
    if (!dl || !dl.filePath) return res.status(404).json({ error: 'Dosya bulunamadi' });
    if (!isPathInside(DOWNLOADS_DIR, dl.filePath) || !fs.existsSync(dl.filePath)) {
        return res.status(404).json({ error: 'Dosya acilamadi' });
    }
    try {
        if (process.platform === 'win32') {
            spawn('explorer.exe', ['/select,', dl.filePath], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('open', ['-R', dl.filePath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [path.dirname(dl.filePath)], { detached: true, stdio: 'ignore' }).unref();
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Reveal failed' });
    }
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
        io.emit('initial-state', getSafeDownloads());
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
            if (syncDownloadsFromDisk(true)) io.emit('initial-state', getSafeDownloads());
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
    if (typeof req.body.maxConcurrent !== 'undefined') {
        const mc = Math.max(1, Math.min(10, Number.parseInt(req.body.maxConcurrent, 10) || 5));
        appConfig.maxConcurrent = mc;
    }
    if (typeof req.body.outputTemplate !== 'undefined' && String(req.body.outputTemplate || '').trim()) {
        const tpl = normalizeOutputTemplate(req.body.outputTemplate);
        if (!tpl) return res.status(400).json({ error: 'Output template must be a relative path' });
        appConfig.outputTemplate = tpl;
    }
    if (typeof req.body.sleepAfterDownload !== 'undefined') {
        appConfig.sleepAfterDownload = !!req.body.sleepAfterDownload;
    }
    if (typeof req.body.historyRetentionDays !== 'undefined') {
        const d = Math.max(0, Math.min(365, Number.parseInt(req.body.historyRetentionDays, 10) || 0));
        appConfig.historyRetentionDays = d;
    }
    if (typeof req.body.postDownloadCommand !== 'undefined') {
        appConfig.postDownloadCommand = String(req.body.postDownloadCommand || '').trim().slice(0, 500);
    }
    if (typeof req.body.globalHotkey !== 'undefined') {
        const hk = String(req.body.globalHotkey || '').trim().slice(0, 80);
        if (hk) appConfig.globalHotkey = hk;
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

app.post('/api/tools/update-ytdlp', async (req, res) => {
    try {
        const result = await updateYtDlp();
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message || 'yt-dlp güncellemesi başarısız' });
    }
});

app.get('/api/tools', async (req, res) => {
    try {
        const ytDlpCmd = resolveYtDlpCmd();
        const [ffmpegAvailable, ytDlpVersion] = await Promise.all([
            hasFfmpeg(),
            getCachedYtDlpVersion(ytDlpCmd)
        ]);
        res.json({
            appVersion: APP_VERSION,
            ytDlp: {
                command: ytDlpCmd,
                bundled: ytDlpCmd === getBundledYtDlpPath(),
                version: ytDlpVersion,
                updatable: process.platform === 'win32'
            },
            ffmpeg: {
                available: ffmpegAvailable,
                mode: ffmpegAvailable ? 'full-quality' : 'progressive-fallback'
            }
        });
    } catch (e) {
        res.json({
            appVersion: APP_VERSION,
            ytDlp: {
                command: resolveYtDlpCmd(),
                bundled: false,
                version: null,
                updatable: process.platform === 'win32'
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

// ─── JSON error handler (never leak stack traces/paths) ───────────
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode) || 500;
    if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
        return res.status(400).json({ error: 'Geçersiz JSON gövdesi' });
    }
    if (err?.type === 'entity.too.large' || status === 413) {
        return res.status(413).json({ error: 'İstek gövdesi çok büyük' });
    }
    if (status >= 500) {
        console.error(`[server] ${req.method} ${req.path}:`, err?.message || err);
    }
    res.status(status).json({ error: status >= 500 ? 'Sunucu hatası' : 'İstek işlenemedi' });
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
