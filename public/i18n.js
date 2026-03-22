const translations = {
    tr: {
        app_title: "YT-DLM UniDownloader",
        all: "Hepsi",
        downloading: "İndirilenler",
        completed: "Tamamlananlar",
        open_folder: "Klasörü Aç",
        clear: "Temizle",
        clipboard_on: "Pano: Açık",
        clipboard_capturing: "(Bağlantılar Yakalanıyor)",
        support: "Destek Ol",
        placeholder_url: "URL yapıştırın (Pano otomatik algılar)",
        playlist: "Çalma Listesi",
        no_downloads: "Henüz bir indirme yok.",
        video_title: "Video Başlığı",
        uploader: "Yükleyici",
        duration: "Süre",
        quality: "İndirme Kalitesi",
        best: "En İyi (Orijinal)",
        audio: "Sadece Ses (MP3)",
        download_all_playlist: "Tüm Listeyi İndir",
        embed_subtitles: "Altyazıları Göm",
        start_download: "İndirmeyi Başlat",
        details: "İndirme Ayrıntıları",
        speed: "Anlık Hız",
        eta: "Kalan Süre",
        progress: "İlerleme",
        loading: "Yükleniyor...",
        error: "Hata",
        completed_status: "Tamamlandı",
        paused_status: "Durduruldu",
        pause: "Durdur",
        resume: "Devam Et",
        details_btn: "Ayrıntılar",
        donate_msg: "Geliştiriciye destek olmak için GitHub/Patreon sayfasını ziyaret edebilirsiniz!",
        connect_server: "Bağlanıyor...",
        processed: "İşleniyor...",
        download_btn: "İndir",
        cancel: "İptal",
        close: "Kapat",
        success: "Tamamlandı!",
        error_server: "Hata alınamadı veya sunucu kapalı.",
        auto_open: "İşlem Bitince Klasörü Aç"
    },
    en: {
        app_title: "YT-DLM UniDownloader",
        all: "All",
        downloading: "Downloading",
        completed: "Completed",
        open_folder: "Open Folder",
        clear: "Clear",
        clipboard_on: "Clipboard: ON",
        clipboard_capturing: "(Capturing Links)",
        support: "Support Us",
        placeholder_url: "Paste URL (Clipboard auto-detects)",
        playlist: "Playlist",
        no_downloads: "No downloads yet.",
        video_title: "Video Title",
        uploader: "Uploader",
        duration: "Duration",
        quality: "Download Quality",
        best: "Best (Original)",
        audio: "Audio Only (MP3)",
        download_all_playlist: "Download Full Playlist",
        embed_subtitles: "Embed Subtitles",
        start_download: "Start Download",
        details: "Download Details",
        speed: "Current Speed",
        eta: "Time Remaining",
        progress: "Progress",
        loading: "Loading...",
        error: "Error",
        completed_status: "Completed",
        paused_status: "Paused",
        pause: "Pause",
        resume: "Resume",
        details_btn: "Details",
        donate_msg: "You can visit the GitHub/Patreon page to support the developer!",
        connect_server: "Connecting...",
        processed: "Processing...",
        download_btn: "Download",
        cancel: "Cancel",
        close: "Close",
        success: "Completed!",
        error_server: "Failed to get info or server is down.",
        auto_open: "Open Folder on Completion"
    }
};

let currentLang = localStorage.getItem('yt_dlm_lang') || 'tr';

function t(key) {
    return translations[currentLang][key] || key;
}

function setLanguage(lang) {
    if (translations[lang]) {
        currentLang = lang;
        localStorage.setItem('yt_dlm_lang', lang);
        updateUI();
    }
}

function updateUI() {
    // This will be called to update static elements
    // We'll call it after DOM loads and when language changes
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.tagName === 'INPUT' && el.type === 'text') {
            el.placeholder = t(key);
        } else {
            el.innerText = t(key);
        }
    });
    
    // Some elements need special handling
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems[0].lastChild.textContent = ' ' + t('all');
    navItems[1].lastChild.textContent = ' ' + t('downloading');
    navItems[2].lastChild.textContent = ' ' + t('completed');
    
    // Reload list if it's there
    if (typeof renderList === 'function') renderList();
}
