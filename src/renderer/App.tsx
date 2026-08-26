import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  Download,
  FilePlus,
  FolderPlus,
  Trash2,
  Copy,
  Check,
  Send,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Network,
  Share2,
  Loader2,
  HardDrive,
  File,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  Code2,
  Zap,
  ArrowRight,
  FolderOpen,
  Radio,
  RefreshCw,
  Laptop,
  Globe,
  ChevronDown
} from 'lucide-react';
import {
  DiscoveredSender,
  NetworkInterfaceInfo,
  ProgressUpdate,
  ReceiverDownloadResult,
  ReceiverProgressUpdate,
  TransferManifest,
  TransferSessionInfo,
  TransferState
} from '../core/types';
import { StateChangeEvent } from '../core/state';
import {
  LANGUAGE_OPTIONS,
  TRANSLATIONS,
  SupportedLanguage
} from './i18n';

interface SelectedFile {
  name: string;
  path: string;
  size: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 MB/s';
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps < 0.1) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${mbps.toFixed(1)} MB/s`;
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <ImageIcon className="w-5 h-5 text-emerald-400 shrink-0" />;
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'].includes(ext)) {
    return <Video className="w-5 h-5 text-purple-400 shrink-0" />;
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
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

const electronAPI = (window as unknown as { electronAPI?: typeof import('../preload/index').ElectronAPI }).electronAPI;

export default function App() {
  const [lang, setLang] = useState<SupportedLanguage>(() => {
    return (localStorage.getItem('app_language') as SupportedLanguage) || 'en';
  });
  const [langMenuOpen, setLangMenuOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');

  const t = (key: string): string => {
    return TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || key;
  };

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLang(newLang);
    localStorage.setItem('app_language', newLang);
    setLangMenuOpen(false);
  };

  const formatEtaString = (seconds: number): string => {
    if (seconds <= 0) return t('eta.almostDone');
    if (seconds < 60) return `~${seconds} ${t('eta.secs')}`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `~${mins}m ${secs}s ${t('eta.minsSecs')}`;
  };

  // ===================== SENDER STATE =====================
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedIp, setSelectedIp] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [state, setState] = useState<TransferState>('IDLE');
  const [session, setSession] = useState<TransferSessionInfo | null>(null);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);
  const [urlCopied, setUrlCopied] = useState<boolean>(false);
  const [senderError, setSenderError] = useState<string | null>(null);

  // ===================== RECEIVER STATE =====================
  const [inputCode, setInputCode] = useState<string>('');
  const [discoveredSenders, setDiscoveredSenders] = useState<DiscoveredSender[]>([]);
  const [selectedSender, setSelectedSender] = useState<DiscoveredSender | null>(null);
  const [senderManifest, setSenderManifest] = useState<TransferManifest | null>(null);
  const [saveDirectory, setSaveDirectory] = useState<string>('');
  const [isResolvingCode, setIsResolvingCode] = useState<boolean>(false);
  const [receiverMode, setReceiverMode] = useState<'IDLE' | 'CONFIRM' | 'DOWNLOADING' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [receiverProgress, setReceiverProgress] = useState<ReceiverProgressUpdate | null>(null);
  const [receiverResult, setReceiverResult] = useState<ReceiverDownloadResult | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);

  // ===================== LIFECYCLE & EVENT LISTENERS =====================
  useEffect(() => {
    if (!electronAPI) return;

    // Load available network adapters
    electronAPI.getNetworkInterfaces().then((netList) => {
      setInterfaces(netList);
      const rec = netList.find((n) => n.isRecommended);
      if (rec) setSelectedIp(rec.address);
      else if (netList.length > 0) setSelectedIp(netList[0].address);
    });

    // Start background LAN discovery for receiver
    electronAPI.startDiscovery();

    // Sender listeners
    const unsubState = electronAPI.onTransferStateChange((e: StateChangeEvent) => {
      setState(e.currentState);
      if (e.currentState === 'FAILED' && e.reason) {
        setSenderError(e.reason);
      }
    });

    const unsubProgress = electronAPI.onTransferProgress((p: ProgressUpdate) => {
      setProgress(p);
    });

    const unsubCompleted = electronAPI.onTransferCompleted(() => {
      setState('COMPLETED');
    });

    // Receiver listeners
    const unsubDiscovered = electronAPI.onDiscoveredSenders((senders) => {
      setDiscoveredSenders(senders);
    });

    const unsubReceiverProgress = electronAPI.onReceiverProgress((p) => {
      setReceiverProgress(p);
    });

    const unsubReceiverCompleted = electronAPI.onReceiverCompleted((result) => {
      setReceiverResult(result);
      setReceiverMode('COMPLETED');
    });

    const unsubReceiverError = electronAPI.onReceiverError((err) => {
      setReceiverError(err.error);
      setReceiverMode('ERROR');
    });

    const unsubReceiverCancelled = electronAPI.onReceiverCancelled(() => {
      setReceiverMode('IDLE');
    });

    return () => {
      unsubState();
      unsubProgress();
      unsubCompleted();
      unsubDiscovered();
      unsubReceiverProgress();
      unsubReceiverCompleted();
      unsubReceiverError();
      unsubReceiverCancelled();
      electronAPI?.stopDiscovery();
    };
  }, []);

  // ===================== SENDER HANDLERS =====================
  const handleAddFiles = async () => {
    if (!electronAPI) return;
    const result = await electronAPI.openFileDialog();
    if (result.files.length > 0) {
      setSelectedFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const newFiles = result.files.filter((f) => !existing.has(f.path));
        return [...prev, ...newFiles];
      });
      if (state === 'IDLE') setState('FILES_SELECTED');
    }
  };

  const handleAddFolder = async () => {
    if (!electronAPI) return;
    const result = await electronAPI.openDirectoryDialog();
    if (result.files.length > 0) {
      setSelectedFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const newFiles = result.files.filter((f) => !existing.has(f.path));
        return [...prev, ...newFiles];
      });
      if (state === 'IDLE') setState('FILES_SELECTED');
    }
  };

  const handleRemoveFile = (pathToRemove: string) => {
    const updated = selectedFiles.filter((f) => f.path !== pathToRemove);
    setSelectedFiles(updated);
    if (updated.length === 0 && state === 'FILES_SELECTED') {
      setState('IDLE');
    }
  };

  const handleStartShare = async () => {
    if (!electronAPI || selectedFiles.length === 0) return;
    setSenderError(null);
    try {
      const filePaths = selectedFiles.map((f) => f.path);
      const sessionInfo = await electronAPI.startTransfer(filePaths, { selectedIp });
      setSession(sessionInfo);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSenderError(msg);
      setState('FAILED');
    }
  };

  const handleCancelShare = async () => {
    if (!electronAPI) return;
    await electronAPI.cancelTransfer();
    setState('IDLE');
    setSession(null);
    setProgress(null);
  };

  const handleResetSender = () => {
    setSelectedFiles([]);
    setSession(null);
    setProgress(null);
    setSenderError(null);
    setState('IDLE');
  };

  const handleCopyCode = () => {
    if (!session?.pairingCode) return;
    navigator.clipboard.writeText(session.pairingCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleCopyUrl = () => {
    if (!session?.shareUrl) return;
    navigator.clipboard.writeText(session.shareUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  // ===================== RECEIVER HANDLERS =====================
  const handleSelectDiscoveredSender = async (sender: DiscoveredSender) => {
    setSelectedSender(sender);
    setIsResolvingCode(true);
    setReceiverError(null);

    try {
      if (electronAPI) {
        const manifest = await electronAPI.fetchManifest(sender.ip, sender.port, sender.token);
        setSenderManifest(manifest);
        setReceiverMode('CONFIRM');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setReceiverError(msg);
      setReceiverMode('ERROR');
    } finally {
      setIsResolvingCode(false);
    }
  };

  const handleResolveCode = async () => {
    const cleanCode = inputCode.trim().toUpperCase();
    if (!cleanCode || !electronAPI) return;

    setIsResolvingCode(true);
    setReceiverError(null);

    try {
      // 1. Check if sender exists in discovered list
      const matched = discoveredSenders.find((s) => s.code.toUpperCase() === cleanCode);
      if (matched) {
        await handleSelectDiscoveredSender(matched);
        return;
      }

      // 2. Query main process resolve
      const resolved = await electronAPI.resolveCode(cleanCode);
      if (resolved) {
        await handleSelectDiscoveredSender(resolved);
        return;
      }

      throw new Error(`Cannot find sender with code "${cleanCode}". Please verify both devices are on the same LAN/Wi-Fi.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setReceiverError(msg);
      setReceiverMode('ERROR');
    } finally {
      setIsResolvingCode(false);
    }
  };

  const handleBrowseSaveDirectory = async () => {
    if (!electronAPI) return;
    const dir = await electronAPI.selectSaveDirectory();
    if (dir) {
      setSaveDirectory(dir);
    }
  };

  const handleStartDownload = async () => {
    if (!electronAPI || !selectedSender) return;

    let targetDir = saveDirectory;
    if (!targetDir) {
      // Prompt user to select directory
      const selected = await electronAPI.selectSaveDirectory();
      if (!selected) return; // User cancelled directory selection
      targetDir = selected;
      setSaveDirectory(selected);
    }

    setReceiverMode('DOWNLOADING');
    setReceiverProgress(null);
    setReceiverError(null);

    try {
      await electronAPI.startDownload(selectedSender, targetDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setReceiverError(msg);
      setReceiverMode('ERROR');
    }
  };

  const handleCancelDownload = async () => {
    if (!electronAPI) return;
    await electronAPI.cancelDownload();
    setReceiverMode('IDLE');
  };

  const handleOpenDownloadedFolder = async () => {
    if (!electronAPI || !receiverResult?.saveDirectory) return;
    await electronAPI.openFolder(receiverResult.saveDirectory);
  };

  const handleResetReceiver = () => {
    setInputCode('');
    setSelectedSender(null);
    setSenderManifest(null);
    setReceiverProgress(null);
    setReceiverResult(null);
    setReceiverError(null);
    setReceiverMode('IDLE');
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  const currentLang = LANGUAGE_OPTIONS.find((l) => l.code === lang) || LANGUAGE_OPTIONS[0];

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      {/* ================= HEADER & TOP NAVIGATION ================= */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-slate-900/90 border-b border-slate-800 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Share2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-tight leading-none">{t('app.title')}</h1>
            <p className="text-xs text-slate-400 mt-1">{t('app.subtitle')}</p>
          </div>
        </div>

        {/* MODE SWITCHER TABS */}
        <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700/60 shadow-inner">
          <button
            onClick={() => setActiveTab('send')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'send'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            {t('nav.send')}
          </button>
          <button
            onClick={() => setActiveTab('receive')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all relative ${
              activeTab === 'receive'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            {t('nav.receive')}
            {discoveredSenders.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse absolute -top-0.5 -right-0.5" />
            )}
          </button>
        </div>

        {/* RIGHT CONTROLS: IP & LANGUAGE SELECTOR */}
        <div className="flex items-center gap-3">
          {/* NETWORK IP PILL */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-slate-400 font-medium">{t('nav.ip')}:</span>
            <span className="text-cyan-300 font-mono font-semibold">{selectedIp || '127.0.0.1'}</span>
          </div>

          {/* LANGUAGE SELECTOR DROPDOWN */}
          <div className="relative">
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700/90 px-3 py-1.5 rounded-lg border border-slate-700/60 text-xs text-slate-200 transition"
              title="Change Language"
            >
              <span>{currentLang.flag}</span>
              <span className="font-medium">{currentLang.label}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {langMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-36 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.code}
                    onClick={() => handleLanguageChange(opt.code)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition ${
                      lang === opt.code
                        ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{opt.flag}</span>
                      <span>{opt.label}</span>
                    </span>
                    {lang === opt.code && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ================= MAIN CONTENT ================= */}
      <main
        className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center"
        onClick={() => { if (langMenuOpen) setLangMenuOpen(false); }}
      >
        {activeTab === 'send' ? (
          /* ======================================================== */
          /*                       SEND TAB                           */
          /* ======================================================== */
          <div className="w-full max-w-2xl flex flex-col h-full justify-between">
            {/* 1. IDLE & FILE SELECTION */}
            {(state === 'IDLE' || state === 'FILES_SELECTED') && (
              <div className="flex flex-col h-full justify-between gap-4">
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      const filesArray: SelectedFile[] = Array.from(e.dataTransfer.files).map((f) => ({
                        name: f.name,
                        path: (f as unknown as { path?: string }).path || f.name,
                        size: f.size
                      }));
                      setSelectedFiles((prev) => [...prev, ...filesArray]);
                      setState('FILES_SELECTED');
                    }
                  }}
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-200 cursor-pointer ${
                    isDraggingOver
                      ? 'border-cyan-400 bg-cyan-950/20 scale-[1.01]'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
                  } ${selectedFiles.length > 0 ? 'py-5' : 'flex-1'}`}
                >
                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 text-cyan-400">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-200">{t('send.dropzone.title')}</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {t('send.dropzone.desc')}
                  </p>

                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={handleAddFiles}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                    >
                      <FilePlus className="w-4 h-4 text-cyan-400" />
                      {t('send.btn.browseFiles')}
                    </button>
                    <button
                      onClick={handleAddFolder}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                    >
                      <FolderPlus className="w-4 h-4 text-blue-400" />
                      {t('send.btn.browseFolder')}
                    </button>
                  </div>
                </div>

                {/* File List */}
                {selectedFiles.length > 0 && (
                  <div className="flex-1 flex flex-col min-h-0 bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-300">{t('send.selected.title')}</span>
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20">
                          {selectedFiles.length} {t('send.selected.count')}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-400">
                        {t('send.selected.total')} <span className="text-slate-200 font-semibold">{formatBytes(totalBytes)}</span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                      {selectedFiles.map((file) => (
                        <div
                          key={file.path}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/40 text-xs transition"
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-3">
                            {getFileIcon(file.name)}
                            <div className="min-w-0">
                              <p className="font-medium text-slate-200 truncate">{file.name}</p>
                              <p className="text-[10px] text-slate-400">{formatBytes(file.size)}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveFile(file.path)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Remove file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Bottom Action */}
                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between mt-2">
                      <button
                        onClick={() => setSelectedFiles([])}
                        className="text-xs text-slate-400 hover:text-slate-200 underline"
                      >
                        {t('send.selected.clear')}
                      </button>
                      <button
                        onClick={handleStartShare}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition transform active:scale-95"
                      >
                        <Send className="w-4 h-4" />
                        {t('send.selected.start')} ({formatBytes(totalBytes)})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. WAITING FOR RECEIVER (SHOW 5-CHAR CODE & QR) */}
            {(state === 'WAITING_FOR_RECEIVER' || state === 'RECEIVER_CONNECTED' || state === 'RECEIVER_CONFIRMED') && session && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center animate-in fade-in zoom-in-95 duration-200">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-4">
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  {t('send.waiting.broadcasting')}
                </div>

                <h2 className="text-xl font-bold text-slate-100">{t('send.waiting.title')}</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  {t('send.waiting.desc')}
                </p>

                {/* PAIRING CODE CARD */}
                <div className="my-6 p-6 rounded-2xl bg-slate-800/80 border border-cyan-500/30 shadow-2xl flex flex-col items-center w-full max-w-sm">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    {t('send.waiting.codeLabel')}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-4xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-blue-400 font-mono">
                      {session.pairingCode}
                    </span>
                    <button
                      onClick={handleCopyCode}
                      className="p-2 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                      title={t('send.waiting.copyCode')}
                    >
                      {codeCopied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* QR CODE & DETAILS */}
                <div className="flex flex-col md:flex-row items-center gap-6 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
                  {session.qrCodeDataUrl && (
                    <div className="p-2 bg-white rounded-xl shadow-md">
                      <img src={session.qrCodeDataUrl} alt="Transfer QR Code" className="w-28 h-28" />
                    </div>
                  )}
                  <div className="text-left text-xs space-y-1.5">
                    <p className="text-slate-400">
                      {t('send.waiting.summary')} <span className="text-slate-200 font-semibold">{session.files.length} ({formatBytes(session.totalBytes)})</span>
                    </p>
                    <p className="text-slate-400">
                      {t('send.waiting.ipPort')} <span className="text-slate-200 font-mono">{session.ip}:{session.port}</span>
                    </p>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={handleCopyUrl}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition"
                      >
                        {urlCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {t('send.waiting.copyLink')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleCancelShare}
                    className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                  >
                    {t('send.btn.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* 3. SENDER TRANSFERRING STATE */}
            {state === 'TRANSFERRING' && progress && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400">
                  <Zap className="w-7 h-7 animate-pulse" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">{t('send.transferring.title')}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {t('send.transferring.streaming')} {progress.currentFileIndex} / {progress.totalFiles}: <span className="text-slate-200 font-semibold">{progress.currentFileName}</span>
                </p>

                {/* Progress Bar */}
                <div className="w-full max-w-md my-6 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{formatBytes(progress.totalBytesTransferred)} / {formatBytes(progress.totalBytes)}</span>
                    <span className="font-bold text-cyan-400">{progress.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 pt-1">
                    <span className="font-medium text-emerald-400">{formatSpeed(progress.speedBps)}</span>
                    <span>{formatEtaString(progress.etaSeconds)}</span>
                  </div>
                </div>

                <button
                  onClick={handleCancelShare}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-400 text-xs font-semibold border border-slate-700 transition"
                >
                  {t('send.btn.abort')}
                </button>
              </div>
            )}

            {/* 4. SENDER COMPLETED STATE */}
            {state === 'COMPLETED' && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center">
                <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 text-emerald-400">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">{t('send.completed.title')}</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {t('send.completed.desc')}
                </p>

                <button
                  onClick={handleResetSender}
                  className="mt-6 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition"
                >
                  {t('send.btn.sendMore')}
                </button>
              </div>
            )}

            {/* ERROR NOTIFICATION */}
            {senderError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs text-rose-300">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{senderError}</span>
                </div>
                <button onClick={() => setSenderError(null)} className="text-rose-400 hover:text-rose-200">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ======================================================== */
          /*                     RECEIVE TAB                          */
          /* ======================================================== */
          <div className="w-full max-w-2xl flex flex-col h-full justify-between">
            {/* 1. RECEIVER IDLE (CODE INPUT + DISCOVERED SENDERS) */}
            {receiverMode === 'IDLE' && (
              <div className="flex flex-col h-full justify-between gap-4">
                {/* Enter Pairing Code Card */}
                <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3 text-indigo-400">
                    <Download className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-100">{t('receive.code.title')}</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {t('receive.code.desc')}
                  </p>

                  <div className="flex items-center gap-3 mt-5 w-full max-w-xs">
                    <input
                      type="text"
                      maxLength={8}
                      placeholder={t('receive.code.placeholder')}
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleResolveCode(); }}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-center text-lg font-mono font-bold tracking-widest text-cyan-300 uppercase focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      onClick={handleResolveCode}
                      disabled={!inputCode.trim() || isResolvingCode}
                      className="px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5"
                    >
                      {isResolvingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      {t('receive.btn.connect')}
                    </button>
                  </div>
                </div>

                {/* Auto-Discovered LAN Devices */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-5 overflow-hidden">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-slate-200">{t('receive.discovered.title')}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{t('receive.discovered.badge')}</span>
                  </div>

                  {discoveredSenders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <Laptop className="w-10 h-10 text-slate-700 mb-2" />
                      <p className="text-xs text-slate-400">{t('receive.discovered.emptyTitle')}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{t('receive.discovered.emptyDesc')}</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {discoveredSenders.map((sender) => (
                        <div
                          key={`${sender.code}_${sender.ip}`}
                          className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 transition cursor-pointer group"
                          onClick={() => handleSelectDiscoveredSender(sender)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                              <Laptop className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold text-slate-200">{sender.senderName}</p>
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono text-[10px] font-bold border border-cyan-500/20">
                                  {sender.code}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                {sender.fileCount} {t('send.selected.count')} · {formatBytes(sender.totalBytes)} · {sender.ip}
                              </p>
                            </div>
                          </div>

                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 group-hover:bg-blue-500 text-white text-xs font-semibold transition">
                            <Download className="w-3.5 h-3.5" />
                            {t('receive.btn.receive')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. RECEIVER CONFIRM & CHOOSE DESTINATION FOLDER */}
            {receiverMode === 'CONFIRM' && senderManifest && (
              <div className="flex-1 flex flex-col justify-between bg-slate-900/60 border border-slate-800 rounded-3xl p-6">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div>
                      <h3 className="text-base font-bold text-slate-100">{t('receive.confirm.title')}</h3>
                      <p className="text-xs text-slate-400">
                        {t('receive.confirm.from')} <span className="text-slate-200 font-semibold">{senderManifest.senderName || 'LAN Device'}</span> ({senderManifest.fileCount} {t('send.selected.count')}, {formatBytes(senderManifest.totalBytes)})
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 font-mono text-xs font-bold border border-cyan-500/20">
                      {t('receive.confirm.code')} {senderManifest.pairingCode}
                    </span>
                  </div>

                  {/* Destination Folder Selector */}
                  <div className="my-4 p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-cyan-400" />
                      {t('receive.confirm.saveTo')}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-300 truncate">
                        {saveDirectory || t('receive.confirm.savePrompt')}
                      </div>
                      <button
                        onClick={handleBrowseSaveDirectory}
                        className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition"
                      >
                        {t('receive.confirm.btnChooseFolder')}
                      </button>
                    </div>
                  </div>

                  {/* Incoming Files Preview */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {senderManifest.files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-3">
                          {getFileIcon(f.name)}
                          <span className="text-slate-200 font-medium truncate">{f.name}</span>
                        </div>
                        <span className="text-slate-400 shrink-0">{formatBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => setReceiverMode('IDLE')}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    {t('receive.confirm.btnBack')}
                  </button>
                  <button
                    onClick={handleStartDownload}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition transform active:scale-95"
                  >
                    <Download className="w-4 h-4" />
                    {t('receive.confirm.btnDownloadAll')} ({formatBytes(senderManifest.totalBytes)})
                  </button>
                </div>
              </div>
            )}

            {/* 3. RECEIVER DOWNLOADING PROGRESS */}
            {receiverMode === 'DOWNLOADING' && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
                  <Download className="w-7 h-7 animate-bounce" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">{t('receive.downloading.title')}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {receiverProgress ? (
                    <>{t('receive.downloading.progress')} {receiverProgress.currentFileIndex} / {receiverProgress.totalFiles}: <span className="text-slate-200 font-semibold">{receiverProgress.currentFileName}</span></>
                  ) : (
                    t('receive.downloading.connecting')
                  )}
                </p>

                {/* Progress Bar */}
                {receiverProgress && (
                  <div className="w-full max-w-md my-6 space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>{formatBytes(receiverProgress.totalBytesDownloaded)} / {formatBytes(receiverProgress.totalBytes)}</span>
                      <span className="font-bold text-indigo-400">{receiverProgress.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${receiverProgress.percentage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400 pt-1">
                      <span className="font-medium text-emerald-400">{formatSpeed(receiverProgress.speedBps)}</span>
                      <span>{formatEtaString(receiverProgress.etaSeconds)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleCancelDownload}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-400 text-xs font-semibold border border-slate-700 transition"
                >
                  {t('receive.downloading.btnCancel')}
                </button>
              </div>
            )}

            {/* 4. RECEIVER COMPLETED STATE */}
            {receiverMode === 'COMPLETED' && receiverResult && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center">
                <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 text-emerald-400">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">{t('receive.completed.title')}</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {receiverResult.totalFiles} {t('receive.completed.desc')} ({formatBytes(receiverResult.totalBytes)})
                </p>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleOpenDownloadedFolder}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t('receive.completed.btnOpenFolder')}
                  </button>
                  <button
                    onClick={handleResetReceiver}
                    className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                  >
                    {t('receive.completed.btnReceiveMore')}
                  </button>
                </div>
              </div>
            )}

            {/* 5. RECEIVER ERROR STATE */}
            {receiverMode === 'ERROR' && (
              <div className="flex flex-col items-center justify-center flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">{t('receive.error.title')}</h2>
                <p className="text-xs text-rose-300 mt-1 max-w-md">
                  {receiverError || 'Unable to connect to sender.'}
                </p>

                <button
                  onClick={handleResetReceiver}
                  className="mt-6 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                >
                  {t('receive.error.btnRetry')}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
