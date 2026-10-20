const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appVersion = require(path.join(rootDir, 'package.json')).version;
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
        assert.strictEqual(health.version, appVersion);

        const healthRes = await fetch(`${baseUrl}/api/health`);
        assert.strictEqual(healthRes.headers.get('x-powered-by'), null);
        assert.strictEqual(healthRes.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(healthRes.headers.get('x-frame-options'), 'DENY');

        const toolsRes = await fetch(`${baseUrl}/api/tools`);
        assert.strictEqual(toolsRes.status, 200);
        const tools = await toolsRes.json();
        assert.ok(tools.ytDlp);
        assert.ok(tools.ffmpeg);
        assert.strictEqual(tools.appVersion, appVersion);
        assert.ok('version' in tools.ytDlp);
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

        const malformedRes = await fetch(`${baseUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-UniGet-Client': 'desktop'
            },
            body: '{not-json'
        });
        assert.strictEqual(malformedRes.status, 400);
        assert.ok((malformedRes.headers.get('content-type') || '').includes('application/json'));
        const malformedText = await malformedRes.text();
        assert.ok(!malformedText.includes('body-parser'));
        assert.ok(!malformedText.includes('SyntaxError'));

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

        const unknownAction = await statusFor(`${baseUrl}/api/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-UniGet-Client': 'desktop'
            },
            body: JSON.stringify({ id: created.id, action: 'not-a-real-action' })
        });
        assert.strictEqual(unknownAction, 400);

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

        // Cache safety: a stale cached UI must never be able to survive an update.
        const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
        for (const asset of ['app.js', 'i18n.js']) {
            assert.ok(
                indexHtml.includes(`${asset}?v=${appVersion}`),
                `index.html ${asset} cache-buster sürümü package.json (${appVersion}) ile eşleşmiyor`
            );
        }
        const indexRes = await fetch(`${baseUrl}/`);
        assert.strictEqual(indexRes.status, 200);
        assert.ok((indexRes.headers.get('cache-control') || '').includes('no-cache'), 'index.html no-cache değil');
        await indexRes.text();
        const appJsRes = await fetch(`${baseUrl}/app.js?v=${appVersion}`);
        assert.strictEqual(appJsRes.status, 200);
        assert.ok((appJsRes.headers.get('cache-control') || '').includes('no-cache'), 'app.js no-cache değil');
        await appJsRes.text();
        const mainSrcForCache = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
        assert.ok(mainSrcForCache.includes('?v=${encodeURIComponent(app.getVersion())}'), 'main.js sürüm etiketli URL yüklemiyor');

        // Settings dialog structure: categorized tabs, scrollable body, scroll lock.
        const appSrc = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
        for (const panel of ['general', 'downloads', 'connection', 'tools']) {
            assert.ok(indexHtml.includes(`data-settings-panel="${panel}"`), `ayarlar "${panel}" paneli eksik`);
        }
        for (const id of [
            'langSelect', 'autostartCheck', 'accentColorInput', 'globalHotkeyInput',
            'downloadDirInput', 'selectDirBtn', 'saveDirBtn', 'powerModeSelect',
            'rateLimitInput', 'maxConcurrentInput', 'historyRetentionInput', 'smartRetryCheck',
            'outputTemplateInput', 'postDownloadCommandInput', 'cookiesBrowserSelect',
            'useBrowserCookiesCheck', 'checkUpdatesBtn', 'updateStatus', 'installUpdateBtn',
            'toolStatus', 'updateYtDlpBtn', 'installFfmpegBtn', 'repairToolsSettingsBtn'
        ]) {
            assert.ok(indexHtml.includes(`id="${id}"`), `ayarlar kontrolü #${id} eksik`);
        }
        assert.ok(appSrc.includes('repairToolsSettingsBtn'), 'app.js kalıcı Araçları Onar düğmesini bağlamıyor');
        assert.ok(appSrc.includes('activateSettingsTab'), 'app.js ayar sekmelerini yönetmiyor');
        assert.ok(appSrc.includes('syncModalScrollLock'), 'app.js modal açıkken arka plan kaydırmasını kilitlemiyor');
        const styleSrc = fs.readFileSync(path.join(rootDir, 'public', 'style.css'), 'utf8');
        assert.ok(styleSrc.includes('body.modal-open'), 'style.css modal açıkken sayfa kaydırmasını kilitlemiyor');
        assert.ok(styleSrc.includes('overscroll-behavior: contain'), 'style.css kaydırma zincirlemesini engellemiyor');

        // Horizontal layout: labeled left sidebar + two-column video library.
        assert.ok(indexHtml.includes('class="sidebar"'), 'sol sütun (sidebar) eksik');
        for (const id of ['newDownloadBtn', 'countAll', 'countDownloading', 'countCompleted', 'librarySummary', 'filterInput']) {
            assert.ok(indexHtml.includes(`id="${id}"`), `yeni yerleşim kontrolü #${id} eksik`);
        }
        assert.ok(appSrc.includes('refreshLibraryMeta'), 'app.js kitaplık sayaçlarını güncellemiyor');
        assert.ok(appSrc.includes('emptyStateKey'), 'app.js filtreye özel boş durum mesajı üretmiyor');
        assert.ok(styleSrc.includes('grid-template-columns: 252px minmax(0, 1fr)'), 'style.css sol sütun genişliğini tanımlamıyor');
        assert.ok(styleSrc.includes('grid-template-areas: "thumb details actions"'), 'style.css tam genişlik video satırını tanımlamıyor');
        assert.ok(styleSrc.includes('app-container[data-sidebar="collapsed"]'), 'style.css katlı sol sütun durumunu tanımlamıyor');
        assert.ok(styleSrc.includes('--scrollbar-thumb'), 'style.css kaydırma çubuğu temasını tanımlamıyor');
        assert.ok(styleSrc.includes('scrollbar-gutter: stable'), 'style.css liste kaydırmasında yer tutucu tanımlamıyor');
        const serverSrc = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
        assert.ok(serverSrc.includes('youtube:player_client=android,mweb'), 'FFmpeg yokken YouTube birleşik format istemcisi kullanılmıyor');
        const i18nSrc = fs.readFileSync(path.join(rootDir, 'public', 'i18n.js'), 'utf8');
        for (const key of ['new_download', 'library', 'tools', 'export_list', 'videos', 'no_completed', 'no_active', 'no_results', 'sidebar_collapse', 'sidebar_expand']) {
            assert.ok(i18nSrc.includes(`${key}:`), `i18n "${key}" anahtarı eksik`);
        }

        const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'web-extension', 'manifest.json'), 'utf8'));
        assert.strictEqual(manifest.version, appVersion);
        for (const prefix of ['UniGet-Extension-v', 'UniGet-Firefox-Extension-v']) {
            const packages = fs.readdirSync(rootDir).filter((name) => name.startsWith(prefix) && name.endsWith('.zip'));
            assert.ok(packages.length > 0, `${prefix} paketi bulunamadı`);
            assert.ok(packages.every((name) => name.includes(`v${appVersion}.zip`)), `${prefix} paket sürümü eski`);
        }

        // Auto-updater wiring: preload bridge + main-process IPC channels must stay in sync.
        const preloadSrc = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
        for (const method of ['getUpdateStatus', 'checkForUpdates', 'installUpdate', 'onUpdateStatus']) {
            assert.ok(preloadSrc.includes(`${method}:`), `preload.js ${method} köprüsünü sunmuyor`);
        }
        const mainSrc = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
        for (const channel of ["'update:check'", "'update:install'", "'update:status'", "'update:download'"]) {
            assert.ok(mainSrc.includes(channel), `main.js ${channel} kanalını işlemiyor`);
        }
        assert.ok(mainSrc.includes('setupAutoUpdater'), 'main.js otomatik güncelleyiciyi kurmuyor');
    } finally {
        child.kill('SIGTERM');
        fs.rmSync(appDataDir, { recursive: true, force: true });
        fs.rmSync(downloadsDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
