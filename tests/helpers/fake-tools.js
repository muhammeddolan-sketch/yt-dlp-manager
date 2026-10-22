// Fake yt-dlp / ffmpeg used by the end-to-end tests (POSIX only).
// The fake logs its argv to $FAKE_LOG and its pid to $FAKE_PIDS. URL paths
// pick a behaviour: /bad (extraction error), /fmt (format error until the
// fallback format), /slow (endless progress), /pipe ('|' in the file name).
const fs = require('fs');
const path = require('path');

const FAKE_YTDLP = String.raw`
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\n');
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const url = args[args.indexOf('--') + 1] || args[args.length - 1];
if (args.includes('--version')) { console.log('2099.01.01'); process.exit(0); }
if (args.includes('-J')) {
    if (url.includes('/bad')) { console.error('ERROR: Unsupported URL'); process.exit(1); }
    process.stdout.write(JSON.stringify({ title: 'Türkçe başlık ğüşıöç 🎬', thumbnail: 'https://example.com/t.jpg', duration_string: '1:00', formats: [{ vcodec: 'avc1', acodec: 'mp4a', ext: 'mp4' }] }));
    process.exit(0);
}
const home = (args.filter((a, i) => args[i - 1] === '--paths').find(p => p.startsWith('home:')) || '').slice(5);
const prog = (val('--progress-template') || '').replace(/^download:/, '');
const printT = (val('--print') || '').replace(/^after_move:/, '');
const line = (pct) => prog.replace('%(progress._percent_str)s', ' ' + pct + '%').replace('%(progress._speed_str)s', '1.0MiB/s').replace('%(progress._eta_str)s', '00:01');
process.on('SIGINT', () => { console.error('ERROR: Interrupted by user'); process.exit(1); });
process.on('SIGTERM', () => process.exit(143));
fs.appendFileSync(process.env.FAKE_PIDS, process.pid + '\n');
if (url.includes('/fmt') && !['bv*+ba/b/w', 'b[ext=mp4]/b/w'].includes(val('--format'))) {
    console.error('ERROR: [youtube] x: Requested format is not available');
    setInterval(() => {}, 1000);
} else if (url.includes('/slow')) {
    let p = 0;
    setInterval(() => console.log(line(Math.min(99, ++p))), 100);
} else {
    // Split a progress line across writes to exercise line buffering.
    const first = line(10);
    process.stdout.write(first.slice(0, 7));
    setTimeout(() => {
        process.stdout.write(first.slice(7) + '\n' + line(100) + '\n');
        const name = url.includes('/pipe') ? 'a | b | c [id].mp4' : 'ok-' + Date.now() + ' [id].mp4';
        const file = path.join(home, name);
        fs.writeFileSync(file, 'x'.repeat(100));
        console.log(printT.replace('%(filepath)s', file));
        process.exit(0);
    }, 50);
}
`;

function makeFakeTools(dir, ffmpegWorks) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fake-yt-dlp.js'), FAKE_YTDLP);
    fs.writeFileSync(path.join(dir, 'yt-dlp'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake-yt-dlp.js')}" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'ffmpeg'), `#!/bin/sh\nexit ${ffmpegWorks ? 0 : 1}\n`, { mode: 0o755 });
}

module.exports = { makeFakeTools };
