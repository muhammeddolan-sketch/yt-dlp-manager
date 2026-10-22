// Drives the real download runner (no UNIGET_TEST_DISABLE_RUNNER) against a
// fake yt-dlp on PATH: progress parsing, file detection, format retry,
// queueing, pause/resume/cancel, shutdown and restore. POSIX only, because
// the fake tools are shell-launched Node scripts.
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform === 'win32') {
    console.log('runner-e2e: skipped on Windows');
    process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
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

function makeTools(dir, ffmpegWorks) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fake-yt-dlp.js'), FAKE_YTDLP);
    fs.writeFileSync(path.join(dir, 'yt-dlp'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake-yt-dlp.js')}" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'ffmpeg'), `#!/bin/sh\nexit ${ffmpegWorks ? 0 : 1}\n`, { mode: 0o755 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, what, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await fn();
        if (value) return value;
        await sleep(80);
    }
    throw new Error(`timed out waiting for ${what}`);
}
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function runScenario(ffmpegWorks) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-e2e-'));
    const bin = path.join(home, 'bin');
    const dlDir = path.join(home, 'downloads');
    fs.mkdirSync(dlDir);
    makeTools(bin, ffmpegWorks);
    const logFile = path.join(home, 'args.log');
    const pidFile = path.join(home, 'pids.log');
    fs.writeFileSync(logFile, '');
    fs.writeFileSync(pidFile, '');
    const token = 'b'.repeat(64);
    const port = String(37000 + Math.floor(Math.random() * 900));
    const base = `http://127.0.0.1:${port}`;
    const env = {
        ...process.env, PORT: port, HOME: home, APPDATA: home, UNIGET_DOWNLOAD_DIR: dlDir,
        UNIGET_API_TOKEN: token, FAKE_LOG: logFile, FAKE_PIDS: pidFile, PATH: `${bin}:${process.env.PATH}`
    };
    delete env.UNIGET_TEST_DISABLE_RUNNER;
    const headers = { 'Content-Type': 'application/json', 'X-UniGet-Client': 'desktop', 'X-UniGet-Token': token };
    const post = async (p, body) => {
        const res = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: res.status, data: await res.json().catch(() => null) };
    };
    const status = async (id) => (await fetch(`${base}/api/status/${id}`, { headers })).json();
    const until = (id, wanted) => waitFor(async () => {
        const s = await status(id);
        return (typeof wanted === 'function' ? wanted(s) : s.status === wanted) ? s : null;
    }, `${id} → ${wanted}`);
    const ytDlpCalls = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    const start = () => {
        const child = spawn(process.execPath, ['server.js'], { cwd: rootDir, env, stdio: 'ignore' });
        return waitFor(async () => {
            try { return (await fetch(`${base}/api/health`)).ok ? child : null; } catch { return null; }
        }, 'server start');
    };
    const stop = async (child) => {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
    };

    let server = await start();
    try {
        // Info: UTF-8 survives, validate-media reuses the cached extraction.
        const info = await post('/api/info', { url: 'https://example.com/v' });
        assert.strictEqual(info.data.title, 'Türkçe başlık ğüşıöç 🎬');
        const validated = await post('/api/validate-media', { url: 'https://example.com/v' });
        assert.strictEqual(validated.data.downloadable, true);
        assert.strictEqual(ytDlpCalls().filter((a) => a.includes('-J')).length, 1, 'info sonucu önbellekten gelmeli');
        const bad = await post('/api/validate-media', { url: 'https://example.com/bad' });
        assert.strictEqual(bad.status, 422);

        // Completed download: path from the marker line, size, no internals.
        const ok = await post('/api/download', { url: 'https://example.com/ok', title: 'ok' });
        const okDone = await until(ok.data.id, 'completed');
        assert.ok(okDone.filePath.startsWith(dlDir));
        assert.strictEqual(okDone.fileSize, 100);
        assert.ok(okDone.completedAt);
        assert.ok(!Object.keys(okDone).some((k) => k.startsWith('_')), 'iç alanlar istemciye sızmamalı');

        // A title full of '|' must not be read as progress.
        const pipe = await post('/api/download', { url: 'https://example.com/pipe', title: 'pipe' });
        const pipeDone = await until(pipe.data.id, 'completed');
        assert.strictEqual(path.basename(pipeDone.filePath), 'a | b | c [id].mp4');

        // "Requested format is not available" → one retry with a simple format.
        const fmt = await post('/api/download', { url: 'https://www.youtube.com/watch?fmt', title: 'fmt' });
        await until(fmt.data.id, 'completed');

        const audio = await post('/api/download', { url: 'https://example.com/ok?audio', title: 'audio', quality: 'audio' });
        await until(audio.data.id, 'completed');
        const audioArgs = ytDlpCalls().find((a) => a.includes('https://example.com/ok?audio'));
        const ppa = audioArgs[audioArgs.indexOf('--postprocessor-args') + 1] || '';
        if (ffmpegWorks) {
            assert.ok(audioArgs.includes('-x'));
            assert.ok(!ppa || ppa.startsWith('Merger'), 'AAC zorlaması yalnızca birleştirmeye uygulanmalı');
        } else {
            assert.ok(!audioArgs.includes('-x'), 'FFmpeg yokken MP3 dönüşümü istenmemeli');
            assert.strictEqual(audioArgs[audioArgs.indexOf('--format') + 1], 'ba[ext=m4a]/ba/b');
            const trim = await post('/api/download', { url: 'https://example.com/ok?trim', title: 't', startTime: '00:00:05' });
            const trimmed = await until(trim.data.id, (s) => s.status.startsWith('error:'));
            assert.ok(trimmed.errorDetail.includes('FFmpeg'));
        }

        // Concurrency limit 1: the second waits, pause keeps "paused", the
        // queue moves on, cancel stops the process.
        await post('/api/settings', { maxConcurrent: 1 });
        fs.writeFileSync(pidFile, '');
        const first = await post('/api/download', { url: 'https://example.com/slow1', title: 's1' });
        await until(first.data.id, 'downloading');
        const second = await post('/api/download', { url: 'https://example.com/slow2', title: 's2' });
        await sleep(300);
        assert.strictEqual((await status(second.data.id)).status, 'queued');
        await post('/api/action', { id: first.data.id, action: 'pause' });
        await until(first.data.id, 'paused');
        await until(second.data.id, 'downloading');
        await sleep(300);
        assert.strictEqual((await status(first.data.id)).status, 'paused', 'duraklatılan indirme hataya dönmemeli');
        await post('/api/action', { id: second.data.id, action: 'cancel' });
        await sleep(400);
        const pids = fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number);
        assert.strictEqual(pids.filter(isAlive).length, 0, 'iptal/duraklatma yt-dlp sürecini bırakmamalı');
        await post('/api/action', { id: first.data.id, action: 'resume' });
        await until(first.data.id, 'downloading');

        // Shutdown stops yt-dlp; the interrupted download comes back paused.
        await stop(server);
        server = null;
        await sleep(200);
        assert.strictEqual(fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number).filter(isAlive).length, 0);
        server = await start();
        assert.strictEqual((await status(first.data.id)).status, 'paused');

        // Clearing the list must not be undone by the disk scan.
        await post('/api/clear-completed', {});
        const list = await (await fetch(`${base}/api/downloads`, { headers })).json();
        assert.strictEqual(Object.values(list).filter((d) => d.status === 'completed').length, 0);
    } finally {
        if (server) await stop(server);
        fs.rmSync(home, { recursive: true, force: true });
    }
}

(async () => {
    await runScenario(false);
    await runScenario(true);
    console.log('runner-e2e: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
