'use strict';
// ===== PitchView — จับภาพหน้าจอแอปเซฟลง docs/screenshots/ =====
// จำลองสถานะการใช้งานจริง (โหลดลิงก์ เปิดเสียง custom layout สมุดปุ่มลัด) แล้วจับภาพด้วย Edge headless
// ใช้: node test/capture-shots.js

const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 18998;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(ROOT, urlPath.replace(/^\/+/, ''));
      if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__pv, null, { timeout: 20000 });

  // โหลดลิงก์ตัวอย่างทั้ง 4 จอ (ผ่านช่อง input + Enter ตามเส้นทางผู้ใช้จริง)
  const urls = [
    'https://sport.example.com/live/trueinsport',
    'https://ball.example.com/stream/laliga',
    'https://score.example.com/watch/ucl-final',
    'https://foot.example.com/live/fa-cup'
  ];
  for (let i = 0; i < urls.length; i++) {
    await page.evaluate(({ n, u }) => {
      const el = document.getElementById('input-' + n);
      el.value = u;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }, { n: i + 1, u: urls[i] });
  }
  await sleep(500); // รอ LED ขึ้นเขียวครบทุกจอ

  // ---- ภาพที่ 1: หน้าจอหลัก 4 จอ (จอ 1 เปิดเสียง) ----
  await page.evaluate(() => toggleAudioByIndex(0));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'main-grid.png') });
  console.log('📷 main-grid.png');

  // ---- ภาพที่ 2: โหมดจัดเรียงเอง (จอใหญ่ซ้าย + 3 จอขวา) ----
  const diag = await page.evaluate(() => {
    changeLayout('layout-custom');
    const bg = window.__pv.get('boxGeometry');
    bg['1'] = { x: 0, y: 0, w: 62, h: 100 };
    bg['2'] = { x: 62, y: 0, w: 38, h: 34 };
    bg['3'] = { x: 62, y: 34, w: 38, h: 33 };
    bg['4'] = { x: 62, y: 67, w: 38, h: 33 };
    [1, 2, 3, 4].forEach((i) => applyGeometry(i));
    persistGeometry();
    return {
      mode: window.__pv.get('layoutMode'),
      cls: document.getElementById('grid-container').className,
      box1: document.getElementById('box-1').style.cssText,
      maximized: window.maximizedId === undefined ? 'n/a' : String(window.maximizedId)
    };
  });
  console.log('   diag:', JSON.stringify(diag));
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'custom-layout.png') });
  console.log('📷 custom-layout.png');

  // ---- ภาพที่ 3: สมุดปุ่มลัด (กด ?) ----
  await page.evaluate(() => toggleShortcutOverlay());
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'shortcuts.png') });
  console.log('📷 shortcuts.png');
  await page.evaluate(() => closeShortcutOverlay());

  await browser.close();
  server.close();

  fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).forEach((f) => {
    console.log('   ' + f + ' — ' + (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
  });
  console.log('✅ จับภาพครบแล้ว');
}

main().catch((e) => {
  console.error('❌ CAPTURE ERROR:', e);
  process.exit(1);
});
