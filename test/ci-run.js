'use strict';
// ===== PitchView — รันชุดทดสอบ harness แบบ headless (CI + ใช้งานเองได้) =====
// เปิด test/harness.html (แอปจริง + stub) ใน Microsoft Edge ที่มากับ Windows อยู่แล้ว
// ไม่ต้องดาวน์โหลดเบราว์เซอร์เพิ่ม — ผ่านทุกชุด = exit 0 / มี fail = exit 1
// ใช้: npm test   (หรือ node test/ci-run.js)

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 18999;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

// เสิร์ฟโปรเจกต์ผ่าน localhost เพราะ iframe โหลด ../index.html (file:// ติด CORS)
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
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch (e) {
    console.error('❌ ยังไม่ได้ติดตั้ง playwright-core — รัน: npm install --save-dev playwright-core');
    process.exit(2);
  }

  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    console.error('❌ เปิด Microsoft Edge (headless) ไม่ได้: ' + String(e.message).split('\n')[0]);
    console.error('   Edge มากับ Windows อยู่แล้ว — ถ้าถอนติดตั้งไว้ ติดตั้งกลับก่อน หรือใช้ Chrome เปลี่ยน channel เป็น "chrome"');
    server.close();
    process.exit(2);
  }

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/test/harness.html`, { waitUntil: 'domcontentloaded' });

  // รอให้แอปใน iframe พร้อม (debug hook __pv คือจุดสุดท้ายของ app.js)
  // ฟังก์ชันทดสอบ T1–T11 อยู่ในหน้า harness (main frame) — เรียก/อ่านผลทางนั้นทั้งหมด
  await page.waitForFunction(
    () => {
      const f = document.getElementById('app-frame');
      return !!f && !!f.contentWindow && !!f.contentWindow.__pv;
    },
    null,
    { timeout: 20000 }
  );

  // [ชื่อฟังก์ชัน, out div, เป็น async ไหม] — เรียงตามหน้า harness
  const TESTS = [
    ['T1', 'out1', false],
    ['T1locked', 'out1', false],
    ['T2', 'out2', false],
    ['T3', 'out3', true], // มี timer chain ~200ms ต้องรอผล
    ['T4', 'out4', false],
    ['T5', 'out5', false],
    ['T6', 'out6', false],
    ['T7', 'out7', false],
    ['T8', 'out8', false],
    ['T9', 'out9', false],
    ['T10', 'out10', false],
    ['T11', 'out11', false]
  ];

  let totalPass = 0;
  let totalFail = 0;
  const failedTests = [];

  for (const [fn, outId, isAsync] of TESTS) {
    let text = '';
    try {
      await page.evaluate((name) => {
        window[name]();
      }, fn);
      if (isAsync) await sleep(1500); // รอ timer ของชุด async จบก่อนอ่านผล
      text = await page.evaluate((id) => document.getElementById(id).innerText, outId);
    } catch (e) {
      text = '❌ ERROR: ' + e.message;
    }

    const p = (text.match(/✅/g) || []).length;
    const f = (text.match(/❌/g) || []).length;
    totalPass += p;
    totalFail += f;
    if (f > 0) failedTests.push(fn);
    console.log(`${f > 0 ? '❌' : '✅'} ${fn.padEnd(9)} ${p} pass / ${f} fail`);
    if (f > 0) {
      console.log(
        text
          .split('\n')
          .filter((l) => l.includes('❌'))
          .map((l) => '      ' + l.trim())
          .join('\n')
      );
    }
  }

  await browser.close();
  server.close();

  console.log(`\n===== สรุป: ${totalPass} pass / ${totalFail} fail (จาก ${TESTS.length} ชุดทดสอบ) =====`);
  if (totalFail > 0) {
    console.error('❌ ชุดที่มีปัญหา: ' + failedTests.join(', '));
    process.exit(1);
  }
  console.log('✅ ทุกชุดผ่านหมด');
}

main().catch((e) => {
  console.error('❌ RUNNER ERROR:', e);
  process.exit(1);
});
