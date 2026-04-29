const myBrowser = typeof browser !== 'undefined' ? browser : chrome;

// Create context menu for YouTube links
myBrowser.runtime.onInstalled.addListener(() => {
    myBrowser.contextMenus.create({
        id: "uniget-download",
        title: "Download Media with UniGet",
        contexts: ["link", "video", "audio", "page"]
    });
});

// Handle context menu click
myBrowser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "uniget-download") {
        let urlToDownload = info.linkUrl || info.srcUrl || info.pageUrl;
        // Prefer content-script UI flow; fallback to direct API call if receiver is missing.
        myBrowser.tabs.sendMessage(tab.id, { action: "trigger_download", url: urlToDownload }, () => {
            if (!myBrowser.runtime.lastError) return;
            fetch('http://127.0.0.1:3000/api/download', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: urlToDownload,
                    title: (tab && tab.title) ? tab.title : 'Media',
                    quality: 'best',
                    isPlaylist: false,
                    autoOpen: true
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data && data.id) {
                    myBrowser.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon48.png',
                        title: 'UniGet',
                        message: 'Download queued.'
                    });
                } else {
                    throw new Error((data && data.error) || 'Download request failed');
                }
            })
            .catch(() => {
                myBrowser.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: 'UniGet',
                    message: 'Could not reach UniGet app on localhost:3000'
                });
            });
        });
    }
});

myBrowser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "notify") {
        myBrowser.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'UniGet',
            message: request.message
        });
        return;
    }

    // Handle generic fetch requests from content script
    if (request.type === 'fetch' || request.url) {
        const url = (request.url || '').replace('localhost', '127.0.0.1');
        const options = request.options || {};
        
        console.log(`BG Fetch to: ${url}`, options);
        
        fetch(url, {
            method: options.method || 'GET',
            headers: options.headers || { "Content-Type": "application/json" },
            body: options.body || undefined
        })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
        })
        .then(data => {
            console.log('BG Fetch Success:', data);
            sendResponse(data);
        })
        .catch(err => {
            console.error('BG Fetch Error:', err);
            sendResponse({ error: "Background Fetch Failed: " + (err.message || 'Unknown') });
        });
        return true; 
    }
});
