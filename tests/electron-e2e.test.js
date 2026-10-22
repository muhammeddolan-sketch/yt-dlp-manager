// Starts the real Electron app (with a fake yt-dlp on PATH) and checks it
// over the Chrome DevTools protocol: token bridge, sandboxed preload IPC,
// UI download flow, pairing through the main process, backend crash
// recovery and clean shutdown. Needs a display (xvfb-run is used when there
// is none) and the Electron binary; POSIX only, like the fake tools.
// Run with: npm run test:electron
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFakeTools } = require('./helpers/fake-tools');

if (process.platform === 'win32') {
    console.log('electron-e2e: skipped on Windows');
    process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
const electronBin = require('electron');
const APP = 'http://127.0.0.1:3000';
const rendererPort = 39000 + Math.floor(Math.random() * 500);
const mainPort = rendererPort + 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, what, ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const value = await fn();
            if (value) return value;
        } catch {}
        await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}`);
}

async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
        return res.result.result.value;
    };
    return { send, evaluate, close: () => ws.close() };
}

// Zombies (exited, not reaped yet) still answer kill(0).
function isRunning(pid) {
    try {
        const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)]).toString().trim();
        return !!stat && !stat.startsWith('Z');
    } catch {
        return false;
    }
}

(async () => {
    try {
        await fetch(`${APP}/api/health`);
        throw new Error('port 3000 is busy: close UniGet before running this test');
    } catch (e) {
        if (String(e.message).includes('port 3000')) throw e;
    }

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uniget-electron-'));
    const bin = path.join(home, 'bin');
    makeFakeTools(bin, true);
    const argsLog = path.join(home, 'args.log');
    const pidFile = path.join(home, 'pids.log');
    fs.writeFileSync(argsLog, '');
    fs.writeFileSync(pidFile, '');
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: argsLog, FAKE_PIDS: pidFile };
    delete env.ELECTRON_RUN_AS_NODE;

    const electronArgs = ['--no-sandbox', `--remote-debugging-port=${rendererPort}`, `--inspect=${mainPort}`, '.'];
    const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
    const app = useXvfb
        ? spawn('xvfb-run', ['-a', electronBin, ...electronArgs], { cwd: rootDir, env, stdio: 'ignore', detached: true })
        : spawn(electronBin, electronArgs, { cwd: rootDir, env, stdio: 'ignore', detached: true });
    const headers = (token) => ({ 'Content-Type': 'application/json', 'X-UniGet-Client': 'desktop', 'X-UniGet-Token': token });

    let ui;
    let main;
    try {
        const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${rendererPort}/json/list`)).json())
            .find((t) => t.type === 'page' && t.url.startsWith(APP)), 'main window');
        ui = await connect(page.webSocketDebuggerUrl);
        await waitFor(() => ui.evaluate('document.readyState === "complete" && !!window.unigetAPI'), 'page load');

        const token = await ui.evaluate('window.unigetAPI.getApiToken()');
        assert.ok(/^[a-f0-9]{64}$/.test(token), 'preload token köprüsü çalışmalı');
        assert.strictEqual(token, fs.readFileSync(path.join(home, '.config/uniget/api-token'), 'utf8').trim());
        assert.strictEqual(typeof await ui.evaluate('window.unigetAPI.readClipboardText()'), 'string', 'pano IPC ile okunmalı');
        await waitFor(() => ui.evaluate(`document.getElementById('downloadDirInput').value`), 'settings loaded through the token');

        // Download through the UI: add dialog → info modal → confirm → card.
        await ui.evaluate(`localStorage.setItem('uniget_onboarded', 'true');
            const onboarding = document.getElementById('onboardingModal'); if (onboarding) onboarding.style.display = 'none';
            document.getElementById('newDownloadBtn').click();
            document.getElementById('addUrlInput').value = 'https://example.com/ok';
            document.getElementById('addForm').requestSubmit(); true`);
        await waitFor(() => ui.evaluate(`getComputedStyle(document.getElementById('infoModal')).display !== 'none'`), 'info modal');
        assert.strictEqual(await ui.evaluate(`document.getElementById('modalTitle').innerText`), 'Türkçe başlık ğüşıöç 🎬');
        await ui.evaluate(`document.getElementById('confirmDownload').click(); true`);
        await waitFor(() => ui.evaluate(`!!document.querySelector('.download-card.completed')`), 'completed card');
        // Switching language re-renders the cards' status text.
        const badge = `document.querySelector('.download-card.completed .status-badge').textContent.trim()`;
        await ui.evaluate(`setLanguage('en'); true`);
        const english = await ui.evaluate(badge);
        assert.strictEqual(english, await ui.evaluate(`t('completed_status')`));
        await ui.evaluate(`setLanguage('tr'); true`);
        assert.notStrictEqual(await ui.evaluate(badge), english, 'kart dil değişince güncellenmeli');
        const ytArgs = fs.readFileSync(argsLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((a) => a.includes('--progress'));
        assert.strictEqual(ytArgs[ytArgs.indexOf('--js-runtimes') + 1], `node:${electronBin}`, 'yt-dlp Electron Node çalışma ortamını almalı');

        // Escape closes dialogs; window.open never opens an app window.
        await ui.evaluate(`document.getElementById('openSettingsBtn').click(); true`);
        await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(200);
        assert.ok(await ui.evaluate(`getComputedStyle(document.getElementById('settingsModal')).display === 'none'`));
        const targetsBefore = (await (await fetch(`http://127.0.0.1:${rendererPort}/json/list`)).json()).length;
        await ui.evaluate(`window.open('https://example.com/x'); true`);
        await sleep(500);
        assert.strictEqual((await (await fetch(`http://127.0.0.1:${rendererPort}/json/list`)).json()).length, targetsBefore);

        // Pairing through the main process (dialog answered by the test).
        const mainTarget = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${mainPort}/json/list`)).json())[0], 'main inspector');
        main = await connect(mainTarget.webSocketDebuggerUrl);
        await main.evaluate(`process.mainModule.require('electron').dialog.showMessageBox = async () => ({ response: 1 }); true`);
        const extHeaders = { 'Content-Type': 'application/json', 'X-UniGet-Client': 'extension', Origin: 'chrome-extension://electrontest' };
        const pairing = await (await fetch(`${APP}/api/pair`, { method: 'POST', headers: extHeaders, body: '{}' })).json();
        const approved = await waitFor(async () => {
            const poll = await (await fetch(`${APP}/api/pair/poll`, { method: 'POST', headers: extHeaders, body: JSON.stringify({ requestId: pairing.requestId }) })).json();
            return poll.status === 'approved' ? poll : null;
        }, 'pairing approval');
        assert.ok(/^[a-f0-9]{64}$/.test(approved.token));

        // A crashed backend is restarted and the UI keeps working.
        const serverPid = Number(execFileSync('pgrep', ['-f', `${rootDir}/server.js`]).toString().trim().split('\n')[0]);
        process.kill(serverPid, 'SIGKILL');
        await waitFor(async () => {
            const pids = execFileSync('pgrep', ['-f', `${rootDir}/server.js`]).toString().trim().split('\n').map(Number);
            return !pids.includes(serverPid) && (await fetch(`${APP}/api/health`)).ok;
        }, 'backend restart', 20000);
        assert.ok(await waitFor(() => ui.evaluate(`(async () => (await fetch('/api/downloads', { headers: { 'X-UniGet-Token': ${JSON.stringify(token)} } })).ok)()`), 'UI after restart'));

        // Quitting with a running download stops yt-dlp and saves it for restore.
        fs.writeFileSync(pidFile, '');
        await fetch(`${APP}/api/download`, { method: 'POST', headers: headers(token), body: JSON.stringify({ url: 'https://example.com/slow', title: 'slow' }) });
        await waitFor(() => fs.readFileSync(pidFile, 'utf8').trim(), 'slow download');
        const ytPid = Number(fs.readFileSync(pidFile, 'utf8').trim().split('\n')[0]);
        await main.evaluate(`process.mainModule.require('electron').app.quit(); true`).catch(() => {});
        await waitFor(async () => { try { await fetch(`${APP}/api/health`); return false; } catch { return true; } }, 'backend stop', 15000);
        await waitFor(() => !isRunning(ytPid), 'yt-dlp stop', 5000);
        const state = JSON.parse(fs.readFileSync(path.join(home, '.config/uniget/downloads-state.json'), 'utf8'));
        assert.ok(Object.values(state).some((d) => d.title === 'slow'), 'çalışan indirme geri yükleme için kaydedilmeli');
        console.log('electron-e2e: ok');
    } finally {
        try { ui && ui.close(); } catch {}
        try { main && main.close(); } catch {}
        try { process.kill(-app.pid, 'SIGKILL'); } catch {}
        await sleep(300);
        fs.rmSync(home, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
