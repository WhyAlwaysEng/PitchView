// ===== PitchView — สคริปต์ที่ inject เข้าไปในเว็บของแต่ละจอ =====
// ใช้ร่วมกันทั้งหน้าหลัก (app.js) และหน้าต่าง pop-out (popout.html)
// เพื่อให้ทั้งสองหน้าได้พฤติกรรมเดียวกันเป๊ะ ๆ (Advance / Guard / กันพลาดหน้า login)
'use strict';

// หน้า login/register/blank = ห้ามแตะวิดีโอ ห้าม reload เด็ดขาด (กันเด้ง login กลางแข่ง)
const PV_LOGIN_RE = /(\/\/|\b)(log-?in|log-in|signin|sign-in|register|signup|sign-up)(\b|-|_|.)/i;

function pvIsLoginPage() {
  return PV_LOGIN_RE.test(location.href) || location.href === 'about:blank';
}

// ⚡ Advance: ดึงกล่องวิดีโอ/iframe หลักขยายเต็มกรอบ + เปิดเสียงเล่นอัตโนมัติ
// wv = element <webview> ของจอนั้น (ผู้เรียกต้องส่งมา)
function pvAdvance(wv) {
  const script = `
    (function() {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const video = document.querySelector('video');
        const iframe = document.querySelector('iframe[src*="player"]') ||
                       document.querySelector('iframe[src*="embed"]') ||
                       document.querySelector('iframe[src*="stream"]') ||
                       document.querySelector('iframe');
        const videoContainer = document.querySelector('[class*="video"]') ||
                               document.querySelector('[class*="player"]') ||
                               document.querySelector('video');
        const target = iframe || video || videoContainer;

        if (video) {
          video.muted = false;
          video.play().catch(() => {});
        }

        if (target) {
          clearInterval(interval);
          if (target.tagName === 'VIDEO') {
            target.muted = false;
            target.volume = 1.0;
            target.play().catch(() => {});
          }
          target.style.position = 'fixed';
          target.style.top = '0';
          target.style.left = '0';
          target.style.width = '100vw';
          target.style.height = '100vh';
          target.style.zIndex = '999999999';
          target.style.background = '#000';
          document.body.style.overflow = 'hidden';
        }
        if (attempts >= 20) clearInterval(interval);
      }, 500);
    })();
  `;
  try { wv.executeJavaScript(script).catch(() => {}); } catch (e) {}
}

// 🛡️ Guard: จำลองการขยับเมาส์กัน inactivity timeout + ตรวจจับภาพค้างแล้วดีดต่อ
// wv = element <webview> / isEnabled = สถานะปุ่ม 🛡️ ของจอนั้น
function pvInjectWatchdog(wv, isEnabled) {
  const script = `
    (function() {
      if (window.__footballEngineActive) return;
      window.__footballEngineActive = true;

      // ป้องกัน Inactivity Timeout โดยจำลองการขยับเมาส์เบาๆ ทุก 10 วินาที
      setInterval(() => {
        window.dispatchEvent(new Event('focus'));
        document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
      }, 10000);

      // Auto-Resume เมื่อวิดีโอหยุดเล่นเอง
      let lastTime = -1;
      let freezeCount = 0;

      setInterval(() => {
        const isEnabled = ${isEnabled !== false};
        const video = document.querySelector('video');

        // ถ้าหน้านี้ยังไม่ใช่หน้าดูบอล (login/register/about:blank) ห้ามแตะ video และห้าม reload เด็ดขาด
        if (${PV_LOGIN_RE.toString()}.test(location.href) || location.href === 'about:blank') {
          lastTime = -1; freezeCount = 0;
        } else if (video) {
          if (video.paused && !video.ended) {
            video.play().catch(() => {});
          }

          if (isEnabled && !video.paused && video.readyState >= 2) {
            if (video.currentTime === lastTime && video.currentTime > 0) {
              freezeCount++;
              if (freezeCount >= 8) {
                video.currentTime += 0.5;
                video.play().catch(() => {});
              }
              if (freezeCount >= 22) {
                location.reload();
              }
            } else {
              freezeCount = 0;
              lastTime = video.currentTime;
            }
          }
        }
      }, 1000);
    })();
  `;
  try { wv.executeJavaScript(script).catch(() => {}); } catch (e) {}
}

// Export สำหรับทั้ง nodeIntegration (require) และเบราว์เซอร์/stub (window.PV)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pvAdvance, pvInjectWatchdog, pvIsLoginPage };
}
if (typeof window !== 'undefined') {
  window.PV = Object.assign(window.PV || {}, { pvAdvance, pvInjectWatchdog, pvIsLoginPage });
}
