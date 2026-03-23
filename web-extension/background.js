const myBrowser = typeof browser !== 'undefined' ? browser : chrome;

// Create context menu for YouTube links
myBrowser.runtime.onInstalled.addListener(() => {
    myBrowser.contextMenus.create({
        id: "yt-dlm-download",
        title: "Download Media with YT-DLM",
        contexts: ["link", "video", "audio", "page"]
    });
});

// Handle context menu click
myBrowser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "yt-dlm-download") {
        let urlToDownload = info.linkUrl || info.srcUrl || info.pageUrl;
        // Send a message to content script to trigger download for this specific link
        myBrowser.tabs.sendMessage(tab.id, { action: "trigger_download", url: urlToDownload });
    }
});

myBrowser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "notify") {
        myBrowser.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'YT-DLM',
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
