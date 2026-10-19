# UniGet - Ultimate Media Manager v1.8.9

UniGet (formerly YT-DLM) is a premium, modern, and powerful graphical user interface (GUI) for `yt-dlp`. Designed with a **sidebar-driven, horizontal library layout** over a high-performance foundation, it offers an experience that surpasses traditional download managers by combining advanced features with contemporary design.

## Key Features

- **Zero-Configuration**: Automatically downloads and manages `yt-dlp` on Windows. If FFmpeg is installed or bundled, UniGet uses it for higher-quality merges; otherwise it falls back to single-file progressive formats.
- **One-Click Tool Updates**: The bundled `yt-dlp` version is shown in Settings and can be updated from the official GitHub release with one click.
- **Self-Updating App**: Packaged builds check GitHub Releases automatically, download updates in the background, and let you install with one click.
- **Premium UI**: A sleek, sidebar-driven layout with a horizontal video library, full **Dark & Light Mode** support, and live library counters.
- **Turbo Multi-threaded Downloads**: Uses multi-connection techniques to saturate your bandwidth for maximum speed.
- **Video Trimming (Partial Downloads)**: Only need a clip? Set a start and end time (HH:MM:SS) to download exactly what you need.
- **Universal Web Extension**: Capture media from almost any site. Optimized for YouTube and Shorts.
- **Metadata & Subtitle Magic**: Automatically embeds thumbnails, tags, and subtitles into your files.
- **Advanced Desktop Integration**:
  - **Tray Support**: Minimize to system tray and manage downloads from the right-click menu.
  - **Smart Power Modes**: Automatically switches to 'Eco' mode on battery and 'Turbo' on AC.
- **Real-time Stats**: Live updates on download speed, ETA, and progress with high-performance charts.

## Tech Stack

- **Desktop Framework**: Electron
- **Backend Server**: Express.js & Node.js
- **Real-time Communication**: Socket.io
- **Styling**: Modern gradient CSS with design tokens (lightweight transitions only — no heavy effects, for performance)
- **Engine**: yt-dlp

## Installation (Kurulum)

### Windows (Recommended)
Simply download the latest `UniGet-Setup-<version>.exe` from the [Releases](https://github.com/muhammeddolan-sketch/yt-dlp-manager/releases) page and run it. The installer will:
1. Create a desktop shortcut.
2. Register the app in the Start Menu.
3. Handle all dependencies automatically upon first launch.

### Developer Setup
1. **Clone & Install**: `npm install`
2. **Start Development**: `npm start`
3. **Run Checks**: `npm test`
4. **Build Installer**: `npm run dist:win`
5. **Package Browser Extension**: `npm run pack:extension`

### Auto-Update (Yayıncılar için)

Kurulu uygulamalar `electron-updater` ile GitHub Releases üzerinden kendini günceller. İndirme bildirimi otomatik yapılır ve güncelleme kapanışta kurulur; ayrıca **Ayarlar → Güncelleme Kontrol Et** düğmesiyle elle kontrol edilip "Yeniden Başlat ve Kur" ile hemen uygulanabilir.

> **Önemli:** Sürüm yayınlarken `electron-builder`'ın ürettiği `latest.yml` (ve `.blockmap`) mutlaka GitHub Release varlıklarına yüklenmelidir. `latest.yml` olmadan otomatik güncelleme sessizce başarısız olur. Bunu garanti etmek için `GH_TOKEN` ayarlıyken `npm run dist:publish` kullanın.

## Browser Extension

UniGet keeps a ready-to-load copy of the extension in `%APPDATA%\uniget\extension` (Windows) or `~/.config/uniget/extension` (macOS/Linux). Click **Klasörü Aç** in the setup panel and load that folder once via `chrome://extensions` → Developer mode → Load unpacked. On every UniGet update the files in that folder are refreshed automatically; reload the extension (`chrome://extensions` → Reload) or restart the browser to pick up the new version. The setup panel shows the installed version and warns when a reload is needed.

Alternatively, load the latest `UniGet-Extension-v<version>.zip` (unpacked) into your Chromium-based browser (Brave, Chrome, Edge) via "Load unpacked". For Firefox use `UniGet-Firefox-Extension-v<version>.zip`. The extension connects to the local server to send downloads instantly.

## Security Notes

- The local API binds only to `127.0.0.1`; state-changing requests require the `X-UniGet-Client` header and cross-origin access is restricted.
- The optional **post-download command** is executed by your local shell after a download completes. Only enter commands you trust.

## License
This project is licensed under the **ISC License**.

---
Created by **Antigravity AI** - Designed for Efficiency.
