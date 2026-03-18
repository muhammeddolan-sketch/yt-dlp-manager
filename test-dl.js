const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

const url = 'https://www.youtube.com/watch?v=BaW_jenozKc'; // Just a small test video (YouTube short or something stable)
const args = [
    '--newline',
    '--progress',
    '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-o', path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'),
    url
];

console.log('Running:', 'yt-dlp', args.join(' '));

const child = spawn('yt-dlp', args);

child.stdout.on('data', (data) => {
    console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
});

child.on('close', (code) => {
    console.log('EXIT CODE:', code);
    process.exit(code);
});
