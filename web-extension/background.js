// Prefer the chrome namespace: it supports callback-style APIs in both
// Chrome and Firefox, whereas Firefox's `browser` namespace is promise-only
// and throws when a callback is passed (breaking sendMessage below).
const myBrowser = typeof chrome !== 'undefined' && chrome.runtime ? chrome : browser;
const responseCache = new Map();
const FETCH_TIMEOUT_MS = 7000;

function isAllowedFetchUrl(value) {
    try {
        const parsed = new URL(value);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
            parsed.protocol === 'http:' &&
            parsed.port === '3000') {
            return true;
        }
        return parsed.protocol === 'https:' && parsed.hostname === 'noembed.com';
    } catch {
        return false;
    }
}

function isUniGetApiUrl(value) {
    try {
        const parsed = new URL(value);
        return (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
            parsed.protocol === 'http:' &&
            parsed.port === '3000';
    } catch {
        return false;
    }
}

const TOKEN_KEY = 'unigetApiToken';
const PAIR_WAIT_MS = 125000;
const isTurkish = String(navigator.language || '').toLowerCase().startsWith('tr');
const pairMessages = isTurkish ? {
    prompt: 'UniGet uygulamasında bu tarayıcı yardımcısının bağlantısını onaylayın.',
    denied: 'UniGet bağlantı isteği reddedildi.',
    timeout: 'UniGet bağlantı isteği zaman aşımına uğradı.',
    busy: 'UniGet başka bir bağlantı isteğini bekliyor.',
    unavailable: 'UniGet bağlantı onayı açılamadı. Uygulamayı yeniden başlatın.'
} : {
    prompt: 'Approve this browser helper in the UniGet app.',
    denied: 'UniGet connection request was denied.',
    timeout: 'UniGet connection request timed out.',
    busy: 'UniGet is waiting for another connection request.',
    unavailable: 'UniGet could not show the approval dialog. Restart the app.'
};
let pairingPromise = null;

function storageGet(key) {
    return new Promise(resolve => myBrowser.storage.local.get(key, items => resolve(items ? items[key] : undefined)));
}

function storageSet(items) {
    return new Promise(resolve => myBrowser.storage.local.set(items, () => resolve()));
}

function storageRemove(key) {
    return new Promise(resolve => myBrowser.storage.local.remove(key, () => resolve()));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function rawFetchJson(url, options = {}, token = null) {
    const method = options.method || 'GET';
    const cacheKey = method === 'GET' && url.includes('https://noembed.com/') ? url : null;
    if (cacheKey && responseCache.has(cacheKey)) {
        const cached = responseCache.get(cacheKey);
        if (Date.now() - cached.ts < 2 * 60 * 1000) return cached.data;
        responseCache.delete(cacheKey);
    }

    const headers = { ...(options.headers || { 'Content-Type': 'application/json' }) };
    if (isUniGetApiUrl(url)) {
        headers['X-UniGet-Client'] = 'extension';
        if (token) headers['X-UniGet-Token'] = token;
    }
    const timeoutMs = Number.isFinite(options.timeout) ? options.timeout : FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method,
            headers,
            body: options.body || undefined,
            signal: controller.signal
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            let code = '';
            try { code = JSON.parse(text).error || ''; } catch {}
            const err = new Error(`HTTP ${res.status}: ${text}`);
            err.status = res.status;
            err.code = code;
            throw err;
        }
        const data = await res.json();
        if (cacheKey) responseCache.set(cacheKey, { ts: Date.now(), data });
        return data;
    } finally {
        clearTimeout(timeoutId);
    }
}

// One-time pairing: UniGet shows an approval dialog and hands this extension
// its own token, which only works for the download endpoints.
function pairWithApp(base) {
    if (pairingPromise) return pairingPromise;
    pairingPromise = (async () => {
        const jsonPost = (path, body) => rawFetchJson(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            timeout: 10000
        });
        let start;
        try {
            start = await jsonPost('/api/pair', {});
        } catch (err) {
            if (err.code === 'pairing_denied') throw new Error(pairMessages.denied);
            if (err.code === 'pairing_busy') throw new Error(pairMessages.busy);
            if (err.code === 'pairing_unavailable') throw new Error(pairMessages.unavailable);
            throw err;
        }
        if (!start?.requestId) throw new Error(pairMessages.unavailable);
        notify(pairMessages.prompt);
        const deadline = Date.now() + PAIR_WAIT_MS;
        while (Date.now() < deadline) {
            await delay(1000);
            // Extension API calls also keep the MV3 service worker alive.
            await storageGet(TOKEN_KEY);
            let poll;
            try {
                poll = await jsonPost('/api/pair/poll', { requestId: start.requestId });
            } catch (err) {
                if (err.status === 404) throw new Error(pairMessages.timeout);
                throw err;
            }
            if (poll?.status === 'approved' && poll.token) {
                await storageSet({ [TOKEN_KEY]: poll.token });
                return poll.token;
            }
            if (poll?.status === 'denied') throw new Error(pairMessages.denied);
        }
        throw new Error(pairMessages.timeout);
    })().finally(() => {
        pairingPromise = null;
    });
    return pairingPromise;
}

async function fetchJsonForContentScript(url, options = {}) {
    if (!isUniGetApiUrl(url)) return rawFetchJson(url, options);
    const token = await storageGet(TOKEN_KEY);
    try {
        return await rawFetchJson(url, options, token);
    } catch (err) {
        if (err.status !== 401) throw err;
        await storageRemove(TOKEN_KEY);
        const freshToken = await pairWithApp(new URL(url).origin);
        return rawFetchJson(url, options, freshToken);
    }
}

function notify(message) {
    myBrowser.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'UniGet',
        message
    });
}

myBrowser.runtime.onInstalled.addListener(() => {
    myBrowser.contextMenus.create({
        id: 'uniget-download',
        title: 'Download with UniGet',
        contexts: ['link', 'video', 'audio', 'page']
    });
});

myBrowser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'uniget-download') return;
    const url = info.linkUrl || info.srcUrl || info.pageUrl;

    myBrowser.tabs.sendMessage(tab.id, { action: 'trigger_download', url }, () => {
        if (!myBrowser.runtime.lastError) return;

        fetchJsonForContentScript('http://127.0.0.1:3000/api/validate-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            timeout: 32000
        })
        .then(data => {
            if (!data || data.error) throw new Error(data?.error || 'Media could not be verified');
            if (data.downloadable === false || data.mediaType === 'image') throw new Error('Not a video/audio URL');
            return fetchJsonForContentScript('http://127.0.0.1:3000/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    title: tab?.title || data.title || 'Media',
                    thumbnail: data.thumbnail || null,
                    quality: 'best',
                    isPlaylist: false,
                    autoOpen: false
                })
            });
        })
        .then(data => {
            if (!data?.id) throw new Error(data?.error || 'failed');
            myBrowser.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'UniGet',
                message: 'Indirme kuyruga eklendi.'
            });
        })
        .catch(err => {
            myBrowser.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'UniGet',
                message: err.message && err.message !== 'Not a video/audio URL'
                    ? err.message.slice(0, 80)
                    : 'Video veya ses bulunamadi'
            });
        });
    });
});

myBrowser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notify') {
        myBrowser.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'UniGet',
            message: request.message
        });
        return;
    }

    if (request.type === 'fetch' || request.url) {
        const url = request.url || '';
        const options = request.options || {};
        if (!isAllowedFetchUrl(url)) {
            sendResponse({ error: 'URL not allowed' });
            return;
        }

        fetchJsonForContentScript(url, options)
            .then(data => sendResponse(data))
            .catch(async err => {
                if (url.includes('localhost')) {
                    try {
                        const fallbackUrl = new URL(url);
                        fallbackUrl.hostname = '127.0.0.1';
                        sendResponse(await fetchJsonForContentScript(fallbackUrl.toString(), options));
                        return;
                    } catch (fallbackErr) {
                        sendResponse({ error: fallbackErr.message || err.message || 'Fetch failed' });
                        return;
                    }
                }
                sendResponse({ error: err.message || 'Fetch failed' });
            });
        return true;
    }
});
