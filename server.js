const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;
const getConfigPath = () => path.join(process.env.HOME, '.config', 'yt-dlm', 'config.json');
let appConfig = { downloadDir: path.join(process.env.HOME, 'Videolar', 'IDM') };

try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) appConfig = JSON.parse(fs.readFileSync(cp, 'utf8'));
    else {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, JSON.stringify(appConfig));
    }
} catch(e) {}

let DOWNLOADS_DIR = appConfig.downloadDir;

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let downloads = {};

io.on('connection', (socket) => {
    socket.emit('initial-state', downloads);
});

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const process = spawn('yt-dlp', ['-j', '--no-playlist', url]);
    let output = '';

    process.stdout.on('data', (data) => output += data);
    process.on('close', (code) => {
        if (code === 0) {
            try {
                const info = JSON.parse(output);
                res.json({
                    title: info.title,
                    thumbnail: info.thumbnail,
                    duration: info.duration_string,
                    uploader: info.uploader
                });
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse info' });
            }
        } else {
            res.status(500).json({ error: 'yt-dlp failed' });
        }
    });
});

function startDownloadTask(id) {
    const dl = downloads[id];
    let formatOption = 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best[ext=mp4]/best';
    
    // The instruction provided a conflicting re-declaration of formatOption and function.
    // Assuming the intent was to change the default formatOption and then apply quality-specific overrides.
    // The original default was 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best[ext=mp4]/best'.
    // The instruction's proposed default is 'bestvideo[height<=2160]+bestaudio/best[height<=2160]'.
    // I will use the instruction's proposed default for formatOption.
    formatOption = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]';

    if (dl.quality === '2160') formatOption = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]';
    else if (dl.quality === '1440') formatOption = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]';
    else if (dl.quality === '1080') formatOption = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
    else if (dl.quality === '720') formatOption = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
    else if (dl.quality === '480') formatOption = 'bestvideo[height<=480]+bestaudio/best[height<=480]';

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
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
        '--embed-metadata',
        '--embed-thumbnail',
        '-N', '12' // Turbo mode: 12 threads
    ];

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
        args.push('--merge-output-format', 'mp4');
    }
    args.push('-P', DOWNLOADS_DIR, '-o', '%(title)s.%(ext)s', dl.url);

    console.log(`Starting yt-dlp with args: yt-dlp ${args.join(' ')}`);
    dl.process = spawn('yt-dlp', args);
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
                    io.emit('progress', dl);
                }
            }
        }
    });

    dl.process.on('error', (err) => {
        console.error('Download spawn error:', err);
        dl.status = `Hata: ${err.message}`;
        io.emit('progress', dl);
    });

    dl.process.stderr.on('data', (data) => {
        const errStr = data.toString();
        console.warn(`[yt-dlp stderr]: ${errStr}`);
        if (errStr.includes('ERROR:')) {
            dl.status = `Hata: ${errStr.substring(0, 100)}...`;
            io.emit('progress', dl);
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
        io.emit('progress', dl);
    });
}

app.post('/api/download', (req, res) => {
    const { url, title, quality, isPlaylist, autoOpen, startTime, endTime } = req.body;
    const id = Date.now().toString();

    downloads[id] = {
        id,
        url,
        title: title || 'processed',
        quality: quality || 'best',
        isPlaylist: !!isPlaylist,
        autoOpen: !!autoOpen,
        startTime: startTime || null,
        endTime: endTime || null,
        progress: 0,
        speed: '0 KiB/s',
        eta: 'loading',
        status: 'starting'
    };
    
    io.emit('progress', downloads[id]);
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
        io.emit('progress', dl);
    } else if (action === 'resume' && (dl.status === 'paused' || dl.status === 'failed')) {
        startDownloadTask(id);
        io.emit('progress', dl);
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
            delete downloads[id];
            changed = true;
        }
    });
    if (changed) io.emit('initial-state', downloads);
    res.json({ success: true });
});

app.get('/api/status/:id', (req, res) => {
    const dl = downloads[req.params.id];
    if (dl) {
        // Strip sensitive process data just in case
        const safeDl = { ...dl, process: null };
        res.json(safeDl);
    } else {
        res.status(404).json({ error: 'Bulunamadı' });
    }
});

app.post('/api/autostart', (req, res) => {
    const { enabled } = req.body;
    const autostartDir = path.join(process.env.HOME, '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'yt-dlm.desktop');
    const sourceFile = path.join(__dirname, 'YT-DLM.desktop');

    try {
        if (enabled) {
            if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
            const desktopContent = `[Desktop Entry]
Name=YT-DLM
Comment=Modern YouTube Downloader
Exec=/home/slawn/Projeler/yt-dlp-manager/start-yt-dlm.sh --hidden
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
    const desktopFile = path.join(process.env.HOME, '.config', 'autostart', 'yt-dlm.desktop');
    res.json({ enabled: fs.existsSync(desktopFile) });
});

app.post('/api/settings', (req, res) => {
    if (req.body.downloadDir) {
        appConfig.downloadDir = req.body.downloadDir;
        DOWNLOADS_DIR = appConfig.downloadDir;
        try {
            const cp = getConfigPath();
            fs.writeFileSync(cp, JSON.stringify(appConfig));
            if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        } catch(e) {}
    }
    res.json({ success: true, config: appConfig });
});

app.get('/api/settings', (req, res) => {
    res.json(appConfig);
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
