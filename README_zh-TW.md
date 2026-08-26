# 局域網檔案快傳 (LAN File Transfer) ⚡

> **極速、隱私、零雲端中轉的局域網跨裝置檔案傳輸工具**

[English Documentation](README.md) | [繁體中文版說明文件](README_zh-TW.md)

![局域網檔案快傳介面](docs/images/app_zh.png)

---

## 🌟 核心特色

- 🚀 **極速局域網直連 (Zero-Cloud P2P)**：檔案完全在本地 Wi-Fi / 局域網內直連傳輸，不經過任何外部雲端伺服器，安全無虞且傳輸速度直達千兆 / 2.5G / Wi-Fi 6 硬體極限。
- 🔑 **5 位快速配對碼**：傳送端一鍵啟動分享，即時生成簡潔、無混淆字元的 5 位英文數字配對碼（例如 `X2KTV`）及動態 QR Code。
- 📡 **UDP 自動廣播與發現**：接收端打開程式即可自動搜尋並列出區域網路中所有正在傳送的電腦，點擊「接收」一鍵秒連。
- 📁 **自訂儲存資料夾**：接收檔案前會彈出原生資料夾選擇器，讓您自由決定儲存路徑，傳輸完成後可直接在檔案總管中開啟。
- 💾 **零記憶體占用串流傳輸**：基於 Node.js 檔案流 (`fs.createWriteStream`) 與反壓機制，傳輸 10GB+ 大型影片或壓縮檔皆穩定不崩潰，完全擺脫瀏覽器下載大小限制與快取錯誤。
- 🌐 **多國語言介面 (i18n)**：內建 **English**、**繁體中文**、**簡體中文**、**日本語**、**Español**、**Deutsch** 與 **Français**，右上角即可即時切換。
- 📦 **單檔免安裝版 (.exe)**：提供單一綠色執行檔，直接傳給家人或朋友電腦即可雙擊秒開，無需安裝 Node.js 或任何環境。

---

## 📸 實機截圖

| 傳送檔案畫面 | 接收檔案畫面 |
|:---:|:---:|
| ![傳送畫面](docs/images/app_send.png) | ![接收畫面](docs/images/app_receive.png) |

---

## 🔄 傳輸流程

```text
┌────────────────────────────────────────────────────────┐
│               傳送端 SENDER (Desktop .exe)              │
│                                                        │
│  1. 拖曳/選擇任意大小檔案或資料夾                          │
│  2. 點擊「開始傳送」                                    │
│  3. 自動生成 5 位配對碼 (如 X2KTV) 與 UDP 局域網廣播信標    │
│  4. 提供高吞吐量 Node.js HTTP/WS 流式串流服務           │
└───────────────────────────┬────────────────────────────┘
                            │ 局域網 TCP 串流 & UDP 信標
                            ▼
┌────────────────────────────────────────────────────────┐
│               接收端 RECEIVER (Desktop .exe)            │
│                                                        │
│  1. 切換至「接收檔案」分頁                              │
│  2. 點擊自動發現的傳送端卡片，或直接輸入 5 位配對碼        │
│  3. 彈出資料夾選擇視窗指定儲存位置                      │
│  4. 高速直寫硬碟，即時顯示 MB/s 速度與剩餘時間預估        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 快速開始

### 1. 取得執行檔 (Pre-built Executable)
您可以在 [`release/`](release/) 目錄下找到已打包的 Windows 程式：
- **免安裝版**: `LAN File Transfer 1.0.0.exe`（直接雙擊執行）
- **安裝版**: `LAN File Transfer Setup 1.0.0.exe`

### 2. 開發與原始碼編譯

**前置需求**:
- Node.js (v18+)
- npm

```bash
# 1. 複製專案庫
git clone https://github.com/kelvin0511/local-sharing-app.git
cd local-sharing-app

# 2. 安裝相依套件
npm install

# 3. 啟動桌面應用程式 (開發模式)
npm start

# 4. 執行完整自動化測試
npm test

# 5. 打包為 Windows .exe 執行檔
npm run dist
```

---

## 🛠️ 技術棧

- **桌面框架**: Electron 44, TypeScript
- **前端介面**: React 19, Vite, Tailwind CSS 4, Lucide Icons
- **傳輸核心**: Node.js HTTP Streaming, WebSocket (`ws`), UDP Multicast/Broadcast (`dgram`)
- **打包工具**: electron-builder, NSIS
- **單元測試**: Vitest (24/24 passed)

---

## 📄 開源授權

本專案採用 [MIT License](LICENSE) 授權。
