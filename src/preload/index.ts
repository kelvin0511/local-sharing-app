import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  DiscoveredSender,
  NetworkInterfaceInfo,
  ProgressUpdate,
  ReceiverDownloadResult,
  ReceiverProgressUpdate,
  ServerConfig,
  TransferManifest,
  TransferSessionInfo
} from '../core/types';
import { StateChangeEvent } from '../core/state';

export interface SelectedFileInfo {
  name: string;
  path: string;
  size: number;
}

export interface ElectronAPI {
  // Sender APIs
  openFileDialog: () => Promise<{ filePaths: string[]; files: SelectedFileInfo[] }>;
  openDirectoryDialog: () => Promise<{ filePaths: string[]; files: SelectedFileInfo[] }>;
  getNetworkInterfaces: () => Promise<NetworkInterfaceInfo[]>;
  startTransfer: (filePaths: string[], config?: ServerConfig) => Promise<TransferSessionInfo>;
  cancelTransfer: () => Promise<void>;
  onTransferStateChange: (callback: (event: StateChangeEvent) => void) => () => void;
  onTransferProgress: (callback: (progress: ProgressUpdate) => void) => () => void;
  onTransferCompleted: (callback: (data: unknown) => void) => () => void;
  onReceiverJoined: (callback: (data: unknown) => void) => () => void;
  onReceiverConfirmed: (callback: (data: unknown) => void) => () => void;

  // Receiver APIs
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  resolveCode: (code: string) => Promise<DiscoveredSender | null>;
  selectSaveDirectory: () => Promise<string | null>;
  fetchManifest: (ip: string, port: number, token: string) => Promise<TransferManifest>;
  startDownload: (sender: DiscoveredSender, saveDirectory: string) => Promise<ReceiverDownloadResult>;
  cancelDownload: () => Promise<void>;
  openFolder: (folderPath: string) => Promise<boolean>;
  onDiscoveredSenders: (callback: (senders: DiscoveredSender[]) => void) => () => void;
  onReceiverProgress: (callback: (progress: ReceiverProgressUpdate) => void) => () => void;
  onReceiverCompleted: (callback: (result: ReceiverDownloadResult) => void) => () => void;
  onReceiverError: (callback: (err: { error: string }) => void) => () => void;
  onReceiverCancelled: (callback: () => void) => () => void;
}

const api: ElectronAPI = {
  // Sender
  openFileDialog: () => ipcRenderer.invoke('dialog:openFiles'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getNetworkInterfaces: () => ipcRenderer.invoke('network:getInterfaces'),
  startTransfer: (filePaths: string[], config?: ServerConfig) =>
    ipcRenderer.invoke('transfer:start', filePaths, config),
  cancelTransfer: () => ipcRenderer.invoke('transfer:cancel'),

  onTransferStateChange: (callback: (event: StateChangeEvent) => void) => {
    const handler = (_: IpcRendererEvent, event: StateChangeEvent) => callback(event);
    ipcRenderer.on('transfer:stateChange', handler);
    return () => ipcRenderer.removeListener('transfer:stateChange', handler);
  },

  onTransferProgress: (callback: (progress: ProgressUpdate) => void) => {
    const handler = (_: IpcRendererEvent, progress: ProgressUpdate) => callback(progress);
    ipcRenderer.on('transfer:progress', handler);
    return () => ipcRenderer.removeListener('transfer:progress', handler);
  },

  onTransferCompleted: (callback: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('transfer:completed', handler);
    return () => ipcRenderer.removeListener('transfer:completed', handler);
  },

  onReceiverJoined: (callback: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('transfer:receiverJoined', handler);
    return () => ipcRenderer.removeListener('transfer:receiverJoined', handler);
  },

  onReceiverConfirmed: (callback: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('transfer:receiverConfirmed', handler);
    return () => ipcRenderer.removeListener('transfer:receiverConfirmed', handler);
  },

  // Receiver
  startDiscovery: () => ipcRenderer.invoke('receiver:startDiscovery'),
  stopDiscovery: () => ipcRenderer.invoke('receiver:stopDiscovery'),
  resolveCode: (code: string) => ipcRenderer.invoke('receiver:resolveCode', code),
  selectSaveDirectory: () => ipcRenderer.invoke('receiver:selectSaveDirectory'),
  fetchManifest: (ip: string, port: number, token: string) =>
    ipcRenderer.invoke('receiver:fetchManifest', ip, port, token),
  startDownload: (sender: DiscoveredSender, saveDirectory: string) =>
    ipcRenderer.invoke('receiver:startDownload', sender, saveDirectory),
  cancelDownload: () => ipcRenderer.invoke('receiver:cancelDownload'),
  openFolder: (folderPath: string) => ipcRenderer.invoke('receiver:openFolder', folderPath),

  onDiscoveredSenders: (callback: (senders: DiscoveredSender[]) => void) => {
    const handler = (_: IpcRendererEvent, senders: DiscoveredSender[]) => callback(senders);
    ipcRenderer.on('receiver:discoveredSenders', handler);
    return () => ipcRenderer.removeListener('receiver:discoveredSenders', handler);
  },

  onReceiverProgress: (callback: (progress: ReceiverProgressUpdate) => void) => {
    const handler = (_: IpcRendererEvent, progress: ReceiverProgressUpdate) => callback(progress);
    ipcRenderer.on('receiver:progress', handler);
    return () => ipcRenderer.removeListener('receiver:progress', handler);
  },

  onReceiverCompleted: (callback: (result: ReceiverDownloadResult) => void) => {
    const handler = (_: IpcRendererEvent, result: ReceiverDownloadResult) => callback(result);
    ipcRenderer.on('receiver:completed', handler);
    return () => ipcRenderer.removeListener('receiver:completed', handler);
  },

  onReceiverError: (callback: (err: { error: string }) => void) => {
    const handler = (_: IpcRendererEvent, err: { error: string }) => callback(err);
    ipcRenderer.on('receiver:error', handler);
    return () => ipcRenderer.removeListener('receiver:error', handler);
  },

  onReceiverCancelled: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('receiver:cancelled', handler);
    return () => ipcRenderer.removeListener('receiver:cancelled', handler);
  }
};

contextBridge.exposeInMainWorld('electronAPI', api);
