const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const port = String(35000 + Math.floor(Math.random() * 1000));
const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-test-'));
const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-downloads-'));

function startServer() {
    return spawn(process.execPath, ['server.js'], {
        cwd: rootDir,
        env: {
            ...process.env,
            PORT: port,
            APPDATA: appDataDir,
            UNIGET_DOWNLOAD_DIR: downloadsDir,
            UNIGET_TEST_DISABLE_RUNNER: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

async function waitForHealth(baseUrl, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/api/health`);
            if (res.ok) return res.json();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Server did not become healthy in time');
}

async function statusFor(url, options) {
    const res = await fetch(url, options);
    await res.text().catch(() => '');
    return res.status;
}

(async () => {
    const child = startServer();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        const health = await waitForHealth(baseUrl);
        assert.strictEqual(health.status, 'ok');
        assert.strictEqual(health.app, 'UniGet');
        assert.strictEqual(health.version, '1.5.12');

        const toolsRes = await fetch(`${baseUrl}/api/tools`);
        assert.strictEqual(toolsRes.status, 200);
        const tools = await toolsRes.json();
        assert.ok(tools.ytDlp);
        assert.ok(tools.ffmpeg);
        assert.ok(['full-quality', 'progressive-fallback'].includes(tools.ffmpeg.mode));

        const emptyDownloadsRes = await fetch(`${baseUrl}/api/downloads`);
        assert.strictEqual(emptyDownloadsRes.status, 200);
        assert.deepStrictEqual(await emptyDownloadsRes.json(), {});

        const missingHeader = await statusFor(`${baseUrl}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com/video' })
        });
        assert.strictEqual(missingHeader, 403);

        const invalidUrl = await statusFor(`${baseUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-UniGet-Client': 'desktop'
            },
            body: JSON.stringify({ url: 'file:///tmp/video' })
        });
        assert.strictEqual(invalidUrl, 400);

        const invalidTime = await statusFor(`${baseUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-UniGet-Client': 'desktop'
            },
            body: JSON.stringify({ url: 'https://example.com/video', startTime: 'bad-time' })
        });
        assert.strictEqual(invalidTime, 400);

        const createRes = await fetch(`${baseUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-UniGet-Client': 'desktop'
            },
            body: JSON.stringify({
                url: 'https://example.com/video.mp4',
                title: 'Smoke Test',
                quality: '720'
            })
        });
        assert.strictEqual(createRes.status, 200);
        const created = await createRes.json();
        assert.ok(created.id);
        assert.ok(created.download);
        assert.strictEqual(created.download.id, created.id);
        assert.strictEqual(created.download.title, 'Smoke Test');

        const populatedDownloadsRes = await fetch(`${baseUrl}/api/downloads`);
        assert.strictEqual(populatedDownloadsRes.status, 200);
        const populatedDownloads = await populatedDownloadsRes.json();
        assert.ok(populatedDownloads[created.id]);
        assert.strictEqual(populatedDownloads[created.id].title, 'Smoke Test');

        const diskFile = path.join(downloadsDir, 'Existing Video.mp4');
        fs.writeFileSync(diskFile, Buffer.from('fake-video'));
        const diskDownloadsRes = await fetch(`${baseUrl}/api/downloads`);
        assert.strictEqual(diskDownloadsRes.status, 200);
        const diskDownloads = await diskDownloadsRes.json();
        const diskEntry = Object.values(diskDownloads).find((entry) => entry.filePath === diskFile);
        assert.ok(diskEntry);
        assert.strictEqual(diskEntry.status, 'completed');
        assert.strictEqual(diskEntry.title, 'Existing Video');
    } finally {
        child.kill('SIGTERM');
        fs.rmSync(appDataDir, { recursive: true, force: true });
        fs.rmSync(downloadsDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
