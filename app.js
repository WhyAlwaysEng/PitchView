    const { ipcRenderer } = require('electron');

    let streams = JSON.parse(localStorage.getItem('saved_streams')) || [
      { id: 1, name: '', url: '', volume: 100, zoom: 1.0, freezeDetect: true, headerHidden: false, session: 'persist:dooball_1' },
      { id: 2, name: '', url: '', volume: 100, zoom: 1.0, freezeDetect: true, headerHidden: false, session: 'persist:dooball_2' },
      { id: 3, name: '', url: '', volume: 100, zoom: 1.0, freezeDetect: true, headerHidden: false, session: 'persist:dooball_3' },
      { id: 4, name: '', url: '', volume: 100, zoom: 1.0, freezeDetect: true, headerHidden: false, session: 'persist:dooball_4' }
    ];
    // อัปเกรดข้อมูลเก่า: จอที่ยังไม่มี session ของตัวเอง ให้ตามเลขจอ (login ครั้งเดียวจะคัดลอก cookie ให้ทุกจอเอง)
    streams.forEach(s => { if (!s.session || !/^persist:dooball_[0-9]+$/.test(s.session)) s.session = 'persist:dooball_' + s.id; });
    let nextId = streams.length ? Math.max(...streams.map(s => s.id)) + 1 : 1;
    let activeAudioId = null;
    let maximizedId = null;
    let contextTargetId = null;
    let allHeadersHidden = false;
    let isToolbarHidden = false;

    // ===== Custom Free-Layout State =====
    let layoutMode = localStorage.getItem('saved_layout_mode') || 'grid'; // 'grid' | 'custom'
    let currentGridClass = localStorage.getItem('saved_layout_class') || 'layout-4';
    let boxGeometry = JSON.parse(localStorage.getItem('saved_custom_geometry') || '{}');
    if (!boxGeometry || typeof boxGeometry !== 'object' || Array.isArray(boxGeometry)) boxGeometry = {};
    let customLayouts = JSON.parse(localStorage.getItem('saved_custom_layouts') || '[]');
    if (!Array.isArray(customLayouts)) customLayouts = [];

    // Staggered Auto-Cycle State
    let cycleIntervalMinutes = 0;
    let cycleTimer = null;
    let cycleCurrentIndex = 0;

    const savedLoginUrl = localStorage.getItem('saved_login_url') || '';
    if (savedLoginUrl) {
      document.getElementById('login-url-input').value = savedLoginUrl;
    }

    // 1. รับข้อมูล Real-Time CPU & RAM จาก Main Process
    ipcRenderer.on('system-stats', (event, data) => {
      const cpuEl = document.getElementById('cpu-stat');
      const ramEl = document.getElementById('ram-stat');
      if (cpuEl) cpuEl.innerText = `${data.cpuPercent}%`;
      if (ramEl) ramEl.innerText = `${data.appRamMB} MB (${data.sysRamPercent}%)`;
    });

    // 2. ระบบ Staggered Auto-Cycle (สลับรีเฟรช + Advance วนทีละจอ)
    function changeAutoCycleInterval(val) {
      cycleIntervalMinutes = parseInt(val, 10);
      if (cycleTimer) {
        clearTimeout(cycleTimer);
        cycleTimer = null;
      }

      if (cycleIntervalMinutes > 0) {
        cycleCurrentIndex = 0;
        scheduleNextCycleSlot();
      } else {
        updateCycleStatusUI('ปิด');
      }
    }

    function scheduleNextCycleSlot() {
      if (cycleIntervalMinutes <= 0 || streams.length === 0) {
        updateCycleStatusUI('ปิด');
        return;
      }

      const nextTarget = streams[cycleCurrentIndex % streams.length];
      const targetName = nextTarget?.name ? `[${nextTarget.name}]` : `จอ ${cycleCurrentIndex + 1}`;
      updateCycleStatusUI(`ถัดไป: ${targetName} ใน ${cycleIntervalMinutes} น.`);

      const delayMs = cycleIntervalMinutes * 60 * 1000;
      cycleTimer = setTimeout(() => {
        if (streams.length === 0 || cycleIntervalMinutes <= 0) return;

        const slot = streams[cycleCurrentIndex % streams.length];
        if (slot && slot.url && slot.url !== 'about:blank') {
          executeCycleRefreshAndAdvance(slot.id);
        }

        cycleCurrentIndex = (cycleCurrentIndex + 1) % streams.length;
        scheduleNextCycleSlot();
      }, delayMs);
    }

    function executeCycleRefreshAndAdvance(id) {
      const box = document.getElementById(`box-${id}`);
      if (box) box.classList.add('cycle-refreshing');

      // 1. รีเฟรชเฉพาะจอนี้
      reloadUrl(id);

      // 2. หน่วงเวลา 3.5 วินาทีเพื่อให้ DOM โหลด แล้วสั่ง Advance อัตโนมัติ
      setTimeout(() => {
        runAdvanceAutoFix(id);
        if (box) box.classList.remove('cycle-refreshing');
      }, 3500);
    }

    function updateCycleStatusUI(text) {
      const el = document.getElementById('cycle-status-text');
      if (el) el.innerText = text;
    }

    // 3. ฟังก์ชันอัปเดตชื่อคู่บอล/หมายเหตุ
    function updateStreamName(id, val) {
      const item = streams.find(s => s.id === id);
      if (item) item.name = val.trim();
      
      const tag = document.getElementById(`tag-${id}`);
      if (tag) {
        tag.innerText = val.trim();
        tag.classList.toggle('has-text', val.trim().length > 0);
      }
    }

    // 4. ฟังก์ชันรีเฟรช และ Advance พร้อมกันทุกหน้าต่าง
    function reloadAllStreams() {
      streams.forEach(s => reloadUrl(s.id));
    }

    function runAdvanceAll() {
      streams.forEach(s => runAdvanceAutoFix(s.id));
    }

    // 5. สลับซ่อน / แสดง แถบเมนูด้านบนสุด (Top Toolbar)
    function toggleTopToolbar() {
      isToolbarHidden = !isToolbarHidden;
      const toolbar = document.getElementById('top-toolbar');
      document.body.classList.toggle('toolbar-is-hidden', isToolbarHidden);
      if (toolbar) toolbar.classList.toggle('hidden-toolbar', isToolbarHidden);
    }

    // 6. จัดการปุ่ม Login แบบพับ/ขยาย
    function handleLoginButtonClick() {
      const group = document.getElementById('login-group-box');
      const input = document.getElementById('login-url-input');
      
      if (!group.classList.contains('expanded')) {
        group.classList.add('expanded');
        input.focus();
      } else {
        openLoginWindow();
      }
    }

    function collapseLoginGroup(e) {
      if (e) e.stopPropagation();
      const group = document.getElementById('login-group-box');
      if (group) group.classList.remove('expanded');
    }

    function openLoginWindow() {
      const loginInput = document.getElementById('login-url-input');
      let targetUrl = loginInput.value.trim() || streams[0]?.url || 'https://www.google.com';
      localStorage.setItem('saved_login_url', targetUrl);
      ipcRenderer.send('open-login-window', targetUrl);
    }

    // ล็อกอินครั้งเดียว ใช้ได้ทุกจอ: คัดลอก cookie จาก session ของหน้าต่าง login ไปทุก session ของจอ
    ipcRenderer.on('login-window-closed', () => {
      const sess = streams.map(s => s.session || 'persist:dooball_session');
      Promise.all(sess.map(name => ipcRenderer.invoke('session-copy-cookies', { from: 'persist:dooball_session', to: name })))
        .catch(() => {})
        .then(() => streams.forEach(s => reloadUrl(s.id)));
    });

    // 7. Context Menu & Outside Click Handling
    const contextMenu = document.getElementById('custom-context-menu');
    window.addEventListener('click', (e) => {
      contextMenu.style.display = 'none';

      const loginGroup = document.getElementById('login-group-box');
      if (loginGroup && !loginGroup.contains(e.target)) {
        collapseLoginGroup();
      }
    });

    function showContextMenu(e, id) {
      e.preventDefault();
      contextTargetId = id;
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.style.display = 'block';
    }

    function contextAction(action) {
      if (!contextTargetId) return;
      const id = contextTargetId;
      if (action === 'toggleHeader') toggleHeader(id);
      else if (action === 'advance') runAdvanceAutoFix(id);
      else if (action === 'maximize') toggleMaximize(id);
      else if (action === 'audio') toggleAudio(id);
      else if (action === 'reload') reloadUrl(id);
      else if (action === 'popout') popoutStream(id);
      else if (action === 'delete') removeStreamSlot(id);
      contextMenu.style.display = 'none';
    }

    function toggleHeader(id) {
      const header = document.getElementById(`header-${id}`);
      const box = document.getElementById(`box-${id}`);
      const item = streams.find(s => s.id === id);
      if (header && box && item) {
        item.headerHidden = !item.headerHidden;
        header.classList.toggle('hidden-header', item.headerHidden);
        box.classList.toggle('header-is-hidden', item.headerHidden);
      }
    }

    function toggleAllHeaders() {
      allHeadersHidden = !allHeadersHidden;
      streams.forEach(s => {
        s.headerHidden = allHeadersHidden;
        const header = document.getElementById(`header-${s.id}`);
        const box = document.getElementById(`box-${s.id}`);
        if (header) header.classList.toggle('hidden-header', allHeadersHidden);
        if (box) box.classList.toggle('header-is-hidden', allHeadersHidden);
      });
      const btn = document.getElementById('btn-toggle-all-headers');
      if (btn) {
        btn.innerText = allHeadersHidden ? '👁️ แสดงแถบจอ (H)' : '👁️ ซ่อนแถบจอ (H)';
      }
    }

    // 8. Safe Watchdog Engine
    function injectWatchdogAndBypass(id) {
      const wv = document.getElementById(`wv-${id}`);
      const item = streams.find(s => s.id === id);
      if (!wv) return;

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
            const isEnabled = ${item?.freezeDetect !== false};
            const video = document.querySelector('video');

            // ถ้าหน้านี้ยังไม่ใช่หน้าดูบอล (login/register/about:blank) ห้ามแตะ video และห้าม reload เด็ดขาด
            if (/(//|)(log-?in|log-in|signin|sign-in|register|signup|sign-up)(|-|_|.)/i.test(location.href) || location.href === 'about:blank') {
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
      wv.executeJavaScript(script).catch(() => {});
    }

    // ฟังก์ชัน Advance: ดึงเฉพาะกล่องวิดีโอหรือ Iframe หลักมาขยายเต็มกรอบ
    function runAdvanceAutoFix(id) {
      const wv = document.getElementById(`wv-${id}`);
      if (!wv) return;

      const advanceScript = `
        (function() {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            const video = document.querySelector('video');
            const iframe = document.querySelector('iframe[src*="player"]') || 
                           document.querySelector('iframe[src*="embed"]') || 
                           document.querySelector('iframe[src*="stream"]') ||
                           document.querySelector('iframe');
            // Also try to find any element with video-like dimensions or class names
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
              // If it's a video element, unmute and play it first
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
      wv.executeJavaScript(advanceScript).catch(() => {});
    }

    // 9. Incremental DOM Slot Creation
    function createStreamBoxElement(stream) {
      const currentName = stream.name || '';
      const currentVol = stream.volume !== undefined ? stream.volume : 100;
      const currentZoom = stream.zoom !== undefined ? stream.zoom : 1.0;
      const isFreezeOn = stream.freezeDetect !== false;
      const isHeaderHidden = !!stream.headerHidden;

      const box = document.createElement('div');
      box.className = `stream-box ${activeAudioId === stream.id ? 'active-audio' : ''} ${isHeaderHidden ? 'header-is-hidden' : ''}`;
      box.id = `box-${stream.id}`;

      box.addEventListener('contextmenu', (e) => showContextMenu(e, stream.id));

      box.innerHTML = `
        <div class="match-tag ${currentName ? 'has-text' : ''}" id="tag-${stream.id}">${currentName}</div>

        <button class="btn-unhide-float" onclick="toggleHeader(${stream.id})" title="แสดงแถบควบคุม">👁️ แสดงแถบ</button>

        <div class="stream-header ${isHeaderHidden ? 'hidden-header' : ''}" id="header-${stream.id}" ondblclick="toggleMaximize(${stream.id})">
          <button class="move-grip" onmousedown="onMoveGripDown(event, ${stream.id})" title="ลากเพื่อสลับตำแหน่งจอ (ปลดล็อกกริดก่อน) หรือย้ายจอในโหมดจัดเรียงเอง">⠿</button>
          <span class="stream-led" id="led-${stream.id}" title="ไฟสถานะสตรีม: เขียว = เล่นปกติ, เหลือง = กำลังโหลด, แดง = โหลดพลาด"></span>
          <input type="text" class="name-input" placeholder="📝 ชื่อคู่/หมายเหตุ..." value="${currentName}" id="name-${stream.id}" oninput="updateStreamName(${stream.id}, this.value)" title="พิมพ์ชื่อคู่บอลหรือหมายเหตุ">
          <input type="text" class="url-input" placeholder="URL ดูบอล..." value="${stream.url}" id="input-${stream.id}" onkeydown="if(event.key==='Enter')loadUrl(${stream.id})">
          <button class="nav-btn" id="back-btn-${stream.id}" onclick="goBackUrl(${stream.id})" title="ย้อนกลับหน้าก่อน" disabled>◀</button>
          <button class="nav-btn" id="fwd-btn-${stream.id}" onclick="goForwardUrl(${stream.id})" title="ไปหน้าถัดไป" disabled>▶</button>
          <button onclick="loadUrl(${stream.id})">โหลด</button>
          <button onclick="reloadUrl(${stream.id})" title="รีเฟรช">🔄</button>
          <button class="btn-advance" onclick="runAdvanceAutoFix(${stream.id})" title="Auto-Play + Focus">⚡ Advance</button>
          <button class="btn-freeze ${isFreezeOn ? 'active' : ''}" id="freeze-btn-${stream.id}" onclick="toggleFreezeDetect(${stream.id})" title="ตรวจจับภาพค้าง 15 วิ">
            ${isFreezeOn ? '🛡️ Guard' : '🛡️ Off'}
          </button>
          
          <div class="zoom-control">
            <button onclick="adjustZoom(${stream.id}, -0.1)">-</button>
            <span id="zoom-txt-${stream.id}">${Math.round(currentZoom * 100)}%</span>
            <button onclick="adjustZoom(${stream.id}, 0.1)">+</button>
            <button onclick="toggleSaturation(${stream.id})" title="สลับโทนสี: ปกติ / นุ่มตา (จางลง)" id="sat-btn-${stream.id}">◐</button>
          </div>

          <button id="audio-btn-${stream.id}" class="${activeAudioId === stream.id ? 'unmuted' : ''}" onclick="toggleAudio(${stream.id})" onwheel="onStreamWheel(event, ${stream.id}, 'audio')" title="เปิด/ปิดเสียง — เลื่อนล้อเมาส์บนปุ่มนี้เพื่อปรับระดับเสียง">
            ${activeAudioId === stream.id ? '🔊' : '🔇'}
          </button>
          <div class="volume-control">
            <input type="range" min="0" max="100" value="${currentVol}" oninput="setStreamVolume(${stream.id}, this.value)">
            <span id="vol-txt-${stream.id}">${currentVol}%</span>
          </div>

          <button class="brightness-btn" id="bright-btn-${stream.id}" onclick="adjustBrightness(${stream.id}, 10)" onwheel="onStreamWheel(event, ${stream.id}, 'bright')" title="ปรับความสว่างจอนี้ (กด + / เลื่อนล้อขึ้น = สว่างขึ้น, เลื่อนล้อลง = มืดลง)">☀</button>
          <button id="popout-btn-${stream.id}" onclick="popoutStream(${stream.id})" title="ดึงจอนี้ออกไปเป็นหน้าต่างแยก (ลากไปจอที่ 2 ได้) — กด Ctrl+P ในหน้าต่างเพื่อตรึง">⧉</button>
          <button onclick="toggleMaximize(${stream.id})" title="ขยายเดี่ยว">⛶</button>
          <button onclick="toggleHeader(${stream.id})" title="ซ่อนแถบควบคุมนี้">👁️</button>
          <button class="btn-del" onclick="removeStreamSlot(${stream.id})">✕</button>
        </div>
        <webview 
          id="wv-${stream.id}" 
          src="${stream.url || 'about:blank'}" 
          partition="${stream.session || 'persist:dooball_session'}"
          allowpopups="false" 
          nativeWindowOpen="true"
          nodeintegration="true">
        </webview>
        <div class="resize-handle" onmousedown="startDragBox(event, ${stream.id}, 'resize')" title="ลากเพื่อย่อ/ขยายจอ"></div>
        <div id="load-status-${stream.id}" style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.7);color:#aaa;font-size:10px;padding:2px 6px;border-radius:3px;display:none;z-index:30;pointer-events:none;"></div>
      `;

      const wv = box.querySelector('webview');
      // จอที่ pop-out อยู่ ห้ามรีโหลด/โหลดซ้ำเด็ดขาด (webview ถูกถอดไปแล้ว)
      const isPopoutActive = () => !!detachedPopoutWebviews[stream.id];
      wv.addEventListener('dom-ready', () => {
        const isAudible = (multiAudioMode && multiAudioSet.has(stream.id)) || activeAudioId === stream.id;
        wv.setAudioMuted(!isAudible);
        wv.setZoomFactor(currentZoom);
        setStreamVolume(stream.id, currentVol);
        applyBrightness(stream.id);
        injectWatchdogAndBypass(stream.id);
        updateNavButtons(stream.id);
      });
      wv.addEventListener('new-window', (e) => e.preventDefault());
      wv.addEventListener('did-fail-load', (event) => {
        console.error(`Webview ${stream.id} failed to load: ${event.validatedURL} (code: ${event.errorCode})`);
        setStreamLED(stream.id, 'error');
        const statusEl = document.getElementById(`load-status-${stream.id}`);
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.innerText = '❌ โหลดไม่ได้';
          setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
        }
      });
      wv.addEventListener('did-finish-load', () => {
        console.log(`Webview ${stream.id} finished loading: ${wv.getURL()}`);
        setStreamLED(stream.id, 'live');
        updateNavButtons(stream.id);
        const statusEl = document.getElementById(`load-status-${stream.id}`);
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.innerText = '✅ โหลดเสร็จ';
          setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
        }
      });
      wv.addEventListener('did-start-loading', () => {
        setStreamLED(stream.id, 'loading');
        const statusEl = document.getElementById(`load-status-${stream.id}`);
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.innerText = '⏳ กำลังโหลด...';
        }
      });

      // ช่อง URL ซิงก์ตามหน้าจริงแบบเบราว์เซอร์ (ลงทะเบียนครั้งเดียว ไม่สะสม listener)
      const urlInput = box.querySelector('.url-input');
      let urlSaveTimer = null;
      const syncUrlFromWebview = () => {
        try {
          const realUrl = wv.getURL();
          if (realUrl && realUrl !== 'about:blank' && urlInput && document.activeElement !== urlInput) urlInput.value = realUrl;
          const item = streams.find(s => s.id === stream.id);
          if (item) item.url = realUrl;
          if (urlSaveTimer) clearTimeout(urlSaveTimer);
          urlSaveTimer = setTimeout(saveToStorageSilent, 1200);
        } catch (err) {}
      };
      wv.addEventListener('did-navigate', syncUrlFromWebview);
      wv.addEventListener('did-navigate-in-page', syncUrlFromWebview);

      return box;
    }

    function initGrid() {
      const container = document.getElementById('grid-container');
      container.innerHTML = '';
      streams.forEach(stream => {
        container.appendChild(createStreamBoxElement(stream));
      });
      applyGridOrder();
    }

    function addStreamSlot() {
      const newStream = { id: nextId++, name: '', url: '', volume: 100, zoom: 1.0, freezeDetect: true, headerHidden: false, session: 'persist:dooball_' + nextId };
      streams.push(newStream);
      
      const container = document.getElementById('grid-container');
      container.appendChild(createStreamBoxElement(newStream));
      applyGridOrder();

      if (layoutMode === 'custom') {
        autoPlaceStream(newStream.id);
        applyGeometry(newStream.id);
        persistGeometry();
      }
    }

    function removeStreamSlot(id) {
      streams = streams.filter(s => s.id !== id);
      if (activeAudioId === id) activeAudioId = null;
      if (maximizedId === id) maximizedId = null;

      // ถ้าจอนี้ถูก pop-out อยู่ ให้ปิดหน้าต่างแยกด้วย
      ipcRenderer.send('close-popout', id);

      delete boxGeometry[id];
      delete gridOrder[id];
      delete detachedPopoutWebviews[id];
      persistGridOrder();
      persistGeometry();

      const targetBox = document.getElementById(`box-${id}`);
      if (targetBox) targetBox.remove();
    }

    function changeLayout(value) {
      // เลือกเลย์เอาต์ที่บันทึกไว้จากเมนู Layout = เข้าโหมด custom พร้อมวางจอตามที่บันทึกทันที
      if (typeof value === 'string' && value.indexOf('custom-preset:') === 0) {
        loadCustomLayout(Number(value.slice('custom-preset:'.length)));
        return;
      }
      if (value === 'layout-custom') {
        layoutMode = 'custom';
        localStorage.setItem('saved_layout_mode', 'custom');
      } else {
        layoutMode = 'grid';
        currentGridClass = value;
        localStorage.setItem('saved_layout_mode', 'grid');
        localStorage.setItem('saved_layout_class', value);
      }
      persistGridOrder();
      applyLayoutMode();
    }

    // ===== Custom Free-Layout Engine: จัดเรียงจอเองด้วยการลาก + บันทึกเลย์เอาต์เป็นชื่อ =====
    function applyLayoutMode() {
      const container = document.getElementById('grid-container');
      const select = document.getElementById('layout-select');
      if (!container) return;

      if (layoutMode === 'custom') {
        // ลบตำแหน่งค้างของช่องที่ถูกลบไปแล้ว
        Object.keys(boxGeometry).forEach(k => {
          if (!streams.some(s => s.id === Number(k))) delete boxGeometry[k];
        });
        container.className = 'mode-custom';
        document.body.classList.add('custom-mode');
        maybeShowCustomHint();
        // เดินหน้า pointer ไปหาเลย์เอาต์ที่ geometry ตรงกับปัจจุบัน (เผื่อเปิดใหม่หลังใช้งานค้างไว้)
        if (activeLayoutIndex < 0 && customLayouts.length) {
          const cur = JSON.stringify(boxGeometry);
          const found = customLayouts.findIndex(p => p && JSON.stringify(p.boxes || {}) === cur);
          if (found >= 0) activeLayoutIndex = found;
        }
        renderCustomPresetUI();
        streams.forEach(s => {
          if (!boxGeometry[s.id]) autoPlaceStream(s.id);
          applyGeometry(s.id);
        });
      } else {
        container.className = currentGridClass;
        document.body.classList.remove('custom-mode');
        if (select) select.value = currentGridClass;
        streams.forEach(s => clearGeometry(s.id));
        applyGridOrder();
      }
    }

    function autoPlaceStream(id) {
      const cols = 2;
      const rows = Math.max(1, Math.ceil(streams.length / cols));
      const index = Math.max(0, streams.findIndex(s => s.id === id));
      boxGeometry[id] = {
        x: (index % cols) * 50,
        y: Math.floor(index / cols) * (100 / rows),
        w: 50,
        h: 100 / rows
      };
    }

    function applyGeometry(id) {
      const box = document.getElementById(`box-${id}`);
      const g = boxGeometry[id];
      if (!box || !g) return;
      box.style.left = g.x + '%';
      box.style.top = g.y + '%';
      box.style.width = g.w + '%';
      box.style.height = g.h + '%';
    }

    function clearGeometry(id) {
      const box = document.getElementById(`box-${id}`);
      if (!box) return;
      box.style.left = '';
      box.style.top = '';
      box.style.width = '';
      box.style.height = '';
    }

    function persistGeometry() {
      localStorage.setItem('saved_custom_geometry', JSON.stringify(boxGeometry));
    }

    function clampPct(v, min, max) {
      return Math.min(Math.max(v, min), Math.max(min, max));
    }

    // ===== เอนจินกันจอทับ + ขอบชนแบบแม่เหล็ก (โหมดจัดเรียงเอง) =====
    const SNAP_TOL = 1.5;    // % — ระยะที่ขอบถูกดูดเข้าหาขอบอื่น
    const OVERLAP_EPS = 0.4; // % — ยอมให้ชิดกันเกินเล็กน้อย (แตะขอบกัน = ไม่นับว่าทับ)
    const MIN_PCT = 2;       // % — ขนาดจอเล็กสุดทางเรขาคณิต

    function roundHalf(v) { return Math.round(v * 2) / 2; }

    function clampRect(ng) {
      ng.w = Math.min(Math.max(ng.w, MIN_PCT), 100 - ng.x);
      ng.h = Math.min(Math.max(ng.h, MIN_PCT), 100 - ng.y);
      ng.x = clampPct(ng.x, 0, 100 - ng.w);
      ng.y = clampPct(ng.y, 0, 100 - ng.h);
      return ng;
    }

    function overlapsEps(a, b) {
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return ox > OVERLAP_EPS && oy > OVERLAP_EPS;
    }

    function getOtherRects(id) {
      return streams
        .filter(s => s.id !== id && boxGeometry[s.id])
        .map(s => ({ ...boxGeometry[s.id] }));
    }

    // ขอบแม่เหล็ก: ดึงขอบที่กำลังขยับเข้าหาขอบจออื่น/ขอบกริดเมื่อใกล้ภายใน SNAP_TOL
    function applyMagneticSnap(ng, others, mode) {
      const xTargets = [0, 100];
      const yTargets = [0, 100];
      others.forEach(o => { xTargets.push(o.x, o.x + o.w); yTargets.push(o.y, o.y + o.h); });
      const nearest = (v, targets) => {
        let best = null, bestD = SNAP_TOL;
        for (const t of targets) { const d = Math.abs(v - t); if (d < bestD) { bestD = d; best = t; } }
        return best;
      };
      let snapped = false;

      if (mode === 'move') {
        // เลือกขอบที่ใกล้ที่สุดรายแกน (แกนละขอบเดียว กันสับสน)
        const canL = nearest(ng.x, xTargets);
        const canR = nearest(ng.x + ng.w, xTargets);
        const dxL = canL === null ? Infinity : Math.abs(ng.x - canL);
        const dxR = canR === null ? Infinity : Math.abs(ng.x + ng.w - canR);
        if (canL !== null && dxL <= dxR) { ng.x = canL; snapped = true; }
        else if (canR !== null) { ng.x = canR - ng.w; snapped = true; }

        const canT = nearest(ng.y, yTargets);
        const canB = nearest(ng.y + ng.h, yTargets);
        const dyT = canT === null ? Infinity : Math.abs(ng.y - canT);
        const dyB = canB === null ? Infinity : Math.abs(ng.y + ng.h - canB);
        if (canT !== null && dyT <= dyB) { ng.y = canT; snapped = true; }
        else if (canB !== null) { ng.y = canB - ng.h; snapped = true; }
      } else {
        // resize (ลากมุมขวาล่าง): snap เฉพาะขอบขวา/ล่างที่กำลังขยับ
        const canR = nearest(ng.x + ng.w, xTargets);
        if (canR !== null && canR - ng.x >= MIN_PCT) { ng.w = canR - ng.x; snapped = true; }
        const canB = nearest(ng.y + ng.h, yTargets);
        if (canB !== null && canB - ng.y >= MIN_PCT) { ng.h = canB - ng.y; snapped = true; }
      }
      return snapped;
    }

    // กันทับ: move = ดันออกด้วยระยะน้อยสุดจนวางชิดขอบกัน / resize = หดตามขอบที่กำลังขยาย
    // ผลลัพธ์: จอลากเข้าหากันแล้ววางชิดเป๊ะ ๆ ลากทะลุทับกันไม่ได้
    function resolveCollisions(ng, others, mode, start) {
      if (mode === 'resize') {
        for (const o of others) {
          if (!overlapsEps(ng, o)) continue;
          if (o.x > ng.x + OVERLAP_EPS) {
            const nw = roundHalf(o.x - ng.x);
            if (nw >= MIN_PCT) ng.w = nw; else ng.w = start.w;
          }
          if (o.y > ng.y + OVERLAP_EPS) {
            const nh = roundHalf(o.y - ng.y);
            if (nh >= MIN_PCT) ng.h = nh; else ng.h = start.h;
          }
        }
        return ng;
      }
      // move: ดันออกตามแกนที่ระยะดันน้อยสุด วนซ้ำกรณีชนหลายจอพร้อมกัน
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const o of others) {
          if (!overlapsEps(ng, o)) continue;
          const penL = ng.x + ng.w - o.x;
          const penR = o.x + o.w - ng.x;
          const penT = ng.y + ng.h - o.y;
          const penB = o.y + o.h - ng.y;
          const m = Math.min(penL, penR, penT, penB);
          if (m === penL) ng.x = o.x - ng.w;
          else if (m === penR) ng.x = o.x + o.w;
          else if (m === penT) ng.y = o.y - ng.h;
          else ng.y = o.y + o.h;
          clampRect(ng);
          moved = true;
        }
        if (!moved) break;
      }
      return ng;
    }

    // ลากย้าย (move) หรือลากย่อขยาย (resize) ในโหมดจัดเรียงเอง — ขอบชนกันเอง ลากทับกันไม่ได้
    function startDragBox(e, id, mode) {
      if (layoutMode !== 'custom' || maximizedId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      const container = document.getElementById('grid-container');
      const overlay = document.getElementById('drag-overlay');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const start = { ...(boxGeometry[id] || { x: 0, y: 0, w: 50, h: 50 }) };
      const startX = e.clientX;
      const startY = e.clientY;
      const box = document.getElementById(`box-${id}`);
      if (box) box.style.zIndex = '8000';
      // ครอบ overlay ทั้งหน้าจอ เพื่อให้เมาส์ยังติดตามได้แม้ลากผ่านบนวิดีโอ
      if (overlay) {
        overlay.classList.toggle('resizing', mode === 'resize');
        overlay.style.display = 'block';
      }

      const onMove = (ev) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;
        const ng = { ...start };
        if (mode === 'move') {
          ng.x = clampPct(start.x + dxPct, 0, 100 - start.w);
          ng.y = clampPct(start.y + dyPct, 0, 100 - start.h);
        } else {
          ng.w = clampPct(start.w + dxPct, 10, 100 - start.x);
          ng.h = clampPct(start.h + dyPct, 10, 100 - start.y);
        }
        ng.x = roundHalf(ng.x); ng.y = roundHalf(ng.y);
        ng.w = roundHalf(ng.w); ng.h = roundHalf(ng.h);

        const others = getOtherRects(id);
        const snapped = applyMagneticSnap(ng, others, mode);
        resolveCollisions(ng, others, mode, start);
        clampRect(ng);
        ng.x = roundHalf(ng.x); ng.y = roundHalf(ng.y);
        ng.w = roundHalf(ng.w); ng.h = roundHalf(ng.h);

        boxGeometry[id] = ng;
        applyGeometry(id);
        if (box) box.classList.toggle('snapping', snapped);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const b = document.getElementById(`box-${id}`);
        if (b) { b.style.zIndex = ''; b.classList.remove('snapping'); }
        if (overlay) overlay.style.display = 'none';
        persistGeometry();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    // ===== บันทึก / โหลด / ลบ เลย์เอาต์ที่จัดเอง =====
    function persistCustomLayouts() {
      localStorage.setItem('saved_custom_layouts', JSON.stringify(customLayouts));
    }

    function renderCustomPresetUI() {
      // เรนเดอร์เลย์เอาต์ที่บันทึกไว้ลงในเมนู Layout (optgroup) — แผงลอยเดิมถูกยุบรวมเข้าเมนูนี้
      const group = document.getElementById('layout-presets-group');
      if (group) {
        group.innerHTML = '';
        customLayouts.forEach((preset, i) => {
          const opt = document.createElement('option');
          opt.value = 'custom-preset:' + i;
          opt.innerText = (i === activeLayoutIndex ? '▸ ' : '') + preset.name + (i === activeLayoutIndex ? ' ←ใช้อยู่' : '');
          group.appendChild(opt);
        });
      }
      // ซิงก์ dropdown ชี้เลย์เอาต์ที่ใช้อยู่ + โชว์ปุ่มลบเฉพาะเมื่อกำลังใช้เลย์เอาต์ที่บันทึกไว้
      const select = document.getElementById('layout-select');
      const delBtn = document.getElementById('btn-del-preset');
      const hasActive = layoutMode === 'custom' && activeLayoutIndex >= 0 && !!customLayouts[activeLayoutIndex];
      if (layoutMode === 'custom' && select) {
        select.value = hasActive ? 'custom-preset:' + activeLayoutIndex : 'layout-custom';
      }
      if (delBtn) delBtn.style.display = hasActive ? '' : 'none';
    }

    function deleteActiveCustomLayout() {
      if (activeLayoutIndex < 0 || !customLayouts[activeLayoutIndex]) return;
      if (!confirm('ลบเลย์เอาต์ "' + customLayouts[activeLayoutIndex].name + '" ?')) return;
      customLayouts.splice(activeLayoutIndex, 1);
      activeLayoutIndex = -1;
      persistCustomLayouts();
      renderCustomPresetUI();
    }

    // คำใบ้วิธีใช้โหมดจัดเรียงเอง — โชว์ครั้งแรกของเซสชันครั้งเดียวแล้วหายไปเอง
    let customHintShown = false;
    function maybeShowCustomHint() {
      if (customHintShown) return;
      customHintShown = true;
      const t = document.getElementById('custom-hint-toast');
      if (!t) return;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 5200);
    }

    let activeLayoutIndex = -1; // เลย์เอาต์ที่กำลังใช้อยู่ (กดบันทึกไม่พิมพ์ชื่อ = อัปเดตตัวนี้ ไม่สร้างซ้ำ)

    function saveCurrentCustomLayout() {
      if (layoutMode !== 'custom') return;
      if (!Array.isArray(customLayouts)) customLayouts = [];
      const nameInput = document.getElementById('cl-new-name');
      const typedName = nameInput ? nameInput.value.trim() : '';
      const snapshot = JSON.parse(JSON.stringify(boxGeometry));

      let targetIndex = -1;
      if (typedName) {
        // พิมพ์ชื่อที่มีอยู่แล้ว = อัปเดตทับรายการนั้น
        targetIndex = customLayouts.findIndex(p => p && p.name === typedName);
      } else if (activeLayoutIndex >= 0 && customLayouts[activeLayoutIndex]) {
        // ไม่พิมพ์ชื่อ = อัปเดตเลย์เอาต์ที่กำลังใช้อยู่ (กันสร้าง "เลย์เอาต์ 2, 3, ..." ซ้ำ)
        targetIndex = activeLayoutIndex;
      }

      if (targetIndex >= 0) {
        customLayouts[targetIndex].boxes = snapshot;
        activeLayoutIndex = targetIndex;
      } else {
        customLayouts.push({ name: typedName || ('เลย์เอาต์ ' + (customLayouts.length + 1)), boxes: snapshot });
        activeLayoutIndex = customLayouts.length - 1;
      }

      persistCustomLayouts();
      persistGeometry();
      renderCustomPresetUI();
      if (nameInput) nameInput.value = '';
      flashCustomSave();
    }

    // ปุ่มบันทึกในแผงลอยขึ้น "✓ บันทึกแล้ว" ชั่วครู่ เพื่อยืนยันว่าทำงานแล้วจริง
    function flashCustomSave() {
      const btn = document.querySelector('#custom-save-group .cl-save');
      if (!btn) return;
      if (btn.dataset.origText === undefined) btn.dataset.origText = btn.innerText;
      btn.innerText = '✓ บันทึกแล้ว';
      if (btn._flashTimer) clearTimeout(btn._flashTimer);
      btn._flashTimer = setTimeout(() => { btn.innerText = btn.dataset.origText; }, 1600);
    }

    function loadCustomLayout(i) {
      const preset = customLayouts[i];
      if (!preset) return;
      activeLayoutIndex = i; // จำว่ากำลังใช้เลย์เอาต์ไหน กดบันทึกทีหลังจะอัปเดตตัวนี้
      boxGeometry = JSON.parse(JSON.stringify(preset.boxes));
      if (layoutMode !== 'custom') {
        changeLayout('layout-custom');
      } else {
        streams.forEach(s => {
          if (!boxGeometry[s.id]) autoPlaceStream(s.id);
          applyGeometry(s.id);
        });
      }
      persistGeometry();
      renderCustomPresetUI();
    }

    function toggleFullScreen() {
      ipcRenderer.send('toggle-fullscreen');
    }

    // ===== Pin: ตรึงหน้าต่างหลักไว้เหนือโปรแกรมอื่น =====
    let mainPinned = localStorage.getItem('saved_main_pinned') === '1';

    function applyPinnedUI() {
      const btn = document.getElementById('btn-pin');
      if (btn) {
        btn.classList.toggle('pinned-on', mainPinned);
        btn.innerText = mainPinned ? '📌 กำลังตรึง' : '📌 ตรึงหน้าต่าง';
      }
    }

    function togglePinned() {
      mainPinned = !mainPinned;
      localStorage.setItem('saved_main_pinned', mainPinned ? '1' : '0');
      ipcRenderer.send('set-main-pinned', mainPinned);
      applyPinnedUI();
    }

    // ===== Pop-out: ดึงจอออกไปเป็นหน้าต่างแยก (ลากไปมอนิเตอร์ที่ 2 ได้) =====
    // เก็บ webview ที่ถูกถอดออกจากกริดระหว่าง pop-out (กันสตรีมเล่นซ้ำ 2 ที่พร้อมกัน)
    const detachedPopoutWebviews = {};

    function closePopoutWindow(id) {
      ipcRenderer.send('close-popout', id);
    }

    // ดึง webview กลับเข้ากริดหลังปิดหน้าต่าง pop-out (โหลดต่อจาก URL ล่าสุดที่ sync ไว้)
    function restorePopoutWebview(id) {
      const stored = detachedPopoutWebviews[id];
      if (!stored) return;
      delete detachedPopoutWebviews[id];
      const ph = document.getElementById('popout-ph-' + id);
      if (ph) ph.remove();
      const box = document.getElementById('box-' + id);
      if (!box) return;
      const inp = document.getElementById('input-' + id);
      const u = (inp && inp.value.trim()) || '';
      if (u && u !== 'about:blank' && u !== stored.el.getAttribute('src')) stored.el.setAttribute('src', u);
      const handle = box.querySelector('.resize-handle');
      box.insertBefore(stored.el, handle || null);
    }

    function popoutStream(id) {
      const item = streams.find(s => s.id === id);
      if (!item) return;
      const input = document.getElementById(`input-${id}`);
      let url = (input ? input.value.trim() : '') || item.url;
      if (!url || url === 'about:blank') {
        alert('จอนี้ยังไม่มีลิงก์ ใส่ลิงก์และกดโหลดก่อนนะครับ');
        return;
      }
      const wv = document.getElementById(`wv-${id}`);
      // จำ partition ของจอนี้ไว้ส่งให้หน้าต่างแยก (อ่านก่อนถอด webview ออกจาก DOM)
      let part = 'persist:dooball_session';
      try { if (wv && wv.getAttribute('partition')) part = wv.getAttribute('partition'); } catch (err) {}
      // ใช้ URL ปัจจุบันจริงของหน้า (เผื่อผู้ใช้เดินทางไปหน้าอื่นแล้ว) แทนค่าเก่าในช่อง
      try { if (wv && wv.getURL() && wv.getURL() !== 'about:blank') url = wv.getURL(); } catch (err) {}
      ipcRenderer.send('popout-stream', {
        streamId: id,
        url: url,
        zoom: (wv && typeof wv.getZoomFactor === 'function') ? wv.getZoomFactor() : 1.0,
        volume: item.volume !== undefined ? item.volume : 100,
        session: part
      });

      // หยุดเล่นซ้ำในกริด: ถอด webview ออกจาก DOM (สตรีมต้นทางหยุด) แล้ววาง placeholder แทน
      // คลิก placeholder / ปิดหน้าต่างแยก = ดึง webview กลับมาเล่นที่กริดเหมือนเดิม
      const box = document.getElementById(`box-${id}`);
      if (wv && box) {
        detachedPopoutWebviews[id] = { el: wv };
        wv.remove();
        const ph = document.createElement('div');
        ph.id = `popout-ph-${id}`;
        ph.className = 'popout-placeholder';
        ph.innerHTML = '<div>⧉ จอนี้ pop-out อยู่</div><small>คลิกเพื่อดึงกลับมาที่กริด</small>';
        ph.onclick = () => closePopoutWindow(id);
        box.insertBefore(ph, box.querySelector('.resize-handle'));
      }

      // ปิดปุ่มชั่วคราวกันกดซ้ำ เปิดใหม่เมื่อหน้าต่างแยกถูกปิด
      const popBtn = document.getElementById(`popout-btn-${id}`);
      if (popBtn) {
        popBtn.disabled = true;
        popBtn.title = 'จอนี้กำลังเปิดอยู่ในหน้าต่างแยก (ปิดหน้าต่างแล้วปุ่มจะกลับมาใช้ได้)';
      }
    }

    // หน้าต่าง pop-out ถูกปิด → ดึง webview กลับเข้ากริด + ปุ่มกลับมาใช้งานได้อีกครั้ง
    ipcRenderer.on('popout-closed', (event, streamId) => {
      restorePopoutWebview(streamId);
      const btn = document.getElementById(`popout-btn-${streamId}`);
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.title = 'ดึงจอนี้ออกไปเป็นหน้าต่างแยก (ลากไปจอที่ 2 ได้) — กด Ctrl+P ในหน้าต่างเพื่อตรึง';
      }
    });

    // ปุ่ม ⠿ หน้าแถบจอ: โหมดจัดเรียงเอง = ลากย้ายอิสระ / โหมดตาราง = ลากสลับช่อง
    function onMoveGripDown(e, id) {
      if (layoutMode === 'custom') startDragBox(e, id, 'move');
      else startGridSwap(e, id);
    }

    // ===== Grid Lock + ลากสลับจอในโหมดตาราง (สลับด้วย CSS order — วิดีโอไม่รีโหลด) =====
    let gridLocked = localStorage.getItem('saved_grid_lock') !== '0';
    let gridOrder = {};
    try {
      const _savedOrder = JSON.parse(localStorage.getItem('saved_grid_order'));
      if (_savedOrder && typeof _savedOrder === 'object' && !Array.isArray(_savedOrder)) gridOrder = _savedOrder;
    } catch (err) { gridOrder = {}; }

    function updateGridLockUI() {
      const btn = document.getElementById('btn-grid-lock');
      if (btn) {
        btn.innerText = gridLocked ? '🔒 ล็อกกริด' : '🔓 ปลดล็อก';
        btn.style.color = gridLocked ? '' : 'var(--accent)';
      }
      document.body.classList.toggle('grid-locked', gridLocked);
    }

    function toggleGridLock() {
      gridLocked = !gridLocked;
      localStorage.setItem('saved_grid_lock', gridLocked ? '1' : '0');
      updateGridLockUI();
    }

    function applyGridOrder() {
      streams.forEach(s => {
        const box = document.getElementById(`box-${s.id}`);
        if (box) box.style.order = gridOrder[s.id] !== undefined ? gridOrder[s.id] : s.id;
      });
    }

    function persistGridOrder() {
      const pruned = {};
      streams.forEach(s => { if (gridOrder[s.id] !== undefined) pruned[s.id] = gridOrder[s.id]; });
      gridOrder = pruned;
      localStorage.setItem('saved_grid_order', JSON.stringify(gridOrder));
    }

    // ลากแถบจอในโหมดตาราง → ช่องเป้าหมายเรืองแสง → ปล่อย = สลับตำแหน่งกันทันที
    function startGridSwap(e, id) {
      if (gridLocked || layoutMode !== 'grid' || maximizedId !== null) return;
      e.preventDefault();
      e.stopPropagation();

      if (!document.getElementById(`box-${id}`)) return;
      let lastTarget = null;

      const onMove = (ev) => {
        lastTarget = null;
        streams.forEach(s => {
          if (s.id === id) return;
          const b = document.getElementById(`box-${s.id}`);
          if (!b) return;
          const r = b.getBoundingClientRect();
          const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
          b.classList.toggle('drop-target', inside);
          if (inside) lastTarget = s.id;
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        streams.forEach(s => {
          const b = document.getElementById(`box-${s.id}`);
          if (b) b.classList.remove('drop-target');
        });
        if (lastTarget && lastTarget !== id) swapGridSlots(id, lastTarget);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function swapGridSlots(idA, idB) {
      const idxOf = (x) => streams.findIndex(s => s.id === x);
      const oa = gridOrder[idA] !== undefined ? gridOrder[idA] : (idxOf(idA) + 1);
      const ob = gridOrder[idB] !== undefined ? gridOrder[idB] : (idxOf(idB) + 1);
      gridOrder[idA] = ob;
      gridOrder[idB] = oa;
      applyGridOrder();
      persistGridOrder();
    }

    // ===== ไฟสถานะสตรีมต่อจอ (LED) =====
    function setStreamLED(id, state) {
      const led = document.getElementById(`led-${id}`);
      if (!led) return;
      led.className = 'stream-led' + (state ? ' led-' + state : '');
    }

    // ===== ปรับความสว่าง/สีต่อจอ (เลื่อนล้อบนปุ่ม ☀) =====
    function adjustBrightness(id, delta) {
      const item = streams.find(s => s.id === id);
      if (!item) return;
      const cur = (item.brightness !== undefined) ? item.brightness : 100;
      item.brightness = Math.min(150, Math.max(50, cur + delta));
      applyBrightness(id);
    }

    function applyBrightness(id) {
      const item = streams.find(s => s.id === id);
      const wv = document.getElementById(`wv-${id}`);
      if (!item || !wv) return;
      const b = (item.brightness !== undefined) ? item.brightness : 100;
      const s = (item.saturation !== undefined) ? item.saturation : 100;
      // กลับสู่ค่าปกติทั้งคู่ = เคลียร์ filter ทิ้ง (ให้ภาพกลับเป็นต้นฉบับ 100%)
      wv.style.filter = (b !== 100 || s !== 100) ? `brightness(${b}%) saturate(${s}%)` : '';
    }

    function toggleSaturation(id) {
      const item = streams.find(s => s.id === id);
      if (!item) return;
      const cur = (item.saturation !== undefined) ? item.saturation : 100;
      item.saturation = (cur === 100) ? 60 : 100;
      applyBrightness(id);
    }

    // เลื่อนล้อเมาส์บนปุ่ม 🔊 = ปรับเสียงจอนั้น / บนปุ่ม ☀ = ปรับความสว่าง
    function onStreamWheel(e, id, kind) {
      if (kind === 'audio') {
        const item = streams.find(s => s.id === id);
        if (!item) return;
        const cur = (item.volume !== undefined) ? item.volume : 100;
        const next = Math.min(100, Math.max(0, cur + (e.deltaY < 0 ? 5 : -5)));
        if (cur === 0 && e.deltaY < 0 && activeAudioId !== id && !multiAudioSet.has(id)) toggleAudio(id);
        setStreamVolume(id, next);
        const slider = document.querySelector(`#box-${id} .volume-control input[type=range]`);
        if (slider) slider.value = next;
      } else if (kind === 'bright') {
        adjustBrightness(id, e.deltaY < 0 ? 5 : -5);
      }
    }

    // ===== โหมดเปิดเสียงหลายจอพร้อมกัน =====
    let multiAudioMode = false;
    const multiAudioSet = new Set();

    function toggleMultiAudioMode(on) {
      multiAudioMode = !!on;
      localStorage.setItem('saved_multi_audio', multiAudioMode ? '1' : '0');
      if (!multiAudioMode && multiAudioSet.size) {
        const first = multiAudioSet.values().next().value;
        multiAudioSet.clear();
        activeAudioId = first;
        streams.forEach(stream => {
          const isTarget = stream.id === activeAudioId;
          const wv = document.getElementById(`wv-${stream.id}`);
          const btn = document.getElementById(`audio-btn-${stream.id}`);
          const box = document.getElementById(`box-${stream.id}`);
          if (wv) wv.setAudioMuted(!isTarget);
          if (btn) { btn.innerText = isTarget ? '🔊' : '🔇'; btn.className = isTarget ? 'unmuted' : ''; }
          if (box) box.classList.toggle('active-audio', isTarget);
        });
      }
    }

    // สลับเสียงตามลำดับจอที่แสดง (ใช้กับปุ่มลัด 1–9 / Tab / ลูกศร)
    function toggleAudioByIndex(idx) {
      if (idx < 0 || idx >= streams.length) return;
      toggleAudio(streams[idx].id);
    }

    function cycleAudio(step) {
      if (!streams.length) return;
      if (multiAudioMode) {
        let start = 0;
        if (multiAudioSet.size) {
          const lastId = Math.max(...multiAudioSet);
          start = streams.findIndex(s => s.id === lastId);
        }
        let next = (start + step + streams.length) % streams.length;
        for (let i = 0; i < streams.length; i++) {
          if (!multiAudioSet.has(streams[next].id)) break;
          next = (next + step + streams.length) % streams.length;
        }
        toggleAudio(streams[next].id);
      } else {
        const cur = activeAudioId !== null ? streams.findIndex(s => s.id === activeAudioId) : -1;
        const next = (cur + step + streams.length) % streams.length;
        toggleAudio(streams[next].id);
      }
    }

    function maximizeByIndex(idx) {
      if (idx >= 0 && idx < streams.length) toggleMaximize(streams[idx].id);
    }

    // ===== สมุดปุ่มลัด (กด ? เพื่อเปิด) =====
    function toggleShortcutOverlay() {
      const ov = document.getElementById('shortcuts-overlay');
      if (ov) ov.classList.toggle('open');
    }
    function closeShortcutOverlay() {
      const ov = document.getElementById('shortcuts-overlay');
      if (ov) ov.classList.remove('open');
    }

    // ===== โหมดโปร่งใสหน้าต่าง =====
    function setWindowOpacity(v) {
      const val = Math.min(100, Math.max(30, Number(v) || 100));
      localStorage.setItem('saved_window_opacity', String(val));
      ipcRenderer.send('set-window-opacity', val / 100);
    }

    // ===== ธีมสี Custom (เลือกสีเน้นของทั้งแอป) =====
    function hexToRgb(hex) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [48, 209, 88];
    }

    function applyAccent(hex, save = true) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
      const [r, g, b] = hexToRgb(hex);
      const root = document.documentElement.style;
      root.setProperty('--accent', hex);
      root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
      root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
      document.querySelectorAll('.theme-swatch').forEach(sw => {
        sw.classList.toggle('current', (sw.dataset.c || '').toLowerCase() === hex.toLowerCase());
      });
      const picker = document.getElementById('theme-custom-color');
      if (picker) picker.value = hex;
      if (save) localStorage.setItem('saved_accent', hex);
    }

    function setCustomAccent(hex) { applyAccent(hex); }

    // Keyboard Shortcuts: T, H, F11, Esc, 1–9 (เสียง), Shift+1–9 (ขยายเดี่ยว), Tab/M, ? (สมุดปุ่มลัด)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullScreen();
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const digit = (e.key >= '1' && e.key <= '9') ? parseInt(e.key, 10) : null;

      if (e.key === '?') {
        e.preventDefault();
        toggleShortcutOverlay();
      } else if (e.key === 'Escape') {
        const ov = document.getElementById('shortcuts-overlay');
        if (ov && ov.classList.contains('open')) {
          closeShortcutOverlay();
        } else if (maximizedId !== null) {
          toggleMaximize(maximizedId);
        } else {
          // ดึง pop-out ทุกจอกลับมาในกริด
          streams.forEach(s => ipcRenderer.send('close-popout', s.id));
        }
      } else if (digit !== null && e.shiftKey) {
        maximizeByIndex(digit - 1);
      } else if (digit !== null) {
        toggleAudioByIndex(digit - 1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleAudio(e.shiftKey ? -1 : 1);
      } else if (e.key === 'ArrowRight') {
        cycleAudio(1);
      } else if (e.key === 'ArrowLeft') {
        cycleAudio(-1);
      } else if (e.key.toLowerCase() === 'm') {
        muteAll();
      } else if (e.key.toLowerCase() === 'h') {
        toggleAllHeaders();
      } else if (e.key.toLowerCase() === 't') {
        toggleTopToolbar();
      }
    });

    function toggleMaximize(id) {
      const box = document.getElementById(`box-${id}`);
      if (!box) return;

      if (maximizedId === id) {
        box.classList.remove('is-maximized');
        maximizedId = null;
      } else {
        if (maximizedId !== null) {
          const prev = document.getElementById(`box-${maximizedId}`);
          if (prev) prev.classList.remove('is-maximized');
        }
        box.classList.add('is-maximized');
        maximizedId = id;
      }
    }

    function adjustZoom(id, delta) {
      const item = streams.find(s => s.id === id);
      if (!item) return;

      let newZoom = Math.round(((item.zoom || 1.0) + delta) * 10) / 10;
      newZoom = Math.min(Math.max(newZoom, 0.5), 2.0);
      item.zoom = newZoom;

      const label = document.getElementById(`zoom-txt-${id}`);
      if (label) label.innerText = `${Math.round(newZoom * 100)}%`;

      const wv = document.getElementById(`wv-${id}`);
      if (wv) wv.setZoomFactor(newZoom);
    }

    function toggleFreezeDetect(id) {
      const item = streams.find(s => s.id === id);
      if (!item) return;
      item.freezeDetect = !item.freezeDetect;
      const btn = document.getElementById(`freeze-btn-${id}`);
      if (btn) {
        btn.className = `btn-freeze ${item.freezeDetect ? 'active' : ''}`;
        btn.innerText = item.freezeDetect ? '🛡️ Guard' : '🛡️ Off';
      }
    }

    function setStreamVolume(id, value) {
      const wv = document.getElementById(`wv-${id}`);
      const label = document.getElementById(`vol-txt-${id}`);
      if (label) label.innerText = `${value}%`;

      const item = streams.find(s => s.id === id);
      if (item) item.volume = value;

      if (wv) {
        const volumeFraction = value / 100;
        wv.executeJavaScript(`
          (function() {
            const video = document.querySelector('video');
            if (video) video.volume = ${volumeFraction};
          })();
        `).catch(() => {});
      }
    }

    // แปลงข้อความในช่อง URL เป็นลิงก์ที่ใช้ได้ (พิมพ์ชื่อเว็บสั้น ๆ ก็โหลดได้)
    function parseUrlInput(raw) {
      let url = (raw || '').trim();
      if (!url || /^about:blank$/i.test(url)) return '';
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
      return 'https://' + url;
    }

    function loadUrl(id) {
      const input = document.getElementById(`input-${id}`);
      const wv = document.getElementById(`wv-${id}`);
      const url = parseUrlInput(input ? input.value : '');
      if (url && wv) {
        if (input) input.value = url;
        wv.src = url;
        const item = streams.find(s => s.id === id);
        if (item) item.url = url;
      }
    }

    function goBackUrl(id) {
      const wv = document.getElementById(`wv-${id}`);
      if (wv && wv.canGoBack()) wv.goBack();
    }

    function goForwardUrl(id) {
      const wv = document.getElementById(`wv-${id}`);
      if (wv && wv.canGoForward()) wv.goForward();
    }

    function updateNavButtons(id) {
      const wv = document.getElementById(`wv-${id}`);
      if (!wv) return;
      const backBtn = document.getElementById(`back-btn-${id}`);
      const fwdBtn = document.getElementById(`fwd-btn-${id}`);
      if (backBtn) backBtn.disabled = !wv.canGoBack();
      if (fwdBtn) fwdBtn.disabled = !wv.canGoForward();
    }

    // หน้าต่าง pop-out เปลี่ยนหน้าเว็บเอง → ซิงก์กลับช่อง URL ของจอหลัก
    ipcRenderer.on('popout-url-synced', (event, payload) => {
      if (!payload) return;
      const { streamId, url } = payload;
      const item = streams.find(s => s.id === streamId);
      if (!item || !url) return;
      item.url = url;
      const input = document.getElementById(`input-${streamId}`);
      if (input && document.activeElement !== input) input.value = url;
      saveToStorageSilent();
    });

    function reloadUrl(id) {
      const wv = document.getElementById(`wv-${id}`);
      if (wv) wv.reload();
    }

    function toggleAudio(targetId) {
      if (targetId === null) {
        streams.forEach(stream => {
          const wv = document.getElementById(`wv-${stream.id}`);
          const btn = document.getElementById(`audio-btn-${stream.id}`);
          const box = document.getElementById(`box-${stream.id}`);
          if (wv) wv.setAudioMuted(true);
          if (btn) { btn.innerText = '🔇'; btn.className = ''; }
          if (box) box.classList.remove('active-audio');
        });
        activeAudioId = null;
        multiAudioSet.clear();
        return;
      }

      if (multiAudioMode) {
        // โหมดเสียงหลายจอ: เปิด/ปิดเสียงอิสระทีละจอ
        const item = streams.find(s => s.id === targetId);
        if (!item) return;
        const willUnmute = !multiAudioSet.has(targetId);
        const wv = document.getElementById(`wv-${targetId}`);
        const btn = document.getElementById(`audio-btn-${targetId}`);
        const box = document.getElementById(`box-${targetId}`);
        if (wv) wv.setAudioMuted(!willUnmute);
        if (btn) {
          btn.innerText = willUnmute ? '🔊' : '🔇';
          btn.className = willUnmute ? 'unmuted' : '';
        }
        if (box) box.classList.toggle('active-audio', willUnmute);
        if (willUnmute) multiAudioSet.add(targetId); else multiAudioSet.delete(targetId);
      } else {
        activeAudioId = (activeAudioId === targetId) ? null : targetId;
        streams.forEach(stream => {
          const wv = document.getElementById(`wv-${stream.id}`);
          const btn = document.getElementById(`audio-btn-${stream.id}`);
          const box = document.getElementById(`box-${stream.id}`);
          const isTarget = stream.id === activeAudioId;
          if (wv) wv.setAudioMuted(!isTarget);
          if (btn) {
            btn.innerText = isTarget ? '🔊' : '🔇';
            btn.className = isTarget ? 'unmuted' : '';
          }
          if (box) box.classList.toggle('active-audio', isTarget);
        });
      }
    }

    function muteAll() {
      toggleAudio(null);
    }

    // เก็บลิงก์/ชื่อลง localStorage เงียบ ๆ (ใช้ตอน URL เปลี่ยนเองในเว็บ — ไม่เด้ง alert รบกวน)
    function saveToStorageSilent() {
      streams.forEach(s => {
        const input = document.getElementById(`input-${s.id}`);
        const nameInput = document.getElementById(`name-${s.id}`);
        if (input && document.activeElement !== input) s.url = input.value;
        if (nameInput && document.activeElement !== nameInput) s.name = nameInput.value.trim();
      });
      localStorage.setItem('saved_streams', JSON.stringify(streams));
      persistGeometry();
    }

    function saveToStorage() {
      // ในโหมดจัดเรียงเอง: ปุ่มบันทึกบน toolbar อัปเดตเลย์เอาต์ที่กำลังใช้ให้ด้วย (แก้ปัญหากดแล้วไม่เซฟ)
      if (layoutMode === 'custom') saveCurrentCustomLayout();

      streams.forEach(s => {
        const input = document.getElementById(`input-${s.id}`);
        const nameInput = document.getElementById(`name-${s.id}`);
        if (input) s.url = input.value;
        if (nameInput) s.name = nameInput.value.trim();
      });
      const loginUrlInput = document.getElementById('login-url-input');
      if (loginUrlInput) {
        localStorage.setItem('saved_login_url', loginUrlInput.value.trim());
      }
      localStorage.setItem('saved_streams', JSON.stringify(streams));
      persistGeometry();
      if (layoutMode !== 'custom') {
        alert('บันทึกการตั้งค่า ลิงก์ และหมายเหตุทั้งหมดเรียบร้อยแล้ว!');
      }
    }

    // ===== Auto-Update UI (รับสถานะจาก main process — ทำงานเมื่อติดตั้งแบบ NSIS) =====
    function installUpdateNow() {
      const b = document.getElementById('update-banner');
      if (b && b.dataset.ready === '1') ipcRenderer.send('install-update');
    }

    ipcRenderer.on('update-status', (e, st) => {
      const b = document.getElementById('update-banner');
      if (!b) return;
      if (st.state === 'ready') {
        b.textContent = '⬆️ อัปเดต PitchView ' + (st.version || '') + ' พร้อมติดตั้ง — คลิกเพื่อรีสตาร์ท';
        b.dataset.ready = '1';
        b.classList.add('show');
      } else if (st.state === 'progress') {
        b.textContent = '⬇️ กำลังดาวน์โหลดอัปเดต ' + st.percent + '%';
        b.classList.add('show');
      } else if (st.state === 'downloading') {
        b.textContent = '⬇️ เจอเวอร์ชันใหม่ ' + (st.version || '') + ' — กำลังดาวน์โหลด...';
        b.classList.add('show');
      } else {
        b.classList.remove('show');
      }
    });

    // Debug/Test hook: เข้าถึงสถานะภายในจาก console หรือชุดทดสอบอัตโนมัติ (ไม่กระทบการใช้งานปกติ)
    window.__pv = {
      get: function (k) {
        var s = { gridLocked: gridLocked, multiAudioMode: multiAudioMode, activeAudioId: activeAudioId, activeLayoutIndex: activeLayoutIndex, layoutMode: layoutMode, multiAudioSet: multiAudioSet, customLayouts: customLayouts, streams: streams, boxGeometry: boxGeometry };
        return s[k];
      },
      set: function (k, v) {
        if (k === 'gridLocked') gridLocked = v;
        else if (k === 'multiAudioMode') multiAudioMode = v;
        else if (k === 'activeLayoutIndex') activeLayoutIndex = v;
        else if (k === 'layoutMode') layoutMode = v;
      },
      resetLayouts: function () { customLayouts = []; activeLayoutIndex = -1; persistCustomLayouts(); }
    };

    initGrid();
    applyLayoutMode();
    renderCustomPresetUI();
    updateGridLockUI();

    // คืนค่าที่บันทึกไว้ตอนเปิดแอป: ธีมสี / โปร่งใส / โหมดเสียงหลายจอ
    const savedAccent = localStorage.getItem('saved_accent');
    if (savedAccent) applyAccent(savedAccent, false);
    const savedOpacity = parseInt(localStorage.getItem('saved_window_opacity') || '100', 10);
    if (savedOpacity !== 100) {
      const osl = document.getElementById('opacity-slider');
      if (osl) osl.value = savedOpacity;
      setWindowOpacity(savedOpacity);
    }
    multiAudioMode = localStorage.getItem('saved_multi_audio') === '1';
    const maToggle = document.getElementById('multi-audio-toggle');
    if (maToggle) maToggle.checked = multiAudioMode;

    if (mainPinned) ipcRenderer.send('set-main-pinned', true);
    applyPinnedUI();
