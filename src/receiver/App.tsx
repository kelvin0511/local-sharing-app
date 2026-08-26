import React, { useEffect, useState, useRef } from 'react';
import {
  Download,
  FolderDown,
  CheckCircle2,
  AlertCircle,
  File,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  Code2,
  Loader2,
  HardDrive,
  Wifi,
  ShieldCheck
} from 'lucide-react';
import { TransferManifest, PublicFileItem, ProgressUpdate, WSMessage } from '../core/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(filename: string, mimeType: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimeType.startsWith('image/')) {
    return <ImageIcon className="w-5 h-5 text-emerald-400 shrink-0" />;
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'].includes(ext) || mimeType.startsWith('video/')) {
    return <Video className="w-5 h-5 text-purple-400 shrink-0" />;
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext) || mimeType.startsWith('audio/')) {
    return <Music className="w-5 h-5 text-pink-400 shrink-0" />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
    return <Archive className="w-5 h-5 text-amber-400 shrink-0" />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'cpp', 'c', 'html', 'css'].includes(ext)) {
    return <Code2 className="w-5 h-5 text-cyan-400 shrink-0" />;
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'csv', 'xlsx'].includes(ext)) {
    return <FileText className="w-5 h-5 text-blue-400 shrink-0" />;
  }
  return <File className="w-5 h-5 text-slate-400 shrink-0" />;
}

export default function ReceiverApp() {
  const [token, setToken] = useState<string>('');
  const [manifest, setManifest] = useState<TransferManifest | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'CONFIRMING' | 'TRANSFERRING' | 'COMPLETED'>('IDLE');
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [supportsDirectoryPicker, setSupportsDirectoryPicker] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Check File System Access API support
    setSupportsDirectoryPicker(typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function');

    // Extract token from URL
    const pathname = window.location.pathname;
    let extractedToken = '';
    const shareMatch = pathname.match(/\/share\/([^/?#]+)/);
    if (shareMatch) {
      extractedToken = shareMatch[1];
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      extractedToken = urlParams.get('token') || '';
    }

    if (!extractedToken) {
      setError('No transfer token found in URL.');
      setLoading(false);
      return;
    }

    setToken(extractedToken);
    loadManifest(extractedToken);
  }, []);

  const loadManifest = async (t: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/transfer/${t}`);
      if (!res.ok) {
        throw new Error('Transfer link is invalid, expired, or server has closed.');
      }
      const data: TransferManifest = await res.json();
      setManifest(data);
      initWebSocket(t);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const initWebSocket = (t: string) => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${t}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          if (msg.type === 'TRANSFER_PROGRESS') {
            setProgress(msg.payload as ProgressUpdate);
          } else if (msg.type === 'TRANSFER_COMPLETED') {
            setStatus('COMPLETED');
          } else if (msg.type === 'TRANSFER_CANCELLED') {
            setError('Transfer was cancelled by the sender.');
          }
        } catch {
          // Ignore
        }
      };
    } catch {
      // Ignore WebSocket init error
    }
  };

  const handleStartReceive = async () => {
    if (!manifest) return;
    setError(null);
    setStatus('TRANSFERRING');

    if (supportsDirectoryPicker) {
      try {
        // Chromium File System Access API
        const dirPicker = (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
        const dirHandle = await dirPicker();

        // Inform sender
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'RECEIVER_CONFIRMED',
              payload: { client: 'Web Directory Picker' },
              timestamp: Date.now()
            })
          );
        }

        for (let i = 0; i < manifest.files.length; i++) {
          const file = manifest.files[i];
          setStatusMessage(`Receiving ${file.name} (${i + 1}/${manifest.files.length})...`);

          const res = await fetch(`/api/transfer/${token}/file/${file.id}`);
          if (!res.ok || !res.body) {
            throw new Error(`Failed to download ${file.name}`);
          }

          // Handle collision or create file
          const fileHandle = await dirHandle.getFileHandle(file.name, { create: true });
          const writable = await fileHandle.createWritable();
          await res.body.pipeTo(writable);
        }

        // Notify server that all files finished writing
        await fetch(`/api/transfer/${token}/complete`, { method: 'POST' });
        setStatus('COMPLETED');
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') {
          // User clicked cancel in folder picker
          setStatus('IDLE');
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Receive error: ${msg}`);
        setStatus('IDLE');
      }
    } else {
      // Fallback: Trigger standard browser file downloads
      try {
        for (let i = 0; i < manifest.files.length; i++) {
          const file = manifest.files[i];
          setStatusMessage(`Downloading ${file.name}...`);
          const link = document.createElement('a');
          link.href = `/api/transfer/${token}/file/${file.id}`;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          await new Promise((r) => setTimeout(r, 600));
        }

        await fetch(`/api/transfer/${token}/complete`, { method: 'POST' });
        setStatus('COMPLETED');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Download error: ${msg}`);
        setStatus('IDLE');
      }
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-100">Connecting to Sender...</h2>
        <p className="text-slate-400 text-sm mt-1">Establishing direct peer connection on LAN</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-red-400 mb-2">Transfer Error</h2>
        <p className="text-slate-300 text-sm mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (status === 'COMPLETED') {
    return (
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-14 h-14 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Transfer Complete!</h2>
        <p className="text-slate-300 text-sm mb-6">
          All {manifest?.fileCount} file(s) ({formatBytes(manifest?.totalBytes || 0)}) were received successfully and saved to disk.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs rounded-full">
          <ShieldCheck className="w-4 h-4" /> Direct Local Transfer Verified
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Incoming LAN Transfer
          </h1>
          <p className="text-xs text-slate-400 mt-1">Direct local peer-to-peer sharing</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-950/80 border border-indigo-700/50 text-indigo-300 text-xs font-semibold rounded-full">
          <Wifi className="w-3.5 h-3.5" /> Same LAN
        </span>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between py-4 text-sm text-slate-400">
        <span>
          <strong className="text-slate-200">{manifest?.fileCount}</strong> file(s) ready
        </span>
        <span>
          Total Size: <strong className="text-slate-200">{formatBytes(manifest?.totalBytes || 0)}</strong>
        </span>
      </div>

      {/* File List */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl divide-y divide-slate-800/60 max-h-60 overflow-y-auto mb-6">
        {manifest?.files.map((file: PublicFileItem) => (
          <div key={file.id} className="flex items-center justify-between p-3.5 hover:bg-slate-800/30 transition">
            <div className="flex items-center gap-3 min-w-0 pr-3">
              {getFileIcon(file.name, file.type)}
              <span className="text-sm font-medium text-slate-200 truncate">{file.name}</span>
            </div>
            <span className="text-xs text-slate-400 shrink-0">{formatBytes(file.size)}</span>
          </div>
        ))}
      </div>

      {/* Transfer Progress View */}
      {status === 'TRANSFERRING' && (
        <div className="mb-6 bg-slate-950/50 border border-slate-800 p-4 rounded-xl">
          <div className="flex justify-between items-center text-xs font-medium text-slate-300 mb-2">
            <span className="truncate pr-2">{statusMessage || (progress ? progress.currentFileName : 'Transferring...')}</span>
            <span className="text-indigo-400">{progress ? `${progress.percentage}%` : '0%'}</span>
          </div>
          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden mb-2">
            <div
              className="bg-gradient-to-r from-indigo-500 to-blue-500 h-full rounded-full transition-all duration-200"
              style={{ width: `${progress?.percentage || 0}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-slate-400">
            <span>
              {progress
                ? `${formatBytes(progress.totalBytesTransferred)} / ${formatBytes(progress.totalBytes)}`
                : 'Streaming files...'}
            </span>
            <span>
              {progress && progress.speedBps > 0
                ? `${(progress.speedBps / (1024 * 1024)).toFixed(1)} MB/s • ETA ${progress.etaSeconds}s`
                : 'Calculating speed...'}
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={handleStartReceive}
        disabled={status === 'TRANSFERRING'}
        className="w-full py-3.5 px-5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 transition duration-150 cursor-pointer"
      >
        {status === 'TRANSFERRING' ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Receiving Files...
          </>
        ) : supportsDirectoryPicker ? (
          <>
            <FolderDown className="w-5 h-5" />
            Choose Destination Folder & Receive
          </>
        ) : (
          <>
            <Download className="w-5 h-5" />
            Download All Files
          </>
        )}
      </button>

      {/* Helper notice */}
      <p className="text-center text-[11px] text-slate-500 mt-4 flex items-center justify-center gap-1.5">
        <HardDrive className="w-3.5 h-3.5" />
        Files transfer directly across your local network without cloud storage.
      </p>
    </div>
  );
}
