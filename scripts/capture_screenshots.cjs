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

  // Wait 2s for fonts & icons to render
  await new Promise(r => setTimeout(r, 2000));

  fs.mkdirSync(path.join(__dirname, '../docs/images'), { recursive: true });

  // 1. Capture Send Screen (Default English)
  const imageSend = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_send.png'), imageSend.toPNG());
  console.log('Saved app_send.png');

  // 2. Switch to Receive Tab and capture
  await win.webContents.executeJavaScript(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const receiveBtn = buttons.find(b => b.textContent.includes('Receive') || b.textContent.includes('接收'));
      if (receiveBtn) receiveBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  const imageReceive = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_receive.png'), imageReceive.toPNG());
  console.log('Saved app_receive.png');

  // 3. Switch language to Traditional Chinese and capture
  await win.webContents.executeJavaScript(`
    (() => {
      localStorage.setItem('app_language', 'zh-TW');
      window.location.reload();
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  const imageChinese = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../docs/images/app_zh.png'), imageChinese.toPNG());
  console.log('Saved app_zh.png');

  // Reset language back to en
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('app_language');
  `);

  // Delete previous AI images
  try {
    if (fs.existsSync(path.join(__dirname, '../docs/images/app_banner.jpg'))) {
      fs.unlinkSync(path.join(__dirname, '../docs/images/app_banner.jpg'));
    }
    if (fs.existsSync(path.join(__dirname, '../docs/images/transfer_flow.jpg'))) {
      fs.unlinkSync(path.join(__dirname, '../docs/images/transfer_flow.jpg'));
    }
  } catch (e) {}

  win.close();
  app.quit();
}

app.whenReady().then(capture);
