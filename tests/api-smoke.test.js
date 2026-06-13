const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const port = String(35000 + Math.floor(Math.random() * 1000));
const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-test-'));

function startServer() {
    return spawn(process.execPath, ['server.js'], {
        cwd: rootDir,
        env: {
            ...process.env,
            PORT: port,
            APPDATA: appDataDir
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
        assert.strictEqual(health.version, '1.5.3');

        const toolsRes = await fetch(`${baseUrl}/api/tools`);
        assert.strictEqual(toolsRes.status, 200);
        const tools = await toolsRes.json();
        assert.ok(tools.ytDlp);
        assert.ok(tools.ffmpeg);
        assert.ok(['full-quality', 'progressive-fallback'].includes(tools.ffmpeg.mode));

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
    } finally {
        child.kill('SIGTERM');
        fs.rmSync(appDataDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
