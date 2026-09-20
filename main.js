const { app, BrowserWindow, session, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const os = require('os');

// UA หลักของแอป สร้างจากเวอร์ชัน Chromium จริงของ Electron ที่ใช้อยู่
// สำคัญ: ห้าม hardcode เลขเวอร์ชัน เพราะเว็บสตรีมเทียบ UA กับ Client Hint (sec-ch-ua)
// ถ้าไม่ตรงกันจะถูกมองเป็นบอทและเด้ง session ทิ้งระหว่างใช้งาน
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// ตั้ง fallback ไว้ก่อนแอปพร้อม เพื่อให้ทุก session ใช้ UA เดียวกันโดยดีฟอลต์
app.userAgentFallback = CHROME_UA;

// ปิด Log การแจ้งเตือนภายในที่ไม่จำเป็นของ Chromium
app.commandLine.appendSwitch('log-level', '3');
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

// Performance & GPU Hardware Acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-site-isolation-trials');

let mainWindow;

// กันเปิดโปรแกรมซ้ำ: ถ้าเปิดสองอินสแตนซ์พร้อมกัน Chromium จะล็อกโปรไฟล์
// ทำให้ Cookie/Session ไม่ถูกบันทึกลงดิสก์และหลุดการล็อกอินได้
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    icon: path.join(__dirname, 'assets/icon.ico'),
    backgroundColor: '#0a0a0f',
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false,
      plugins: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ส่งข้อมูลสถานะ CPU & RAM ไปยัง Renderer ทุก 1.5 วินาที
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const metrics = app.getAppMetrics();
      let totalAppCpu = 0;
      let totalAppMemoryKB = 0;

      metrics.forEach(proc => {
        totalAppCpu += proc.cpu.percentCPUUsage;
        totalAppMemoryKB += proc.memory.workingSetSize;
      });

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const sysRamPercent = Math.round((usedMem / totalMem) * 100);
      const appRamMB = Math.round(totalAppMemoryKB / 1024);

      mainWindow.webContents.send('system-stats', {
        cpuPercent: Math.round(totalAppCpu),
        appRamMB: appRamMB,
        sysRamPercent: sysRamPercent
      });
    }
  }, 1500);
}

// หน้าต่าง Login แยก (แชร์ Session/Cookie ร่วมกับทุกจอ)
ipcMain.on('open-login-window', (event, targetUrl) => {
  let url = targetUrl;
  if (!url || url === 'about:blank' || url === 'https://') {
    url = 'https://www.google.com';
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const loginWin = new BrowserWindow({
    width: 1000,
    height: 800,
    title: 'PitchView — เข้าสู่ระบบ (ล็อกอินเสร็จแล้วปิดหน้าต่างนี้)',
    icon: path.join(__dirname, 'assets/icon.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      partition: 'persist:dooball_session',
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  loginWin.loadURL(url).catch(err => console.error(err));

  loginWin.webContents.setWindowOpenHandler(() => {
    return { action: 'allow' };
  });

  loginWin.on('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('login-window-closed');
    }
  });
});

// สลับโหมดเต็มจอ
ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) {
    const isFull = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFull);
  }
});

// ===== Pin: ตรึงหน้าต่างไว้เหนือโปรแกรมอื่นเสมอ =====
ipcMain.on('set-main-pinned', (event, pinned) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(!!pinned, 'screen-saver');
  }
});

// ===== โหมดโปร่งใสหน้าต่าง =====
ipcMain.on('set-window-opacity', (event, value) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const v = Math.min(1, Math.max(0.3, Number(value) || 1));
    mainWindow.setOpacity(v);
  }
});

// ===== Pop-out: ดึงจอไหนก็ได้ออกไปเป็นหน้าต่างแยก (ลากไปมอนิเตอร์ที่ 2 ได้) =====
const popoutWins = {}; // streamId -> { win, pinned }

ipcMain.on('popout-stream', (event, payload) => {
  const { streamId, url, zoom, volume } = payload || {};
  if (!url) return;

  // ถ้ามีหน้าต่างของจอนี้ค้างอยู่แล้ว ให้ปิดตัวเก่าก่อน
  if (popoutWins[streamId] && !popoutWins[streamId].win.isDestroyed()) {
    popoutWins[streamId].win.close();
  }

  // เปิดหน้าต่างใหม่บนจอที่เคอร์เซอร์อยู่ (ถ้ามีหลายมอนิเตอร์ จะโผล่จอที่เมาส์ชี้)
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const width = 640;
  const height = 400;

  const win = new BrowserWindow({
    width: width,
    height: height,
    x: wa.x + Math.max(0, Math.floor(wa.width / 2) - Math.floor(width / 2)),
    y: wa.y + Math.max(0, Math.floor(wa.height / 2) - Math.floor(height / 2)),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'PitchView — Pop-out',
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      partition: 'persist:dooball_session',
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  popoutWins[streamId] = { win: win, pinned: false };

  // โหลดหน้าควบคุมของเรา (มีแถบปุ่มเสียง/รีเฟรช/ตรึง/ปิด) แล้วฝังสตรีมใน webview ข้างใน
  // แชร์ partition เดิม จึงใช้ login ร่วมกับทุกจอเหมือนเดิม
  const popoutUrl = 'file://' + path.join(__dirname, 'popout.html') +
    '?id=' + streamId +
    '&url=' + encodeURIComponent(url) +
    '&vol=' + (volume !== undefined ? volume : 100) +
    '&zoom=' + (zoom || 1);
  win.loadURL(popoutUrl).catch(err => console.error('popout load fail:', err));

  // Ctrl+P ยังสลับการตรึงได้เหมือนเดิม (มีปุ่มในหน้าต่างให้กดแล้ว ไม่ต้องจำคีย์ลัดก็ได้)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && (input.key === 'p' || input.key === 'P')) {
      e.preventDefault();
      togglePopoutPin(streamId);
    }
  });

  // เว็บในหน้าต่าง pop-out เปลี่ยนหน้าเอง → ส่ง URL กลับมาอัปเดตช่องของจอหลัก
  const syncPopoutUrl = () => {
    try {
      const current = win.webContents.getURL();
      if (current && current.startsWith('http') && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('popout-url-synced', { streamId: streamId, url: current });
      }
    } catch (err) {}
  };
  win.webContents.on('did-navigate', syncPopoutUrl);
  win.webContents.on('did-navigate-in-page', syncPopoutUrl);

  win.on('closed', () => {
    delete popoutWins[streamId];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout-closed', streamId);
    }
  });
});

ipcMain.on('close-popout', (event, streamId) => {
  const meta = popoutWins[streamId];
  if (meta && !meta.win.isDestroyed()) meta.win.close();
});

// pop-out เปลี่ยนหน้าเว็บเอง → ส่ง URL กลับไปอัปเดตช่องของจอหลัก
ipcMain.on('popout-url', (event, payload) => {
  if (!payload || !payload.url || !payload.url.startsWith('http')) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('popout-url-synced', payload);
  }
});

// สลับการตรึงหน้าต่าง pop-out (เรียกจากปุ่มในหน้าต่าง หรือ Ctrl+P)
function togglePopoutPin(streamId) {
  const meta = popoutWins[streamId];
  if (!meta || meta.win.isDestroyed()) return;
  meta.pinned = !meta.pinned;
  meta.win.setAlwaysOnTop(meta.pinned, 'screen-saver');
  meta.win.setTitle(meta.pinned ? '📌 PitchView — Pop-out (ตรึงอยู่)' : 'PitchView — Pop-out');
  meta.win.webContents.send('popout-state', streamId, { pinned: meta.pinned });
}

// ปุ่มควบคุมจากแถบเครื่องมือในหน้าต่าง pop-out (ลงทะเบียนครั้งเดียว ไม่สะสม listener)
ipcMain.on('popout-control', (event, streamId, action) => {
  const meta = popoutWins[streamId];
  if (!meta || meta.win.isDestroyed()) return;
  if (action === 'toggle-pin') {
    togglePopoutPin(streamId);
  }
});

app.whenReady().then(() => {
  if (!gotTheLock) return;

  const pitchSession = session.fromPartition('persist:dooball_session');

  // ★ แก้ปัญหาต้องล็อกอินใหม่บ่อย ๆ:
  // เดิมหน้าต่าง Login ใช้ UA ของ Electron แต่ webview ทุกจอใช้ UA Chrome ที่ hardcode ไว้
  // ทั้งสองฝั่งแชร์ cookie เดียวกัน (persist:dooball_session) แต่ส่ง UA คนละแบบ
  // เว็บสตรีม/Cloudflare จึงมองว่า session ไม่น่าเชื่อถือและเด้งออกจากระบบกลางคัน
  // วิธีแก้คือตั้ง UA ให้ครบทุก session ด้วยค่าเดียวกัน
  session.defaultSession.setUserAgent(CHROME_UA);
  pitchSession.setUserAgent(CHROME_UA);

  // ดักบล็อกโฆษณาและแทร็กเกอร์ (ต้อง apply ที่ session ของ webview ด้วย เดิม apply ผิดที่)
  const adFilter = {
    urls: [
      '*://*.doubleclick.net/*',
      '*://*.googlesyndication.com/*',
      '*://*.adservice.google.com/*'
    ]
  };
  [session.defaultSession, pitchSession].forEach((ses) => {
    ses.webRequest.onBeforeRequest(adFilter, (details, callback) => {
      callback({ cancel: true });
    });
  });

  createWindow();
  setupAutoUpdate();
});

// ===== Auto-Update ผ่าน GitHub Releases =====
// ทำงานเฉพาะตอนรันจากตัวติดตั้งที่แพ็กแล้ว — ตอน npm start จะข้ามอัตโนมัติ
// เช็คเวอร์ชันใหม่ตอนเปิดแอป ดาวน์โหลดเบื้องหลัง แล้วแจ้งในแอปให้กดติดตั้ง
function sendUpdateStatus(state, extra) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', Object.assign({ state }, extra || {}));
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (info) => sendUpdateStatus('downloading', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('none'));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus('progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('ready', { version: info.version }));
  autoUpdater.on('error', () => {
    // เงียบไว้ — เช่นยังไม่มี Release บน GitHub หรือเครื่องออฟไลน์ ไม่รบกวนผู้ใช้
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.on('install-update', () => {
  try { autoUpdater.quitAndInstall(false, true); } catch (e) { /* ignore */ }
});

// บล็อก Popup ไม่ให้เด้งในหน้าหลัก
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});