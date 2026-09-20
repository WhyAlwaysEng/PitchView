'use strict';
// ===== ทดสอบ pop-out แบบ end-to-end กับ Electron จริง =====
// เปิดแอปจริง → โหลดลิงก์จอ 1 → กด ⧉ pop-out → ตรวจว่า:
//   1) webview ในหน้าต่างแยกโหลดสตรีมได้จริง (แก้บั๊ก webviewTag = จอดำ)
//   2) แถบปุ่มควบคุมทำงาน (กด 🔊 แล้ว UI เปลี่ยน)
//   3) ต้นทางในกริดหยุดเล่น (webview ถูกถอดออก + มี placeholder)
//   4) คลิก placeholder = ปิดหน้าต่างแยก + webview กลับเข้ากริด
// ใช้: node test/verify-popout.js   (จะเห็นหน้าต่างแอปเด้งขึ้นชั่วครู่)
'use strict';

const path = require('path');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('🚀 เปิดแอป Electron จริง...');
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: ROOT
  });

  try {
    const mainWin = await app.firstWindow();
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

    console.log('\n===== ผ่านทั้งหมด: pop-out ใช้งานได้ครบวงจร ✅ =====');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\n❌ VERIFY FAIL:', e.message);
  console.error('   (ถ้าเปิดแอปไม่ขึ้นเลย — ปิด PitchView ที่เปิดค้างอยู่ก่อน แล้วรันใหม่ เพราะแอปล็อก single-instance)');
  process.exit(1);
});
