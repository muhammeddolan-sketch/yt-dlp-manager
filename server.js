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
const DOWNLOADS_DIR = '/home/slawn/Videolar/IDM';

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
    let formatOption = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (dl.quality === '2160') formatOption = 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]/best';
    else if (dl.quality === '1440') formatOption = 'bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440][ext=mp4]/best';
    else if (dl.quality === '1080') formatOption = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
    else if (dl.quality === '720') formatOption = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
    else if (dl.quality === '480') formatOption = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best';

    let args = [
        '--newline',
        dl.isPlaylist ? '--yes-playlist' : '--no-playlist',
        '--progress',
        '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--restrict-filenames',
        '-N', '16' // YT-DLP'nin IDM gibi çoklu bağlantıyla (Multi-thread) süper hızlı indirmesini sağlayan ayar
    ];

    if (dl.quality === 'audio') {
        args.push('-x', '--audio-format', 'mp3');
    } else {
        args.push('--format', formatOption);
        if (dl.hasSubtitles) {
            args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'all,-live_chat', '--embed-subs');
        }
    }
    args.push('-o', path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'), dl.url);

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

    dl.process.stderr.on('data', (data) => {
        const errStr = data.toString();
        if (errStr.includes('ERROR:')) {
            dl.status = `Hata: ${errStr.substring(0, 45)}...`;
            io.emit('progress', dl);
        }
    });

    dl.process.on('close', (code) => {
        dl.process = null;
        if (code === 0) {
            dl.status = 'completed';
            dl.progress = 100;
        } else if (dl.status === 'paused') {
            // Stay paused
        } else {
            if (!dl.status.toLowerCase().includes('hata')) dl.status = 'failed';
        }
        io.emit('progress', dl);
    });
}

app.post('/api/download', (req, res) => {
    const { url, title, quality, isPlaylist, hasSubtitles } = req.body;
    const id = Date.now().toString();

    downloads[id] = {
        id,
        url,
        title: title || 'Hazırlanıyor...',
        quality: quality || 'best',
        isPlaylist: !!isPlaylist,
        hasSubtitles: !!hasSubtitles,
        progress: 0,
        speed: '0 KiB/s',
        eta: 'Hesaplanıyor...',
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

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
