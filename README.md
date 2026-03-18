# YT-DLP Manager (YT-DLM)

YT-DLP Manager is a modern, powerful, and easy-to-use graphical user interface (GUI) for the popular `yt-dlp` tool. Designed with an aesthetic inspired by Internet Download Manager (IDM), it provides a seamless experience for downloading videos, audio, and playlists from YouTube and many other sites.

## 🚀 Key Features

- **Intuitive GUI**: A sleek, minimal, and premium interface for managing your downloads.
- **Browser Integration**: Comes with a companion web extension to capture downloads directly from your browser.
- **Real-time Progress**: Integrated `socket.io` to provide live download status, speeds, and ETA.
- **Support for Many Sites**: Leverages the power of `yt-dlp` to support hundreds of platforms.
- **Automatic Organization**: Saves your media directly to `/home/slawn/Videolar/IDM` for easy access.
- **Multi-format Support**: Downloader seamlessly handles video and audio conversion.

## 🛠️ Tech Stack

- **Core**: JavaScript, Node.js
- **Desktop Framework**: Electron
- **Backend Server**: Express.js
- **Real-time Communication**: Socket.io
- **Styling**: Vanilla CSS (Premium & Modern)
- **Downloader Engine**: yt-dlp

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v16.0.0 or higher)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and in your system PATH.
- [ffmpeg](https://ffmpeg.org/) (for video merging and conversions).

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/slawn/yt-dlp-manager.git
   cd yt-dlp-manager
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the application**:
   ```bash
   npm start
   ```

## 🧩 Browser Extension

A companion extension is available in the `web-extension` directory. You can load it into Chrome-based browsers as an "unpacked extension" to enable one-click downloads directly from YouTube.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue.

## 📄 License

This project is licensed under the ISC License.

---
*Created with ❤️ by Antigravity AI*
