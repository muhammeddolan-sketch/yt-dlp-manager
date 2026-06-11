# UniGet - Ultimate Media Manager v1.5.2

UniGet (formerly YT-DLM) is a premium, modern, and powerful graphical user interface (GUI) for `yt-dlp`. Designed with a **Matte & High-Performance aesthetic**, it offers an experience that surpasses traditional download managers by combining advanced features with contemporary design.

## Key Features

- **Zero-Configuration**: Automatically downloads and manages `yt-dlp` on Windows. If FFmpeg is installed or bundled, UniGet uses it for higher-quality merges; otherwise it falls back to single-file progressive formats.
- **Premium UI**: A sleek, minimal, and modern interface with full **Dark & Light Mode** support.
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
- **Styling**: Modern Matte CSS (Zero lag, zero glassmorphism for performance)
- **Engine**: yt-dlp

## Installation (Kurulum)

### Windows (Recommended)
Simply download the latest `UniGet-Setup-1.5.2.exe` from the [Releases](https://github.com/muhammeddolan-sketch/yt-dlp-manager/releases) page and run it. The installer will:
1. Create a desktop shortcut.
2. Register the app in the Start Menu.
3. Handle all dependencies automatically upon first launch.

### Developer Setup
1. **Clone & Install**: `npm install`
2. **Start Development**: `npm start`
3. **Run Checks**: `npm test`
4. **Build Installer**: `npm run dist:win`
5. **Package Browser Extension**: `npm run pack:extension`

## Browser Extension
Load the `UniGet-Extension-v1.5.2.zip` (unpacked) into your Chromium-based browser (Brave, Chrome, Edge) via "Load unpacked". The extension connects to the local server to send downloads instantly.

## License
This project is licensed under the **ISC License**.

---
Created by **Antigravity AI** - Designed for Efficiency.
