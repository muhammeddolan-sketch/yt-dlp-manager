# YT-DLP Manager (YT-DLM) Pro v1.4.6

YT-DLP Manager Pro is a modern, powerful, and easy-to-use graphical user interface (GUI) for the popular `yt-dlp` tool. Designed with a clean **Matte & Premium aesthetic**, it offers an experience that surpasses traditional download managers like IDM by combining advanced features with contemporary design.

## 🚀 Key Features

- **Matte & Premium UI**: A sleek, minimal, and modern interface with full **Dark & Light Mode** support.
- **Turbo Multi-threaded Downloads**: Uses multi-connection technics (`-N 12`) to download segments simultaneously, saturating your bandwidth.
- **Video Trimming (Partial Downloads)**: Only need a clip? Set a start and end time (HH:MM:SS) to download exactly what you need.
- **Universal Web Extension**: Capture media from almost any site. Optimized for YouTube and Shorts (only triggers on media pages to keep your browsing clean).
- **Metadata & Subtitle Magic**: Automatically embeds thumbnails, tags, and subtitles into your mp4/mp3 files.
- **Advanced Desktop Integration**:
  - **Tray Support**: Minimize to system tray and manage downloads from the right-click menu.
  - **Background Search & Startup**: Optional silent startup with your computer to keep capture ready in the background.
- **Customizable Organization**: Choose your own download folder with a native folder picker dialog.
- **Socket.io Real-time Stats**: Get live updates on download speed, ETA, and progress with high-performance charts.

## 🛠️ Tech Stack

- **Desktop Framework**: Electron
- **Backend Server**: Express.js & Node.js
- **Real-time Communication**: Socket.io
- **Styling**: Modern Matte CSS (Zero lag, zero glassmorphism for performance)
- **Engine**: yt-dlp & ffmpeg

## 📦 Installation (Kurulum)

### 🚀 Hızlı Kurulum (Tavsiye Edilen)

Linux kullanıcıları için her şeyi otomatik halleden bir kurulum asistanımız mevcut. Tek yapmanız gereken terminale şu komutları girmek:

```bash
chmod +x kurulum_setup.sh
./kurulum_setup.sh
```

Bu araç şunları yapar:
1. Gerekli sistem bağımlılıklarını (`yt-dlp`, `ffmpeg`, `npm`) otomatik yükler.
2. Uygulamayı paketleyerek `dist/` klasörü altına yükleme dosyalarını (`.deb` ve `.AppImage`) hazır eder.
3. Arzu ederseniz `.deb` dosyasını çift tıklayarak sisteminize kurabilirsiniz.

### 🛠️ Manuel Geliştirme Kurulumu

1. **Gereksinimler**: Node.js, yt-dlp ve ffmpeg sisteminizde kurulu olmalıdır.
2. **Kütüphaneleri Yükle**: `npm install`
3. **Başlat**: `npm start`
4. **Paketle**: `npm run dist`

## 🧩 Tarayıcı Eklentisi (Browser Extension)

`web-extension` klasöründeki dosyaları Chromium tabanlı tarayıcınıza (Brave, Chrome, Edge) "Paketlenmemiş öğe yükle" seçeneği ile ekleyin. Eklenti, sunucuyla yerel bir bağlantı kurarak indirmeleri anında uygulamaya gönderir.

## 📄 Lisans

Bu proje **ISC Lisansı** altındadır.

---
*Created with ❤️ by **Antigravity AI** - Designed for Efficiency.*
