import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { TransferManager } from './transferManager';
import { DiscoveredSender, ServerConfig } from '../core/types';

const transferManager = new TransferManager();
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    center: true,
    title: '局域網檔案快傳 (LAN File Transfer)',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  transferManager.setWindow(mainWindow);

  // Load Vite dev server in development or dist-renderer in production
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const distPath = path.join(__dirname, '../../dist-renderer/index.html');
    if (fs.existsSync(distPath)) {
      await mainWindow.loadFile(distPath);
    } else {
      // Fallback dev port
      await mainWindow.loadURL('http://localhost:5173');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===================== SENDER IPC HANDLERS =====================

ipcMain.handle('dialog:openFiles', async () => {
  if (!mainWindow) return { filePaths: [], files: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇要傳送的檔案',
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { filePaths: [], files: [] };
  }

  const files = await Promise.all(
    result.filePaths.map(async (fp) => {
      const stat = await fs.promises.stat(fp);
      return {
        name: path.basename(fp),
        path: fp,
        size: stat.size
      };
    })
  );

  return { filePaths: result.filePaths, files };
});

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return { filePaths: [], files: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇要傳送的資料夾',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { filePaths: [], files: [] };
  }

  const dirPath = result.filePaths[0];
  const filePaths: string[] = [];

  async function scan(currentDir: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(full);
      } else if (entry.isFile()) {
        filePaths.push(full);
      }
    }
  }

  await scan(dirPath);

  const files = await Promise.all(
    filePaths.map(async (fp) => {
      const stat = await fs.promises.stat(fp);
      return {
        name: path.basename(fp),
        path: fp,
        size: stat.size
      };
    })
  );

  return { filePaths, files };
});

ipcMain.handle('files:resolveDroppedPaths', async (_, rawPaths: string[]) => {
  const resultFiles: { name: string; path: string; size: number }[] = [];
  const scannedPaths = new Set<string>();

  async function processPath(p: string) {
    if (!fs.existsSync(p) || scannedPaths.has(p)) return;
    scannedPaths.add(p);

    const stat = await fs.promises.stat(p);
    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(p, { withFileTypes: true });
      for (const entry of entries) {
        await processPath(path.join(p, entry.name));
      }
    } else if (stat.isFile()) {
      resultFiles.push({
        name: path.basename(p),
        path: p,
        size: stat.size
      });
    }
  }

  for (const p of rawPaths) {
    if (typeof p === 'string' && p.trim()) {
      await processPath(p);
    }
  }

  return resultFiles;
});

ipcMain.handle('network:getInterfaces', () => {
  return transferManager.getNetworkInterfaces();
});

ipcMain.handle('transfer:start', async (_, filePaths: string[], config?: ServerConfig) => {
  return transferManager.startTransfer(filePaths, config);
});

ipcMain.handle('transfer:cancel', async () => {
  return transferManager.cancelTransfer();
});

// ===================== RECEIVER IPC HANDLERS =====================

ipcMain.handle('receiver:startDiscovery', async () => {
  return transferManager.startDiscovery();
});

ipcMain.handle('receiver:stopDiscovery', async () => {
  return transferManager.stopDiscovery();
});

ipcMain.handle('receiver:resolveCode', async (_, code: string) => {
  return transferManager.resolveCode(code);
});

ipcMain.handle('receiver:selectSaveDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇接收檔案的儲存資料夾',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('receiver:fetchManifest', async (_, ip: string, port: number, token: string) => {
  return transferManager.fetchSenderManifest(ip, port, token);
});

ipcMain.handle('receiver:startDownload', async (_, sender: DiscoveredSender, saveDirectory: string) => {
  return transferManager.startDownload(sender, saveDirectory);
});

ipcMain.handle('receiver:cancelDownload', async () => {
  return transferManager.cancelDownload();
});

ipcMain.handle('receiver:openFolder', async (_, folderPath: string) => {
  if (folderPath && fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

// ===================== APP LIFECYCLE =====================

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await transferManager.cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('SIGINT', async () => {
  await transferManager.cleanup();
  process.exit(0);
});
