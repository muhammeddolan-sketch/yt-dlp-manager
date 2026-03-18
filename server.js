const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let downloads = {};

io.on('connection', (socket) => {
    console.log('Client connected');
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
                    uploader: info.uploader,
                    formats: info.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none').map(f => ({
                        format_id: f.format_id,
                        ext: f.ext,
                        resolution: f.resolution,
                        filesize: f.filesize
                    }))
                });
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse info' });
            }
        } else {
            res.status(500).json({ error: 'yt-dlp failed' });
        }
    });
});

app.post('/api/download', (req, res) => {
    const { url, title } = req.body;
    const id = Date.now().toString();

    downloads[id] = {
        id,
        title: title || 'Fetching...',
        progress: 0,
        speed: '0 KiB/s',
        eta: 'Calculating...',
        status: 'starting'
    };

    const args = [
        '--newline',
        '--no-playlist',
        '--progress',
        '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--restrict-filenames',
        '--ffmpeg-location', '/usr/bin/ffmpeg', // Explicit path if possible
        '-o', path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'),
        url
    ];

    const child = spawn('yt-dlp', args);

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.includes('|')) {
                const parts = trimmed.split('|');
                if (parts.length >= 3) {
                    downloads[id].progress = parseFloat(parts[0].replace('%', '').trim());
                    downloads[id].speed = parts[1].trim();
                    downloads[id].eta = parts[2].trim();
                    downloads[id].status = 'downloading';
                    io.emit('progress', downloads[id]);
                }
            }
        });
    });

    child.stderr.on('data', (data) => {
        const errStr = data.toString();
        console.error('Download error:', errStr);
        if (errStr.includes('Error') || errStr.includes('ERROR')) {
            downloads[id].status = `Error: ${errStr.substring(0, 50)}...`;
            io.emit('progress', downloads[id]);
        }
    });

    child.on('close', (code) => {
        if (code === 0) {
            downloads[id].status = 'completed';
            downloads[id].progress = 100;
        } else {
            downloads[id].status = 'failed';
        }
        io.emit('progress', downloads[id]);
    });

    res.json({ id });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
