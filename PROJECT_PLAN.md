# LAN File Transfer — Project Plan & Technical Specification

**Status:** Planning / V0 prototype exists  
**Version:** 1.0  
**Last updated:** 2026-08-26

## 1. Product Goal

Build a simple LAN file-transfer application:

```text
Select files → Send → Temporary LAN server → Link / QR
→ Receiver opens link → Chooses destination folder
→ Files transfer directly over LAN → Receiver reports result
→ Sender closes server automatically
```

The core success criterion is that a normal user does **not** need to understand IP addresses, ports, servers, command-line tools, cloud storage, or networking configuration.

### Principles

- Same-LAN transfer
- No cloud upload
- No account required
- Temporary server only
- Receiver ideally needs no installation
- Large-file capable
- Multiple-file capable
- Clear progress and errors
- Secure temporary authorization
- Performance limited mainly by network/storage

## 2. Current Prototype

The current V0 prototype demonstrates:

- Node.js + TypeScript temporary HTTP server
- `0.0.0.0` LAN binding
- Random transfer token
- LAN URL generation
- Multiple files
- Browser receiver
- Chrome/Edge directory selection
- HTTP streaming using filesystem streams
- WebSocket status channel
- Completion notification
- Automatic shutdown

**Next:** replace the command-line sender with a desktop UI.

## 3. Target Architecture

```text
┌──────────────────────── Sender ────────────────────────┐
│ Electron                                               │
│  ├─ React UI                                           │
│  ├─ Transfer Manager                                   │
│  └─ Node.js LAN Server                                 │
│       ├─ HTTP                                          │
│       ├─ HTTP file streaming                           │
│       └─ WebSocket status/control                      │
└───────────────────────┬────────────────────────────────┘
                        │ LAN
                        ▼
              ┌──────────────────────┐
              │ Chrome / Edge        │
              │ Receiver UI          │
              │ File System Access   │
              └──────────────────────┘
```

### Recommended stack

- Desktop: Electron + React + TypeScript
- Server: Node.js + TypeScript
- HTTP: native Node HTTP or lightweight framework
- Status/control: WebSocket (`ws`)
- Receiver: HTML/CSS/JS/TS + File System Access API
- Persistence: none for MVP; active transfer state remains in memory

## 4. End-to-End Sender Flow

1. Open app.
2. Select files or drag/drop.
3. Review files and total size.
4. Click **Send**.
5. Validate files still exist.
6. Create transfer.
7. Generate cryptographically random token.
8. Start server on `0.0.0.0`.
9. Let OS select an available port.
10. Detect usable LAN IPv4 address.
11. Generate share URL.
12. Generate QR code.
13. Show waiting state.
14. Detect receiver.
15. Receiver confirms.
16. Stream files.
17. Show progress/speed/ETA.
18. Receive completion result.
19. Shut down server.
20. Show completed state.

## 5. Receiver Flow

1. Open or scan LAN URL.
2. Load receiver page.
3. Display files and total size.
4. Choose destination directory.
5. Confirm receive.
6. Download files through HTTP streaming.
7. Write files into selected directory.
8. Verify writes completed.
9. Report completion.
10. Show success.

Chrome/Edge should be the initial target because the File System Access API provides the required explicit folder-selection UX.

## 6. Transfer State Machine

```text
CREATED
  ↓
SERVER_STARTING
  ↓
WAITING_FOR_RECEIVER
  ↓
RECEIVER_CONNECTED
  ↓
RECEIVER_CONFIRMED
  ↓
TRANSFERRING
  ├──→ FAILED
  ├──→ CANCELLED
  ↓
RECEIVER_COMPLETED
  ↓
COMPLETED
  ↓
SHUTTING_DOWN
  ↓
CLOSED
```

Unused transfers may become:

```text
WAITING_FOR_RECEIVER → EXPIRED → SHUTTING_DOWN → CLOSED
```

## 7. Server Lifecycle

### Start

- Validate selected files.
- Create transfer object.
- Generate secure token.
- Start HTTP server.
- Bind to `0.0.0.0`.
- Use an OS-assigned port (`listen(0)`).
- Detect LAN address.
- Generate URL.
- Start WebSocket channel.
- Display URL/QR.

### Shutdown

Close the server when:

- Transfer completes
- Sender cancels
- Transfer expires
- Sender exits
- Fatal error occurs
- Maximum lifetime is reached

Clean up HTTP listener, WebSocket server, transfer state and temporary resources.

## 8. Network Design

### LAN binding

Use `0.0.0.0`, not `127.0.0.1`.

### IP detection

Do not blindly use the first network interface. Systems can contain Wi-Fi, Ethernet, VPN, Docker, Hyper-V, VirtualBox, WSL and other virtual adapters.

Eventually provide a reliable interface-selection strategy and optionally allow manual selection.

### Port

Use an OS-assigned port initially to avoid conflicts.

## 9. URL and Authorization

Example:

```text
http://192.168.1.25:43127/share/7c9d4f2e8a1b...
```

Generate tokens with cryptographic randomness, e.g. Node `crypto.randomBytes(...).toString("base64url")`.

Never use `Math.random()` for authorization.

The receiver must never be able to request an arbitrary sender filesystem path. It should only request an internal file ID mapped to a selected file.

## 10. API Design

Minimal protocol:

```text
GET  /share/:token
GET  /api/transfer
GET  /api/transfer/file/:fileId
POST /api/transfer/complete
POST /api/transfer/fail
```

A future version may make token validation explicit on every API path.

## 11. File Transfer

Use HTTP streaming:

```text
fs.createReadStream()
       ↓
HTTP response
       ↓
LAN
       ↓
Receiver
```

Never load an entire large file into memory. Avoid base64, whole-file JSON payloads and large WebSocket messages.

A 50 GB file should be possible on an 8 GB RAM machine.

## 12. Multiple Files

MVP supports multiple files. Initial transfer strategy is sequential:

```text
file A → complete
file B → complete
file C → complete
```

Parallel transfer can be evaluated later.

## 13. Progress

Display:

- Current filename
- Current-file progress
- Overall progress
- Speed
- ETA
- Completed/total files

Overall progress:

```text
bytesTransferred / totalBytes
```

Use a rolling time window for speed instead of only total elapsed time.

## 14. Completion and Failure

Receiver reports completion only after every file is received, written, and its writable stream is closed.

Failure cases include:

- Sender file disappears
- File read failure
- Receiver disconnect
- Network failure
- Destination write failure
- Disk full
- Permission denied
- Invalid token
- Expired transfer
- Sender cancellation
- Browser folder-access denial
- Timeout

Recommended internal error codes:

```text
NETWORK_ERROR
SERVER_START_FAILED
PORT_UNAVAILABLE
FILE_NOT_FOUND
FILE_READ_FAILED
FILE_WRITE_FAILED
DISK_FULL
PERMISSION_DENIED
TRANSFER_CANCELLED
TRANSFER_EXPIRED
INVALID_TOKEN
RECEIVER_DISCONNECTED
UNSUPPORTED_BROWSER
FIREWALL_BLOCKED
UNKNOWN_ERROR
```

## 15. Security

LAN should not automatically be considered trusted.

### MVP

- Cryptographically random temporary token
- Tokenized endpoints
- No arbitrary filesystem paths
- Temporary server
- Automatic expiration
- No cloud upload
- No permanent credentials

### Future

Evaluate:

- HTTPS
- Password/PIN
- Sender approval
- End-to-end encryption
- Security audit

HTTPS/E2E encryption must be designed deliberately because local certificate trust and browser behavior affect UX.

## 16. Browser Constraint

A normal webpage cannot silently write to arbitrary directories. The intended flow is:

```javascript
window.showDirectoryPicker()
```

The user explicitly grants access to the destination folder.

If broad browser support becomes mandatory, a native receiver may be required.

## 17. Filename Collision Policy

Must be decided before final MVP.

Example: destination already contains `photo.jpg`.

Options:

1. Ask: Replace / Keep Both / Cancel
2. Automatically rename to `photo (1).jpg`
3. Automatically replace

Recommended default: Ask or provide an explicit user setting.

## 18. Sender UI States

### Idle

```text
LAN File Transfer
Drop files here
[ Select Files ]
```

### Selected

```text
photo.jpg        24 MB
document.pdf      2 MB
video.mp4       1.2 GB

Total: 1.23 GB
[ Send ] [ Clear ]
```

### Waiting

```text
Waiting for receiver
http://192.168.1.25:43127/share/...
[ QR CODE ]
[ Cancel ]
```

### Transfer

```text
Sending video.mp4
██████████████░░░░░░ 71%
850 MB / 1.2 GB
82 MB/s
ETA: 4 sec
```

### Complete

```text
Transfer complete
3 files sent successfully.
[ Done ]
```

## 19. Receiver UI States

### Review

```text
Files from sender
photo.jpg        24 MB
document.pdf      2 MB
video.mp4       1.2 GB

Total: 1.23 GB
[ Choose folder ]
[ Receive files ]
```

### Transfer

```text
Receiving video.mp4
██████████████░░░░░░ 71%
850 MB / 1.2 GB
82 MB/s
```

### Complete

```text
Transfer complete
3 files saved successfully.
```

## 20. QR Code

The sender should display a QR code containing the complete LAN URL. This is particularly useful for PC → phone/tablet transfers.

QR is a convenience feature, not an authorization mechanism.

## 21. MVP Scope

- [ ] Electron desktop application
- [ ] React + TypeScript UI
- [ ] File picker
- [ ] Drag/drop
- [ ] Multiple files
- [ ] Temporary LAN server
- [ ] LAN IP detection
- [ ] Random transfer token
- [ ] Share URL
- [ ] QR code
- [ ] Browser receiver
- [ ] File list and total size
- [ ] Destination folder selection
- [ ] HTTP streaming
- [ ] Progress
- [ ] Speed and ETA
- [ ] WebSocket status
- [ ] Completion result
- [ ] Automatic shutdown
- [ ] Cancel
- [ ] Basic error handling
- [ ] Windows installer

## 22. Explicitly Out of MVP

Do not let these delay the first usable release:

- [ ] Cloud transfer
- [ ] Accounts
- [ ] Internet transfer
- [ ] Automatic device discovery
- [ ] Multiple receivers
- [ ] Transfer history
- [ ] Compression
- [ ] Resume
- [ ] Native mobile receiver
- [ ] E2E encryption
- [ ] Advanced firewall automation
- [ ] Persistent database
- [ ] Synchronization

## 23. Performance Goals

Primary goal:

> Performance should be limited mainly by LAN and storage rather than the application.

For 1 Gbps Ethernet:

```text
Theoretical: 125 MB/s
Practical target: approximately 80–115 MB/s
```

This is a target, not a guarantee. Wi-Fi, disks, antivirus, CPU and OS behavior affect actual results.

Memory usage should remain approximately independent of file size.

## 24. Testing Strategy

### Unit tests

- Token generation
- State transitions
- File metadata
- Filename sanitization
- Progress calculations
- Speed calculations
- Timeout logic
- Cleanup

### Integration tests

- Server startup
- LAN binding
- Transfer creation
- Receiver connection
- Single-file transfer
- Multiple-file transfer
- Completion
- Shutdown

### Failure tests

- Receiver disconnect
- Sender disconnect
- File deleted during transfer
- Disk full
- Duplicate filename
- Invalid token
- Expiration
- Cancellation
- Browser permission denial

### Performance tests

Files:

```text
10 MB
100 MB
1 GB
10 GB+
```

Networks:

```text
Wi-Fi
1 Gb Ethernet
2.5 Gb Ethernet if available
```

Measure throughput, CPU, RAM, duration and failures.

## 25. Milestones

### M0 — Core prototype

Already started. Proves end-to-end LAN transfer.

### M1 — Desktop sender

Build Electron + React, file picker, drag/drop, file list, Send, URL, QR, waiting state, Cancel and server lifecycle.

Goal: **No command line required.**

### M2 — Receiver UX

Improve design, folder selection, progress, speed, ETA, completion, errors and duplicate handling.

Goal: **Receiver experience is simple and safe.**

### M3 — Reliability

Add timeouts, disconnect handling, cleanup, explicit state machine, better errors and optional checksum.

Goal: **Failures are predictable and recoverable.**

### M4 — Packaging

Windows installer, icon, versioning, code signing if required, firewall guidance and production logging.

Goal: **A normal user can install and use it.**

### M5 — Performance

Optimize large files, fast LAN, Wi-Fi, memory, CPU and browser writes.

Goal: **Network/storage become the bottleneck.**

### M6 — Production hardening

Evaluate HTTPS, stronger authorization, resume, checksum, security audit, crash recovery and firewall handling.

## 26. Questions That Must Be Answered

### Product goal

1. Is the main use case PC → PC, PC → phone, phone → PC, or all?
2. Is this a personal utility, internal tool, open-source project, or public product?
3. Must the receiver remain installation-free?
4. Should the sender always be a desktop application?

### Platform

5. What is the first target OS?
6. Is Windows-only acceptable for V1?
7. Is macOS/Linux required?
8. Is mobile support required?

### Network

9. Same Wi-Fi/Ethernet only?
10. Should hotspot networks work?
11. Should corporate/guest networks be supported?
12. Should VPN/virtual adapters be supported?
13. Should the user manually choose the network interface?

### Receiver

14. Is Chrome/Edge-only acceptable for V1?
15. What happens on duplicate filenames?
16. Can the receiver select only some files?
17. Can the receiver cancel?
18. Should folder selection happen before or after transfer confirmation?

### Transfer

19. Sequential or parallel?
20. Is resume required?
21. Is checksum required?
22. If one file fails, abort all or continue?
23. Should compression exist?
24. Should folders/directories be supported?

### Security

25. Is random-token protection enough for V1?
26. Is encryption required?
27. Is HTTPS required?
28. Should there be a PIN/password?
29. Should sender approval be required?

### Lifecycle

30. How long should an unused link remain valid?
31. Should one successful receiver invalidate the link?
32. Should the server close immediately after completion?

### UX

33. Is QR mandatory?
34. Is drag/drop mandatory?
35. Should there be system-tray mode?
36. Should links have a Copy button?
37. Is transfer history needed?
38. Is Send Again needed?

### Performance

39. Largest expected file size?
40. Target LAN speed?
41. Is maximum speed more important than CPU/RAM?

### Distribution

42. Private/internal, open-source, free, or paid?
43. Automatic updates?
44. Code signing?
45. Portable version?

## 27. Recommended Defaults

If no special requirements exist:

```text
Sender: Windows desktop
Framework: Electron + React + TypeScript
Receiver: Chrome / Edge
Network: same LAN
Protocol: HTTP streaming
Status: WebSocket
Files: multiple
Transfer: sequential
Authorization: random temporary token
Encryption: not MVP
Resume: not MVP
Checksum: not MVP
Compression: no
Directories: not MVP
QR: yes
Drag/drop: yes
Server: temporary
Waiting timeout: 10 minutes
Concurrent receivers: 1
Database: none
Cloud: none
Accounts: none
```

## 28. Definition of Done

The MVP is done when a first-time user can:

1. Install the app.
2. Select a large file.
3. Click Send.
4. See a link and QR code.
5. Open the link from another device.
6. See correct files and sizes.
7. Select a destination folder.
8. Click Receive.
9. See meaningful progress.
10. Successfully open the received file.
11. See completion on the sender.
12. Have the temporary server automatically shut down.

If the user still needs to understand IP addresses, ports, command line commands, server processes, or manual cleanup, the UX is not finished.

## 29. Immediate Next Development Task

Implement **Milestone 1 — Desktop Sender** using the existing V0 server:

```text
Electron
  ↓
React
  ↓
File selection / drag-drop
  ↓
Transfer Manager
  ↓
Existing Node.js LAN server
  ↓
URL + QR
  ↓
Browser receiver
```

Do not implement resume, encryption, discovery, accounts, cloud transfer or other advanced features before the basic desktop sender → browser receiver flow is reliable.

## 30. Final Product Definition

The technical objective is not merely “transfer a file over HTTP.”

The actual product objective is:

> Make local file transfer feel effortless while keeping the file data local.

Ideal experience:

```text
Choose files
    ↓
Send
    ↓
Scan QR / open link
    ↓
Choose folder
    ↓
Receive
    ↓
Done
```

That simplicity is the primary product requirement.
