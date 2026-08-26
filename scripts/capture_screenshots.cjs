const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

ipcMain.handle('network:getInterfaces', () => [
  { name: 'Wi-Fi', address: '192.168.1.108', family: 'IPv4', internal: false, isRecommended: true, mac: '00:11:22:33:44:55' }
]);
ipcMain.handle('receiver:startDiscovery', () => {});
ipcMain.handle('receiver:stopDiscovery', () => {});

async function capture() {
  const win = new BrowserWindow({
    width: 960,
    height: 740,
    show: true,
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, '../dist-electron/preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const distPath = path.join(__dirname, '../dist-renderer/index.html');
  await win.loadFile(distPath);

  // Ensure DOM is fully loaded and active
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => {
        if (document.querySelector('header') && document.querySelector('main button')) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  `);

  await new Promise(r => setTimeout(r, 2000));
  fs.mkdirSync(path.join(__dirname, '../docs/images'), { recursive: true });

  // 1. Capture Send Screen (Clean dropzone)
  const imageSend = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_send.png'), imageSend.toPNG());
  console.log('Saved app_send.png, size:', fs.statSync(path.join(__dirname, '../docs/images/app_send.png')).size);

  // 2. Switch to Receive Tab and inject discovered sender for realistic capture
  await win.webContents.executeJavaScript(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const receiveBtn = buttons.find(b => b.textContent.includes('Receive') || b.textContent.includes('接收'));
      if (receiveBtn) receiveBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));

  const imageReceive = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_receive.png'), imageReceive.toPNG());
  console.log('Saved app_receive.png, size:', fs.statSync(path.join(__dirname, '../docs/images/app_receive.png')).size);

  // 3. Switch language to Traditional Chinese and capture
  await win.webContents.executeJavaScript(`
    (() => {
      localStorage.setItem('app_language', 'zh-TW');
      window.location.reload();
    })()
  `);

  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => {
        if (document.querySelector('header') && document.querySelector('main button')) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  `);

  await new Promise(r => setTimeout(r, 2000));

  const imageChinese = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_zh.png'), imageChinese.toPNG());
  console.log('Saved app_zh.png, size:', fs.statSync(path.join(__dirname, '../docs/images/app_zh.png')).size);

  // Reset language back to en
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('app_language');
  `);

  win.close();
  app.quit();
}

app.whenReady().then(capture);
