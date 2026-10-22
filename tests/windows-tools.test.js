// Windows-only checks against the real tools (network required): verified
// yt-dlp.exe download, FFmpeg install (checksum + tar extraction + ffprobe),
// the PowerShell extraction fallback, MP3 extraction and trimming, and that
// cancel/pause/shutdown stop the whole yt-dlp/ffmpeg process tree.
// Results are printed as GitHub Actions annotations.
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'win32') {
    console.log('windows-tools: skipped (Windows only)');
    process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
const VIDEO_URL = 'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4';
const token = 'c'.repeat(64);
const port = String(38000 + Math.floor(Math.random() * 900));
const base = `http://127.0.0.1:${port}`;
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-win-'));
const downloadsDir = path.join(appData, 'downloads');
fs.mkdirSync(downloadsDir);
const headers = { 'Content-Type': 'application/json', 'X-UniGet-Client': 'desktop', 'X-UniGet-Token': token };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, what, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const value = await fn();
            if (value) return value;
        } catch {}
        await sleep(500);
    }
    throw new Error(`timed out waiting for ${what}`);
}
const post = async (p, body = {}, ms = 600000) => {
    const res = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return { status: res.status, data: await res.json().catch(() => null) };
};
const getStatus = async (id) => (await fetch(`${base}/api/status/${id}`, { headers })).json();
const until = (id, pred, what, ms = 300000) => waitFor(async () => {
    const s = await getStatus(id);
    if (String(s.status).startsWith('error:') || s.status === 'failed') throw Object.assign(new Error(`${what}: ${s.errorDetail || s.status}`), { fatal: true });
    return pred(s) ? s : null;
}, what, ms).catch((e) => { throw e; });

function running(image) {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH']).toString();
    return out.toLowerCase().split('\n').filter((l) => l.includes(`"${image.toLowerCase()}"`)).length;
}
const toolProcesses = () => running('yt-dlp.exe') + running('ffmpeg.exe');

let server;
let serverLog = '';
function startServer() {
    server = spawn(process.execPath, ['server.js'], {
        cwd: rootDir,
        env: { ...process.env, PORT: port, APPDATA: appData, UNIGET_DOWNLOAD_DIR: downloadsDir, UNIGET_API_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });
    return waitFor(async () => (await fetch(`${base}/api/health`)).ok, 'server start', 20000);
}

let failed = false;
async function step(name, fn) {
    const started = Date.now();
    try {
        const detail = await fn();
        console.log(`::notice title=PASS ${name}::${detail || 'ok'} (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (e) {
        failed = true;
        console.log(`::error title=FAIL ${name}::${String(e && e.message || e).replace(/\r?\n/g, ' ').slice(0, 900)}`);
        throw e;
    }
}

// Start a long trimmed download (ffmpeg downloads and re-encodes the section)
// and wait until both yt-dlp and ffmpeg are running.
async function startLongDownload(title) {
    const { data } = await post('/api/download', { url: VIDEO_URL, title, startTime: '00:00:00', endTime: '00:09:00' });
    await until(data.id, (s) => s.status === 'downloading', `${title} downloading`, 60000);
    await waitFor(() => running('ffmpeg.exe') > 0 && running('yt-dlp.exe') > 0, `${title}: yt-dlp and ffmpeg running`, 120000);
    return data.id;
}

(async () => {
    await startServer();

    await step('yt-dlp.exe download with SHA2-256SUMS check', async () => {
        const res = await post('/api/tools/update-ytdlp');
        assert.strictEqual(res.status, 200, JSON.stringify(res.data));
        assert.ok(res.data.version, 'no version');
        return `yt-dlp ${res.data.version}`;
    });

    await step('FFmpeg install (checksum, tar extraction, ffprobe)', async () => {
        const res = await post('/api/tools/install-ffmpeg');
        assert.strictEqual(res.status, 200, JSON.stringify(res.data));
        const binDir = path.join(appData, 'uniget', 'bin');
        assert.ok(fs.existsSync(path.join(binDir, 'ffmpeg.exe')), 'ffmpeg.exe missing');
        assert.ok(fs.existsSync(path.join(binDir, 'ffprobe.exe')), 'ffprobe.exe missing');
        assert.ok(!fs.existsSync(path.join(appData, 'uniget', 'tmp', 'ffmpeg-install')), 'work dir not cleaned up');
        const tools = await (await fetch(`${base}/api/tools`, { headers })).json();
        assert.strictEqual(tools.ffmpeg.available, true);
        assert.strictEqual(tools.ytDlp.bundled, true);
        return 'ffmpeg.exe + ffprobe.exe installed';
    });

    await step('PowerShell Expand-Archive fallback command', async () => {
        // Run the exact command server.js uses when tar.exe is unavailable.
        const src = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
        const command = (src.match(/'(Expand-Archive -LiteralPath \$env:UNIGET_ZIP[^']*)'/) || [])[1];
        assert.ok(command, 'command not found in server.js');
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-ps-'));
        fs.mkdirSync(path.join(work, 'src dir'));
        fs.writeFileSync(path.join(work, 'src dir', 'hello.txt'), 'hello');
        const zip = path.join(work, 'test archive.zip');
        execFileSync('tar.exe', ['-a', '-c', '-f', zip, '-C', path.join(work, 'src dir'), 'hello.txt']);
        const dest = path.join(work, 'out dir');
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
            env: { ...process.env, UNIGET_ZIP: zip, UNIGET_DEST: dest }
        });
        assert.strictEqual(fs.readFileSync(path.join(dest, 'hello.txt'), 'utf8'), 'hello');
        return 'paths with spaces extracted';
    });

    await step('MP3 extraction with bundled FFmpeg', async () => {
        const { data } = await post('/api/download', { url: VIDEO_URL, title: 'audio', quality: 'audio' });
        const done = await until(data.id, (s) => s.status === 'completed', 'audio download');
        assert.ok(done.filePath.toLowerCase().endsWith('.mp3'), done.filePath);
        assert.ok(fs.statSync(done.filePath).size > 100000);
        return path.basename(done.filePath);
    });

    await step('Trimmed MP4 download', async () => {
        const { data } = await post('/api/download', { url: VIDEO_URL, title: 'clip', startTime: '00:00:10', endTime: '00:00:15' });
        const done = await until(data.id, (s) => s.status === 'completed', 'trim download');
        assert.ok(done.filePath.toLowerCase().endsWith('.mp4'), done.filePath);
        return `${path.basename(done.filePath)} ${done.fileSize} bytes`;
    });

    await step('Cancel stops yt-dlp and ffmpeg (taskkill /T)', async () => {
        const id = await startLongDownload('cancel-me');
        const before = toolProcesses();
        await post('/api/action', { id, action: 'cancel' });
        await waitFor(() => toolProcesses() === 0, 'tool processes gone after cancel', 15000);
        return `${before} processes stopped`;
    });

    await step('Pause stops the tree, resume restarts', async () => {
        const id = await startLongDownload('pause-me');
        await post('/api/action', { id, action: 'pause' });
        await waitFor(async () => (await getStatus(id)).status === 'paused', 'paused', 15000);
        await waitFor(() => toolProcesses() === 0, 'tool processes gone after pause', 15000);
        await sleep(1500);
        assert.strictEqual((await getStatus(id)).status, 'paused', 'pause turned into another state');
        await post('/api/action', { id, action: 'resume' });
        await until(id, (s) => s.status === 'downloading', 'resumed', 60000);
        await post('/api/action', { id, action: 'cancel' });
        await waitFor(() => toolProcesses() === 0, 'tool processes gone', 15000);
        return 'paused, resumed, cancelled';
    });

    await step('IPC shutdown stops the tree and saves state', async () => {
        await startLongDownload('shutdown-me');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.send({ type: 'shutdown' });
        await Promise.race([exited, sleep(15000).then(() => { throw new Error('server did not exit'); })]);
        await waitFor(() => toolProcesses() === 0, 'tool processes gone after shutdown', 15000);
        const state = JSON.parse(fs.readFileSync(path.join(appData, 'uniget', 'downloads-state.json'), 'utf8'));
        assert.ok(Object.values(state).some((d) => d.title === 'shutdown-me'));
        server = null;
        await startServer();
        const restored = Object.values(await (await fetch(`${base}/api/downloads`, { headers })).json()).find((d) => d.title === 'shutdown-me');
        assert.strictEqual(restored && restored.status, 'paused');
        return 'stopped, saved, restored as paused';
    });
})().catch((error) => {
    failed = true;
    console.error(error);
    console.error(serverLog.slice(-4000));
}).finally(async () => {
    if (server) {
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await Promise.race([exited, sleep(5000)]);
    }
    try { execFileSync('taskkill', ['/F', '/IM', 'yt-dlp.exe', '/T'], { stdio: 'ignore' }); } catch {}
    try { execFileSync('taskkill', ['/F', '/IM', 'ffmpeg.exe', '/T'], { stdio: 'ignore' }); } catch {}
    try { fs.rmSync(appData, { recursive: true, force: true }); } catch {}
    process.exit(failed ? 1 : 0);
});
