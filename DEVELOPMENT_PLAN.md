# LAN File Sharing Application — Step-by-Step Development Plan

**Project:** LAN File Transfer Application  
**Target Platform:** Windows Desktop (Electron + React + TypeScript) + Browser Receiver (Chrome/Edge/Mobile)  
**Created:** 2026-08-26  

---

## 1. Executive Summary & Goals

The goal is to develop an intuitive, high-performance, and secure LAN file transfer application that requires zero network/cloud configuration for users:
- **Sender:** Native Windows Desktop application (Electron + React + TypeScript + Tailwind CSS).
- **Receiver:** Universal web browser interface (Chrome / Edge / Firefox / Safari / Mobile) with zero installation required on the receiving device.
- **Transfer Mechanism:** High-throughput Node.js HTTP stream pipeline with WebSocket signaling and `window.showDirectoryPicker()` direct folder writing.
- **Reliability & Quality:** Every module is built and tested step-by-step before progressing.

---

## 2. System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SENDER (Desktop App)                            │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ React UI (Vite + Tailwind CSS + Lucide Icons + QR Generator)     │  │
│  └────────────────────────────────┬─────────────────────────────────┘  │
│                                   │ IPC (contextBridge)                │
│  ┌────────────────────────────────▼─────────────────────────────────┐  │
│  │ Electron Main Process & Transfer Manager                         │  │
│  │  - LAN Network Interface Auto-Detection & IP Selection           │  │
│  │  - Cryptographic Session Token Generation                        │  │
│  │  - Transfer Lifecycle & State Machine Management                 │  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ Temporary Node.js Transfer Server                          │  │  │
│  │  │  - HTTP Server (`0.0.0.0`, dynamic OS-assigned port)       │  │  │
│  │  │  - Zero-RAM HTTP Read Streaming (`fs.createReadStream`)    │  │  │
│  │  │  - WebSocket Real-Time Status Channel (`ws`)               │  │  │
│  │  │  - Embedded Receiver Web Assets Serving                    │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────┬─────────────────────────────────┘  │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ LAN HTTP / WebSocket
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       RECEIVER (Browser Web App)                       │
│                                                                        │
│  - Works across Chrome / Edge / Safari / Firefox / Android / iOS       │
│  - Chromium: Direct folder writing via `showDirectoryPicker()`         │
│  - Fallback: Direct stream / multi-file downloads for mobile           │
│  - Real-time chunked transfer tracking & speed/ETA calculation         │
│  - Post-write verification & completion notification                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Development Phases & Verification Steps

### Phase 1: Project Scaffolding & Core Foundations
- [ ] Initialize project with TypeScript, Vite, Vitest, Tailwind CSS, Lucide icons, Electron, and `ws`.
- [ ] Implement `src/core/network.ts`:
  - Intelligent IPv4 network adapter detection (Wi-Fi/Ethernet prioritization, filtering out virtual/loopback/APIPA adapters).
  - Multi-interface enumeration for manual override.
- [ ] Implement `src/core/crypto.ts`:
  - Cryptographic token generation (`base64url`).
  - Internal File ID obfuscation (prevents path traversal).
- [ ] Implement `src/core/types.ts`:
  - Transfer manifests, file descriptors, progress events, and state definitions.
- **Verification Step**: Run automated unit tests for network filtering, token generation, and path security.

### Phase 2: Core Streaming Server & State Machine
- [ ] Implement `src/core/state.ts`:
  - Finite State Machine with explicit transitions and validation:
    `IDLE` → `FILES_SELECTED` → `SERVER_STARTING` → `WAITING_FOR_RECEIVER` → `RECEIVER_CONNECTED` → `RECEIVER_CONFIRMED` → `TRANSFERRING` → `COMPLETED` / `CANCELLED` / `FAILED` / `EXPIRED` → `SHUTDOWN`.
- [ ] Implement `src/core/server.ts`:
  - HTTP server binding to `0.0.0.0:0` (dynamic port).
  - Endpoints:
    - `GET /share/:token` (Serves the receiver web application)
    - `GET /api/transfer/:token` (Returns transfer metadata & file list)
    - `GET /api/transfer/:token/file/:fileId` (High-performance chunked file streaming with `Range` support)
    - `POST /api/transfer/:token/complete` (Receiver completion confirmation)
    - `POST /api/transfer/:token/fail` (Receiver failure reporting)
  - WebSocket Server for bi-directional real-time events (progress, speeds, connection status, cancellation).
  - Timeout manager (auto shutdown after 10 min idle).
- **Verification Step**: Automated integration test suite launching the server, executing HTTP downloads via mock clients, asserting SHA-256 file checksums, and verifying clean socket teardown.

### Phase 3: Receiver Web Application
- [ ] Build responsive, modern Receiver UI (`src/receiver/`):
  - Clean view of incoming files, sizes, and total count.
  - Chromium directory selector via `window.showDirectoryPicker()`.
  - Fallback download trigger for non-Chromium / mobile browsers.
  - Live progress display with smooth animations, speed (MB/s), and ETA calculations.
  - Automatic collision resolution (`filename (1).ext`) or overwrite prompts.
  - Final write confirmation before sending `POST /complete`.
- [ ] Bundle receiver web assets into compact static assets ready for server delivery.
- **Verification Step**: End-to-end simulated receiver tests with simulated disk writes and checksum verification.

### Phase 4: Electron Main Process & IPC Layer
- [ ] Setup Electron Main Process (`src/main/index.ts`):
  - Window creation, frame controls, system tray / lifecycle handling.
  - Native file picker and directory picker dialogs.
  - Transfer Manager bridge orchestrating server start, progress forwarding, and graceful shutdown.
- [ ] Setup Preload Script (`src/preload/index.ts`):
  - Secure `contextBridge.exposeInMainWorld('electronAPI', ...)` providing strictly typed IPC methods.
- **Verification Step**: Unit & mock tests verifying IPC methods and data contracts.

### Phase 5: Desktop Sender React Application
- [ ] Implement modern, polished React interface (`src/renderer/`):
  - **Idle State**: Drag & drop zone with active drop styling, native file/folder selector buttons.
  - **Selected State**: File list with icons, sizes, remove item, total size counter, and "Send Files" CTA.
  - **Waiting State**: Large crisp QR code display, share URL with 1-click copy, network adapter selector, and cancel button.
  - **Transferring State**: Dynamic dual progress bars (current file + total), live throughput (MB/s with rolling average), ETA, transferred bytes / total bytes.
  - **Completed State**: Transfer summary, elapsed time, average throughput, "Send More" button.
  - **Error States**: Clear, actionable error messaging with retry options.
- **Verification Step**: UI component rendering and interaction tests.

### Phase 6: End-to-End System Testing & Performance Verification
- [ ] Automated end-to-end integration tests:
  - Multi-file transfers of varying sizes (small, medium, large multi-gigabyte).
  - Interrupt/cancel scenarios (receiver disconnect, sender cancel, invalid token).
  - Zero-RAM footprint verification during large file streams.
- [ ] Performance tuning & throughput verification.

### Phase 7: Build & Packaging
- [ ] Configure `electron-builder` for Windows installer and portable executables.
- [ ] Verify production build generation.
