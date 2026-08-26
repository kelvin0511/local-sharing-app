# LAN File Transfer ⚡

> **High-speed, zero-cloud, cross-device local network file sharing application for desktop & mobile.**

[繁體中文版說明文件 (Traditional Chinese Document)](README_zh-TW.md) | [English Documentation](README.md)

![LAN File Transfer Send Screen](docs/images/app_send.png)

---

## 🌟 Key Features

- 🚀 **High-Speed Zero-Cloud P2P**: Direct streaming across your local Wi-Fi / Ethernet without uploading to any third-party cloud servers. Maximum throughput up to gigabit / 2.5G / Wi-Fi 6 hardware limits.
- 🔑 **5-Character Pairing Code**: Sender instantly generates a clean, unambiguous 5-character pairing code (e.g., `X2KTV`) and dynamic QR code.
- 📡 **UDP Local Auto-Discovery**: Receivers automatically discover active senders on the same LAN and display them as 1-click connect cards.
- 📁 **Custom Destination Folder**: Receiver chooses where to save files via native OS directory picker dialog, with one-click "Open in File Explorer" upon completion.
- 💾 **Zero-RAM Resilient Streaming**: Directly streams multi-GB files and 4K videos to disk using Node.js backpressured file streams (`fs.createWriteStream`). Eliminates browser download limits and disk cache errors.
- 🌐 **Multilingual Interface (i18n)**: Switch on the fly between **English**, **繁體中文 (Traditional Chinese)**, **简体中文 (Simplified Chinese)**, **日本語 (Japanese)**, **Español**, **Deutsch**, and **Français**.
- 📦 **Portable Standalone Executable (.exe)**: Run standalone on any Windows PC without installing Node.js or any runtime dependencies.

---

## 📸 Screenshots

| Send Screen | Receive Screen |
|:---:|:---:|
| ![Send Screen](docs/images/app_send.png) | ![Receive Screen](docs/images/app_receive.png) |

| Multilingual Support (Traditional Chinese) |
|:---:|
| ![Traditional Chinese UI](docs/images/app_zh.png) |

---

## 🔄 How It Works

```text
┌────────────────────────────────────────────────────────┐
│               SENDER (Desktop .exe)                    │
│                                                        │
│  1. Drag & drop files or folders of any size           │
│  2. Click "Start Sharing"                              │
│  3. Generates 5-letter Pairing Code (e.g. X2KTV) & UDP │
│  4. Spins up high-throughput stream server             │
└───────────────────────────┬────────────────────────────┘
                            │ LAN TCP Stream & UDP Beacon
                            ▼
┌────────────────────────────────────────────────────────┐
│               RECEIVER (Desktop .exe)                  │
│                                                        │
│  1. Switch to "Receive Files" tab                      │
│  2. Click auto-detected sender card or enter code      │
│  3. Select destination folder on your disk             │
│  4. High-speed direct streaming with MB/s & ETA        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 Quick Start

### 1. Pre-built Executable
You can find pre-built Windows executables in the [`release/`](release/) folder:
- **Portable Version**: `LAN File Transfer 1.0.0.exe` (Single standalone file, no installation required)
- **Installer Version**: `LAN File Transfer Setup 1.0.0.exe`

### 2. Run / Build from Source

**Prerequisites**:
- Node.js (v18+)
- npm

```bash
# 1. Clone repository
git clone https://github.com/kelvin0511/local-sharing-app.git
cd local-sharing-app

# 2. Install dependencies
npm install

# 3. Start development desktop app
npm start

# 4. Run automated test suite
npm test

# 5. Build production Windows .exe binaries
npm run dist
```

---

## 🛠️ Tech Stack

- **Desktop Shell**: Electron 44, TypeScript
- **Frontend**: React 19, Vite, Tailwind CSS 4, Lucide Icons
- **Core Streaming**: Node.js HTTP Streams, WebSocket (`ws`), UDP Multicast/Broadcast (`dgram`)
- **Packaging**: electron-builder, NSIS
- **Testing**: Vitest (24/24 unit & integration tests)

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
