'use strict';
// ===== ทดสอบ pop-out แบบ end-to-end กับ Electron จริง =====
// เปิดแอปจริง → โหลดลิงก์จอ 1 → กด ⧉ pop-out → ตรวจว่า:
//   1) webview ในหน้าต่างแยกโหลดสตรีมได้จริง (แก้บั๊ก webviewTag = จอดำ)
//   2) แถบปุ่มควบคุมทำงาน (กด 🔊 แล้ว UI เปลี่ยน)
//   3) ต้นทางในกริดหยุดเล่น (webview ถูกถอดออก + มี placeholder)
//   4) คลิก placeholder = ปิดหน้าต่างแยก + webview กลับเข้ากริด
// ใช้: node test/verify-popout.js   (จะเห็นหน้าต่างแอปเด้งขึ้นชั่วครู่)
'use strict';

const http = require('http');
const path = require('path');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // เซิร์ฟเวอร์จำลองในเครื่อง — ทดสอบ watchdog หน้า login + หน้าวิดีโอ (ทดสอบ Advance) + หน้าเดิน nav
  const page = (t) => `<html><body>${t}</body></html>`;
  const simServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/video')) res.end(page('<video id="v" style="width:320px"></video>'));
    else if (req.url.startsWith('/p1')) res.end(page('page one'));
    else if (req.url.startsWith('/p2')) res.end(page('page two'));
    else res.end(page('login page test'));
  });
  await new Promise((r) => simServer.listen(18901, '127.0.0.1', r));

  console.log('🚀 เปิดแอป Electron จริง...');
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: ROOT
  });

  try {
    const mainWin = await app.firstWindow();
    await mainWin.waitForFunction(() => !!window.__pv, null, { timeout: 30000 });

    // รีเซ็ตค่าปรับจอ 1 ให้เป็นค่าเริ่มต้นก่อนทดสอบ (localStorage ค้างจากรอบรันก่อนทำค่าเพี้ยน)
    await mainWin.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem('saved_streams') || '[]');
      const s = arr.find((x) => x.id === 1);
      if (s) { s.zoom = 1.0; s.brightness = 100; s.saturation = 100; s.freezeDetect = true; s.volume = 100; }
      localStorage.setItem('saved_streams', JSON.stringify(arr));
    });
    await mainWin.reload();
    await mainWin.waitForFunction(() => !!window.__pv, null, { timeout: 30000 });
    console.log('✅ หน้าหลักพร้อม');

    // โหลดลิงก์ตัวอย่างจอ 1 ผ่านช่อง input + Enter
    await mainWin.evaluate(() => {
      const el = document.getElementById('input-1');
      el.value = 'https://sport.example.com/live/test';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    await mainWin.waitForFunction(
      () => {
        const wv = document.getElementById('wv-1');
        try { return wv && wv.getURL() && wv.getURL().includes('sport.example.com'); } catch (e) { return false; }
      },
      null,
      { timeout: 20000 }
    );
    console.log('✅ จอ 1 โหลดสตรีมในกริดได้');

    // ★ ทดสอบ session แยกต่อจอ (แก้เด้ง login กลางแข่ง)
    const p1 = await mainWin.evaluate(() => document.getElementById('wv-1').getAttribute('partition'));
    if (p1 !== 'persist:dooball_1') throw new Error('จอ 1 ใช้ session ผิด: ' + p1);
    console.log('✅ จอ 1 ใช้ session ของตัวเอง (' + p1 + ')');

    await mainWin.evaluate(() => {
      const el = document.getElementById('input-2');
      el.value = 'https://sport.example.com/live/test2';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    await mainWin.waitForFunction(
      () => {
        const wv = document.getElementById('wv-2');
        try { return wv && wv.getURL() && wv.getURL().includes('sport.example.com'); } catch (e) { return false; }
      },
      null,
      { timeout: 20000 }
    );
    const p2 = await mainWin.evaluate(() => document.getElementById('wv-2').getAttribute('partition'));
    if (p2 !== 'persist:dooball_2') throw new Error('จอ 2 ใช้ session ผิด: ' + p2);
    const wcid = await mainWin.evaluate(() => {
      try { return { a: document.getElementById('wv-1').getWebContentsId(), b: document.getElementById('wv-2').getWebContentsId() }; }
      catch (e) { return { a: null, b: null }; }
    });
    if (wcid.a && wcid.b && wcid.a === wcid.b) throw new Error('จอ 1-2 อยู่เว็บคอนเทนต์เดียวกัน (session ไม่ได้แยกจริง)');
    console.log('✅ จอ 2 ใช้ session แยกขาด (' + p2 + ' — คนละเว็บคอนเทนต์กับจอ 1)');

    // กดปุ่ม pop-out
    await mainWin.click('#popout-btn-1');
    const popWin = await app.waitForEvent('window', { timeout: 15000 });
    await popWin.waitForLoadState('domcontentloaded');
    console.log('✅ หน้าต่างแยกเปิดแล้ว:', popWin.url().includes('popout.html') ? 'popout.html' : popWin.url());
    popWin.on('console', (msg) => { if (msg.type() === 'error') console.log('   [popout console.error]', msg.text()); });
    popWin.on('pageerror', (err) => console.log('   [popout pageerror]', String(err).split('\n')[0]));
    await sleep(800);
    await popWin.evaluate(() => {
      const wv = document.getElementById('wv');
      window.__diag = { fail: null, start: false };
      wv.addEventListener('did-fail-load', (e) => { window.__diag.fail = e.errorCode + ':' + e.errorDescription + ':' + e.validatedURL; });
      wv.addEventListener('did-start-loading', () => { window.__diag.start = true; });
    });
    await sleep(2500);
    const diag = await popWin.evaluate(() => {
      const wv = document.getElementById('wv');
      return {
        hasWv: !!wv,
        tag: wv ? wv.tagName : null,
        typeGetURL: wv ? typeof wv.getURL : 'n/a',
        url: wv && typeof wv.getURL === 'function' ? wv.getURL() : (wv ? wv.getAttribute('src') : null),
        scriptRan: typeof window.toggleMute === 'function',
        href: location.href.replace(/^file:\/\//, '').slice(-80),
        paramUrl: new URLSearchParams(location.search).get('url'),
        attrSrc: wv ? wv.getAttribute('src') : null,
        events: window.__diag || null
      };
    });
    console.log('   diag:', JSON.stringify(diag, null, 1));

    // ★ pop-out ต้องใช้ session เดียวกับจอต้นทาง (login/cookie ติดตามไปเอง)
    const popPart = await popWin.evaluate(() => document.getElementById('wv').getAttribute('partition'));
    if (popPart !== 'persist:dooball_1') throw new Error('หน้าต่างแยกใช้ session ผิด: ' + popPart + ' (ต้องเป็นของจอ 1)');
    console.log('✅ หน้าต่างแยกใช้ session เดียวกับจอต้นทาง (' + popPart + ')');

    // 1) webview ในหน้าต่างแยกต้องมีชีวิต (มี method ของ webview จริง) และโหลด URL ถูก
    await popWin.waitForFunction(
      () => {
        const wv = document.getElementById('wv');
        try { return !!wv && typeof wv.getURL === 'function' && wv.getURL().includes('sport.example.com'); } catch (e) { return false; }
      },
      null,
      { timeout: 20000 }
    );
    console.log('✅ webview ในหน้าต่างแยกโหลดสตรีมได้จริง (ไม่จอดำแล้ว)');

    // 2) แถบปุ่มควบคุมทำงาน: กด 🔊 แล้วปุ่มต้องเปลี่ยนเป็น 🔇
    await popWin.click('#mute-btn');
    const muteText = await popWin.evaluate(() => document.getElementById('mute-btn').innerText);
    if (muteText !== '🔇') throw new Error('ปุ่มเสียงไม่ทำงาน (ได้: ' + muteText + ')');
    console.log('✅ ปุ่มควบคุมในหน้าต่างแยกทำงาน (🔇/🔊 สลับได้)');

    // 3) ต้นทางในกริดต้องหยุด: webview ถูกถอดออก + มี placeholder
    const gridState = await mainWin.evaluate(() => ({
      detached: !document.getElementById('wv-1'),
      placeholder: !!document.getElementById('popout-ph-1')
    }));
    if (!gridState.detached || !gridState.placeholder) {
      throw new Error('ต้นทางยังเล่นอยู่: ' + JSON.stringify(gridState));
    }
    console.log('✅ ต้นทางในกริดหยุดแล้ว (webview ถอดออก + placeholder แสดง)');

    // 3.5) ★ ปุ่มใหม่ในหน้าต่างแยก — ต้องครบเท่าหน้าปกติ
    const pw = () => popWin.evaluate(() => document.getElementById('wv'));

    // ⚡ Advance: โหลดหน้าจำลองที่มี video กดปุ่มจริง แล้วเช็คในเว็บว่าวิดีโอถูกดึงเต็มกรอบ
    await popWin.evaluate(() => document.getElementById('wv').loadURL('http://127.0.0.1:18901/video'));
    await popWin.waitForFunction(() => {
      const wv = document.getElementById('wv');
      try { return wv.getURL().includes('/video'); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    await sleep(600);
    await popWin.click('.btn-advance');
    await sleep(1600);
    const adv = await popWin.evaluate(() =>
      document.getElementById('wv').executeJavaScript('(() => { const v = document.querySelector("video"); return v ? { pos: v.style.position, overflow: document.body.style.overflow } : null; })()')
    );
    if (!adv || adv.pos !== 'fixed' || adv.overflow !== 'hidden') throw new Error('Advance ในหน้าต่างแยกไม่ทำงาน: ' + JSON.stringify(adv));
    console.log('✅ ปุ่ม ⚡ Advance ในหน้าต่างแยกดึงวิดีโอเต็มกรอบได้จริง');

    // ◀▶ เดินประวัติ: โหลด 2 หน้า ย้อนกลับ/ไปหน้าถัดไปผ่านปุ่มจริง
    await popWin.evaluate(() => document.getElementById('wv').loadURL('http://127.0.0.1:18901/p1'));
    await popWin.waitForFunction(() => {
      const wv = document.getElementById('wv');
      try { return wv.getURL().includes('/p1'); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    await popWin.evaluate(() => document.getElementById('wv').loadURL('http://127.0.0.1:18901/p2'));
    await popWin.waitForFunction(() => {
      const wv = document.getElementById('wv');
      try { return wv.getURL().includes('/p2') && wv.canGoBack(); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    await popWin.click('#back-btn');
    await popWin.waitForFunction(() => {
      const wv = document.getElementById('wv');
      try { return wv.getURL().includes('/p1'); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    await popWin.click('#fwd-btn');
    await popWin.waitForFunction(() => {
      const wv = document.getElementById('wv');
      try { return wv.getURL().includes('/p2'); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    console.log('✅ ปุ่ม ◀▶ เดินประวัติหน้าในหน้าต่างแยกได้');

    // ซูม/ความสว่าง/โทน/Guard: กดปุ่มจริงแล้วเช็ค UI + ค่าซิงก์กลับจอในกริด
    await popWin.evaluate(() => document.querySelectorAll('.zoom-control button')[1].click());
    const ztxt = await popWin.evaluate(() => document.getElementById('zoom-txt').innerText);
    if (ztxt !== '110%') throw new Error('ซูมไม่ทำงาน: ' + ztxt);
    await mainWin.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('saved_streams')).find(s => s.id === 1).zoom === 1.1; }
      catch (e) { return false; }
    }, null, { timeout: 8000 });
    console.log('✅ ปุ่ม ซูม + ทำงาน และค่าซิงก์กลับจอในกริด (บันทึก 110% แล้ว)');

    await popWin.evaluate(() => document.getElementById('bright-btn').click());
    const filter1 = await popWin.evaluate(() => document.getElementById('wv').style.filter);
    if (!filter1.includes('brightness(110%)')) throw new Error('ความสว่างไม่ทำงาน: ' + filter1);
    await popWin.evaluate(() => document.getElementById('sat-btn').click());
    const filter2 = await popWin.evaluate(() => ({
      f: document.getElementById('wv').style.filter,
      active: document.getElementById('sat-btn').classList.contains('active')
    }));
    if (!filter2.f.includes('saturate(60%)') || !filter2.active) throw new Error('โทนนุ่มตาไม่ทำงาน: ' + JSON.stringify(filter2));
    console.log('✅ ปุ่ม ☀ ความสว่าง และ ◐ โทนนุ่มตา ทำงาน (filter ใช้จริงกับ webview)');

    await popWin.evaluate(() => document.getElementById('guard-btn').click());
    const gtxt = await popWin.evaluate(() => document.getElementById('guard-btn').innerText);
    if (gtxt !== '🛡️ Off') throw new Error('ปุ่ม Guard ไม่สลับ: ' + gtxt);
    await mainWin.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('saved_streams')).find(s => s.id === 1).freezeDetect === false; }
      catch (e) { return false; }
    }, null, { timeout: 8000 });
    console.log('✅ ปุ่ม 🛡️ Guard สลับได้ และสถานะซิงก์กลับจอในกริด');

    // 4) คลิก placeholder = ปิดหน้าต่างแยก + webview กลับเข้ากริด
    await mainWin.click('#popout-ph-1');
    await mainWin.waitForFunction(
      () => !!document.getElementById('wv-1') && !document.getElementById('popout-ph-1'),
      null,
      { timeout: 15000 }
    );
    await sleep(500); // รอหน้าต่างปิดจริง
    const wins = app.windows().filter((w) => w.url().includes('popout.html'));
    if (wins.length > 0) throw new Error('หน้าต่างแยกยังไม่ปิด');
    console.log('✅ คลิก placeholder ดึงจอกลับกริดได้ (webview กลับมา + หน้าต่างแยกปิดแล้ว)');

    // ★ ค่าที่ปรับในหน้าต่างแยกต้องตามกลับมาที่กริด (zoom 110% จากการทดสอบข้างบน)
    await sleep(600);
    const restored = await mainWin.evaluate(() => {
      const wv = document.getElementById('wv-1');
      return {
        zoom: (typeof wv.getZoomFactor === 'function') ? wv.getZoomFactor() : null,
        label: (document.getElementById('zoom-txt-1') || {}).innerText || null,
        guard: (document.getElementById('freeze-btn-1') || {}).innerText || null
      };
    });
    if (Math.abs((restored.zoom || 0) - 1.1) > 0.01) throw new Error('ซูมไม่ตามกลับกริด: ' + JSON.stringify(restored));
    if (restored.label !== '110%') throw new Error('ป้าย % ไม่อัปเดต: ' + restored.label);
    if (restored.guard !== '🛡️ Off') throw new Error('สถานะ Guard ไม่ตามกลับ: ' + restored.guard);
    console.log('✅ ค่าที่ปรับในหน้าต่างแยกตามกลับจอกริดครบ (zoom 110% + ป้าย + Guard Off)');

    // 5) ★ watchdog ห้ามรีโหลดหน้า login (อาการ "เข้าแข่งอยู่เด้ง login ใหม่" อีกจุด)
    await mainWin.evaluate(() => {
      const el = document.getElementById('input-1');
      el.value = 'http://127.0.0.1:18901/login';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    await mainWin.waitForFunction(
      () => {
        const wv = document.getElementById('wv-1');
        try { return wv && typeof wv.getURL === 'function' && wv.getURL().includes('/login'); } catch (e) { return false; }
      },
      null,
      { timeout: 20000 }
    );
    await mainWin.evaluate(() => {
      window.__navCount = 0;
      document.getElementById('wv-1').addEventListener('did-navigate', () => { window.__navCount++; });
    });
    await sleep(9000);
    const wd = await mainWin.evaluate(() => ({
      nav: window.__navCount,
      alive: !!document.getElementById('wv-1'),
      url: (() => { try { return document.getElementById('wv-1').getURL(); } catch (e) { return null; } })()
    }));
    if (!wd.alive || wd.nav > 0) throw new Error('watchdog รีโหลดหน้า login! ' + JSON.stringify(wd));
    console.log('✅ watchdog เฝ้าดู 9 วิ — ไม่รีโหลดหน้า login เด็ดขาด (url คงเดิม: ' + wd.url + ')');

    console.log('\n===== ผ่านทั้งหมด: pop-out ใช้งานได้ครบวงจร ✅ =====');
  } finally {
    try { await app.close(); } catch (e) {}
    try { simServer.close(); } catch (e) {}
  }
}

main().catch((e) => {
  console.error('\n❌ VERIFY FAIL:', e.message);
  console.error('   (ถ้าเปิดแอปไม่ขึ้นเลย — ปิด PitchView ที่เปิดค้างอยู่ก่อน แล้วรันใหม่ เพราะแอปล็อก single-instance)');
  process.exit(1);
});
