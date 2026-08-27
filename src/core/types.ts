/**
 * Core types for LAN File Transfer Application
 */

export type TransferState =
  | 'IDLE'
  | 'FILES_SELECTED'
  | 'SERVER_STARTING'
  | 'WAITING_FOR_RECEIVER'
  | 'RECEIVER_CONNECTED'
  | 'RECEIVER_CONFIRMED'
  | 'TRANSFERRING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXPIRED'
  | 'SHUTDOWN';

export type ErrorCode =
  | 'NETWORK_ERROR'
  | 'SERVER_START_FAILED'
  | 'PORT_UNAVAILABLE'
  | 'FILE_NOT_FOUND'
  | 'FILE_READ_FAILED'
  | 'FILE_WRITE_FAILED'
  | 'DISK_FULL'
  | 'PERMISSION_DENIED'
  | 'TRANSFER_CANCELLED'
  | 'TRANSFER_EXPIRED'
  | 'INVALID_TOKEN'
  | 'RECEIVER_DISCONNECTED'
  | 'UNSUPPORTED_BROWSER'
  | 'FIREWALL_BLOCKED'
  | 'UNKNOWN_ERROR';

export type FileStatus = 'pending' | 'transferring' | 'completed' | 'skipped' | 'failed';

export interface FileProgressDetail {
  id: string;
  name: string;
  relativePath?: string;
  size: number;
  status: FileStatus;
  bytesTransferred: number;
  percentage: number;
}

export interface FileItem {
  id: string;
  name: string;
  relativePath?: string; // Subfolder path (e.g., "MyFolder/sub1/image.png")
  size: number;
  type: string;
  path: string; // Sender's local filesystem path (never sent to receiver over network)
}

export interface PublicFileItem {
  id: string;
  name: string;
  relativePath?: string; // Subfolder path
  size: number;
  type: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
  mac: string;
  isRecommended?: boolean;
}

export interface TransferManifest {
  transferId: string;
  token: string;
  pairingCode: string;
  files: PublicFileItem[];
  totalBytes: number;
  fileCount: number;
  senderName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ProgressUpdate {
  transferId: string;
  currentFileId: string;
  currentFileName: string;
  currentFileIndex: number;
  totalFiles: number;
  currentFileBytesTransferred: number;
  currentFileTotalBytes: number;
  totalBytesTransferred: number;
  totalBytes: number;
  speedBps: number; // Bytes per second
  etaSeconds: number;
  percentage: number; // 0 to 100
  fileDetails?: FileProgressDetail[];
}

export interface ServerConfig {
  port?: number;
  bindAddress?: string; // default 0.0.0.0
  selectedIp?: string; // LAN IP for URL generation
  idleTimeoutMs?: number; // default 10 mins (600_000 ms)
  pairingCode?: string;
  senderName?: string;
}

export interface TransferSessionInfo {
  transferId: string;
  token: string;
  pairingCode: string;
  shareUrl: string;
  qrCodeDataUrl: string;
  files: PublicFileItem[];
  totalBytes: number;
  ip: string;
  port: number;
  senderName: string;
  expiresAt: number;
}

export interface DiscoveredSender {
  code: string;
  ip: string;
  port: number;
  token: string;
  fileCount: number;
  totalBytes: number;
  senderName: string;
  firstSeen: number;
  lastSeen: number;
}

export interface ReceiverProgressUpdate {
  currentFileIndex: number;
  totalFiles: number;
  currentFileName: string;
  currentFileBytesDownloaded: number;
  currentFileTotalBytes: number;
  totalBytesDownloaded: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
  percentage: number;
  fileDetails?: FileProgressDetail[];
}

export interface ReceiverDownloadResult {
  success: boolean;
  saveDirectory: string;
  totalFiles: number;
  totalBytes: number;
  skippedFiles?: number;
  error?: string;
}

/**
 * WebSocket Messages exchanged between Server and Receiver/Sender
 */
export type WSMessageType =
  | 'RECEIVER_JOINED'
  | 'RECEIVER_CONFIRMED'
  | 'TRANSFER_PROGRESS'
  | 'FILE_COMPLETED'
  | 'FILE_SKIPPED'
  | 'SKIP_FILE'
  | 'TRANSFER_COMPLETED'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED'
  | 'HEARTBEAT'
  | 'HEARTBEAT_ACK';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
  timestamp: number;
}
