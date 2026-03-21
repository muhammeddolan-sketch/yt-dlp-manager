const myBrowser = typeof browser !== 'undefined' ? browser : chrome;

// Create context menu for YouTube links
myBrowser.runtime.onInstalled.addListener(() => {
    myBrowser.contextMenus.create({
        id: "yt-dlm-download",
        title: "Download with YT-DLM",
        contexts: ["link"],
        targetUrlPatterns: ["*://*.youtube.com/watch*", "*://youtube.com/watch*", "*://youtu.be/*"]
    });
});

// Handle context menu click
myBrowser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "yt-dlm-download") {
        // Send a message to content script to trigger download for this specific link
        myBrowser.tabs.sendMessage(tab.id, { action: "trigger_download", url: info.linkUrl });
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

    const targetUrl = request.url.replace('localhost', '127.0.0.1');
    fetch(targetUrl, {
        method: request.method || 'GET',
        headers: { "Content-Type": "application/json" },
        body: request.data ? JSON.stringify(request.data) : undefined
    })
    .then(res => res.json())
    .then(data => {
        sendResponse(data);
    })
    .catch(err => {
        sendResponse({ error: "Background Fetch Failed: " + (err.message || 'Unknown') });
    });
    
    return true; 
});
