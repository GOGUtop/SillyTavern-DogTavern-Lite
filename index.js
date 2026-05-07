/**
 * 🐶🦴TOP v1.5.3
 * 修复：关于弹窗消失 / 通知降级为振动
 */

(function () {
    'use strict';

    const PLUGIN_NAME = 'DogTop';
    const LS_KEY = 'dog_top_settings';
    const POS_KEY = 'dog_top_folder_pos';

    const defaultSettings = {
        soundEnabled: true,
        translateEnabled: true,
        floatEnabled: true,
        notificationEnabled: true
    };
    let settings = { ...defaultSettings };
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved) settings = { ...defaultSettings, ...JSON.parse(saved) };
    } catch (e) {}
    function saveSettings() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
    }

    let lastErrorMsg = '';
    let lastErrorTime = 0;

    // ====================================================
    // 能力检测（不判断浏览器品牌，直接检测API）
    // ====================================================
    const NOTIF_SUPPORTED = ('Notification' in window);
    const VIBRATE_SUPPORTED = ('vibrate' in navigator);

    function getAlertCapability() {
        const caps = [];
        if (NOTIF_SUPPORTED && Notification.permission === 'granted') caps.push('通知');
        if (VIBRATE_SUPPORTED) caps.push('振动');
        if (caps.length === 0) caps.push('仅Toast');
        return caps.join('+');
    }

    // ====================================================
    // 系统通知 + 振动
    // ====================================================
    function requestNotificationPermission() {
        if (!NOTIF_SUPPORTED) return;
        if (Notification.permission === 'granted') return;
        if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(perm => {
                if (perm === 'granted') {
                    showToast('🔔 通知权限已获取！', 3000);
                }
            });
        }
    }

    function vibrateDevice(pattern) {
        if (!VIBRATE_SUPPORTED) return;
        try { navigator.vibrate(pattern || [200, 100, 200]); } catch (e) {}
    }

    function sendSystemNotification(title, body) {
        if (!settings.notificationEnabled) return;
        if (document.visibilityState === 'visible') return;

        // 振动（大多数安卓浏览器都支持）
        vibrateDevice([200, 100, 200, 100, 300]);

        // 系统通知（如果支持）
        if (NOTIF_SUPPORTED && Notification.permission === 'granted') {
            try {
                const notification = new Notification(title, {
                    body: body,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🐶</text></svg>',
                    tag: 'dog-top-' + Date.now(),
                    requireInteraction: false,
                    silent: false
                });
                notification.onclick = () => { window.focus(); notification.close(); };
                setTimeout(() => { try { notification.close(); } catch (e) {} }, 8000);
            } catch (e) {}
        }
    }

    // ====================================================
    // 错误码字典
    // ====================================================
    const ERROR_DICT = [
        { re: /HTTP\s*401|unauthorized|invalid[_\s-]?api[_\s-]?key|incorrect api key/i, tag: '🔑 密钥错误', level: 'err', cn: 'API 密钥无效或已失效', fix: '检查 API Key 是否填错、是否过期、是否多了空格。重新去服务商后台复制一次。' },
        { re: /HTTP\s*402|insufficient[_\s]?quota|insufficient[_\s]?balance|billing|credit/i, tag: '💰 余额不足', level: 'err', cn: '账户余额不足或配额用完', fix: '去 API 服务商后台充值；或换一个有余额的 Key。' },
        { re: /HTTP\s*403|forbidden|permission[_\s]?denied|access[_\s]?denied/i, tag: '🚫 无权限', level: 'err', cn: '请求被拒绝', fix: '检查 Key 权限范围；OpenAI 要挂代理；中转站可能限制了你的 IP。' },
        { re: /HTTP\s*404|model[_\s]?not[_\s]?found|no available channel for model/i, tag: '❓ 模型未找到', level: 'err', cn: '请求的模型不存在或当前渠道不支持', fix: '① 检查模型名拼写\n② 中转站可能没开通该模型' },
        { re: /HTTP\s*429|rate[_\s]?limit|too many requests/i, tag: '🐢 请求过快', level: 'warn', cn: '请求频率超限', fix: '等待几秒重试；降低请求频率；或换其他 Key。' },
        { re: /HTTP\s*500|internal[_\s]?server[_\s]?error/i, tag: '💥 服务器爆炸', level: 'err', cn: '服务端 500 错误', fix: '等几分钟重试。' },
        { re: /HTTP\s*502|bad[_\s]?gateway/i, tag: '🌐 网关错误', level: 'err', cn: '中间网关挂了', fix: '等等再试或换渠道。' },
        { re: /HTTP\s*503|service[_\s]?unavailable|overloaded/i, tag: '⚠️ 服务过载', level: 'err', cn: '服务暂时不可用', fix: '等30秒重试；或切备用渠道。' },
        { re: /HTTP\s*504|gateway[_\s]?timeout|timeout/i, tag: '⏰ 超时', level: 'warn', cn: '请求超时', fix: '减少历史消息、降低 max_tokens；或换更快的渠道。' },
        { re: /content[_\s]?policy|content[_\s]?filter|safety|usage policies/i, tag: '🛡️ 内容审核', level: 'err', cn: '内容触发审核', fix: '① 修改触发词\n② 换不审核的模型' },
        { re: /context[_\s]?length[_\s]?exceeded|maximum context length|too many tokens/i, tag: '📏 上下文超长', level: 'err', cn: 'token 数超过限制', fix: '① 减少世界书/角色卡\n② 降低历史层数\n③ 换大窗口模型' },
        { re: /invalid[_\s]?request[_\s]?error|invalid_parameter/i, tag: '📝 参数错误', level: 'err', cn: '请求参数格式有误', fix: '检查 temperature/top_p 是否超范围。' },
        { re: /prompt is too long|prompt_too_long/i, tag: '📏 输入过长', level: 'err', cn: '输入过长', fix: '减少历史/世界书。' },
        { re: /credit balance is too low/i, tag: '💰 余额低', level: 'err', cn: '账户余额过低', fix: '去服务商充值。' },
        { re: /claude.*overloaded|anthropic.*overload/i, tag: '⚠️ Claude过载', level: 'err', cn: 'Claude 服务过载', fix: '等30秒重试。' },
        { re: /google.*api.*key.*not.*valid|API_KEY_INVALID/i, tag: '🔑 Gemini Key 无效', level: 'err', cn: 'Google API Key 无效', fix: '去 aistudio.google.com 重新生成。' },
        { re: /RESOURCE_EXHAUSTED/i, tag: '💰 Gemini配额用完', level: 'err', cn: 'Gemini 配额已用完', fix: '等明天重置。' },
        { re: /SAFETY|finishReason.*SAFETY/i, tag: '🛡️ Gemini安全过滤', level: 'err', cn: 'Gemini 安全过滤拦截', fix: '把安全等级设为 BLOCK_NONE。' },
        { re: /failed to fetch|network[_\s]?error|ECONNREFUSED/i, tag: '📡 网络错误', level: 'err', cn: '无法连接到服务器', fix: '① 检查代理\n② API 地址写错\n③ 服务器宕机' },
        { re: /ETIMEDOUT|ESOCKETTIMEDOUT/i, tag: '⏰ 连接超时', level: 'warn', cn: '连接超时', fix: '检查网络/代理。' },
        { re: /CORS|cross[_\s]?origin/i, tag: '🚧 跨域错误', level: 'err', cn: 'CORS 被拦截', fix: '中转站没配置 CORS。' },
        { re: /SSL|certificate|self[_\s]?signed/i, tag: '🔒 SSL错误', level: 'err', cn: 'SSL 证书校验失败', fix: '换 https 正规站。' },
        { re: /no[_\s]?available[_\s]?channel/i, tag: '🔌 无可用渠道', level: 'err', cn: '没有可用渠道', fix: '后台启用对应模型渠道。' },
        { re: /unexpected token|JSON\.parse|SyntaxError/i, tag: '📝 JSON解析失败', level: 'err', cn: '响应不是合法 JSON', fix: '上游返回了 HTML 错误页。' },
        { re: /stream.*error|sse.*error/i, tag: '📡 流式错误', level: 'err', cn: '流式响应中断', fix: '关闭 streaming 试试。' },
        { re: /error/i, tag: '⚠️ 通用错误', level: 'warn', cn: '检测到错误信息', fix: '查看下方机翻获取详细内容。' },
    ];

    function matchErrorDict(text) {
        if (!text) return null;
        for (const item of ERROR_DICT) if (item.re.test(text)) return item;
        return null;
    }

    function isMobileDevice() {
        return window.innerWidth < 768 || ('ontouchstart' in window) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }

    // ============ Toast ============
    function showToast(msg, duration = 2500) {
        const old = document.getElementById('dog-toast');
        if (old) old.remove();
        const t = document.createElement('div');
        t.id = 'dog-toast';
        t.textContent = msg;
        const mobile = isMobileDevice();
        const posCss = mobile ? 'left:50%;top:18%;transform:translateX(-50%);' : 'left:50%;top:50%;transform:translate(-50%,-50%);';
        t.style.cssText = `position:fixed;${posCss}z-index:2147483647;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:14px 24px;border-radius:30px;font-size:15px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.5),0 0 0 2px rgba(255,255,255,0.15);font-family:-apple-system,sans-serif;max-width:80vw;text-align:center;white-space:pre-line;pointer-events:none;opacity:0;transition:opacity .25s ease;`;
        document.body.appendChild(t);
        requestAnimationFrame(() => { t.style.opacity = '1'; });
        setTimeout(() => { t.style.opacity = '0'; }, duration - 300);
        setTimeout(() => { try { t.remove(); } catch (e) {} }, duration);
    }

    // ============ 提示音 ============
    let audioCtx = null;
    function playSound() {
        if (!settings.soundEnabled) return;
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const now = audioCtx.currentTime;
            [[880, 0], [1320, 0.12]].forEach(([freq, delay]) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + delay);
                gain.gain.linearRampToValueAtTime(0.25, now + delay + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + delay); osc.stop(now + delay + 0.4);
            });
        } catch (e) {}
    }

    function stripHtml(s) {
        return (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
    }

    // ============ 卡片风格 ============
    const STYLES = [
        { idx:0, emoji:'🌙', name:'暮光紫', desc:'深邃·浪漫', bg1:'#2d1b69', bg2:'#11001c', accent:'#b388ff', text:'#e8e0f0', nameC:'#ce93d8', quote:'#b388ff', spark:'#e1bee7', btnBg:'linear-gradient(135deg,#2d1b69,#4a148c)', btnColor:'#e1bee7' },
        { idx:1, emoji:'🌸', name:'樱花粉', desc:'柔美·温暖', bg1:'#fff0f3', bg2:'#fce4ec', accent:'#f48fb1', text:'#4a2c3d', nameC:'#c2185b', quote:'#f48fb1', spark:'#f8bbd0', btnBg:'linear-gradient(135deg,#fce4ec,#f48fb1)', btnColor:'#4a2c3d' },
        { idx:2, emoji:'☕', name:'暖茶棕', desc:'典雅·复古', bg1:'#f5f0e6', bg2:'#e8dfc8', accent:'#8d6e63', text:'#3e2723', nameC:'#5d4037', quote:'#a1887f', spark:'#bcaaa4', btnBg:'linear-gradient(135deg,#f5f0e6,#a1887f)', btnColor:'#3e2723' },
        { idx:3, emoji:'🌊', name:'月光蓝', desc:'清透·宁静', bg1:'#0a1628', bg2:'#1a237e', accent:'#82b1ff', text:'#e3f2fd', nameC:'#90caf9', quote:'#64b5f6', spark:'#bbdefb', btnBg:'linear-gradient(135deg,#0a1628,#1565c0)', btnColor:'#e3f2fd' },
        { idx:4, emoji:'🌅', name:'晚霞橙', desc:'温暖·治愈', bg1:'#3e1f00', bg2:'#1a0a00', accent:'#ffab91', text:'#fff3e0', nameC:'#ffcc80', quote:'#ff8a65', spark:'#ffe0b2', btnBg:'linear-gradient(135deg,#3e1f00,#ff8a65)', btnColor:'#fff3e0' },
        { idx:5, emoji:'🏔', name:'墨韵青', desc:'水墨·淡雅', bg1:'#eceff1', bg2:'#cfd8dc', accent:'#546e7a', text:'#263238', nameC:'#37474f', quote:'#78909c', spark:'#90a4ae', btnBg:'linear-gradient(135deg,#eceff1,#78909c)', btnColor:'#263238' }
    ];

    function loadImage(url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => { const img2 = new Image(); img2.onload = () => resolve(img2); img2.onerror = () => resolve(null); img2.src = url; };
            img.src = url;
        });
    }

    async function drawPosterCard(rawText, charName, avatarUrl, styleIdx) {
        const st = STYLES[Math.max(0, Math.min(STYLES.length - 1, styleIdx))];
        const cleanText = stripHtml(rawText);
        const displayText = cleanText.length > 600 ? cleanText.slice(0, 600) + '…' : cleanText;
        const W = 1080, padding = 80;
        const canvas = document.createElement('canvas'); canvas.width = W;
        const ctx = canvas.getContext('2d');
        ctx.font = '40px "Songti SC","Noto Serif SC","SimSun",serif';
        const lines = wrapText(ctx, displayText, W - padding * 2);
        const lineHeight = 54, textBlockH = lines.length * lineHeight;
        const headerH = 200, footerH = 120, quoteGap = 110;
        const totalH = Math.max(900, headerH + quoteGap + textBlockH + 60 + footerH);
        canvas.height = totalH;
        const g = ctx.createLinearGradient(0, 0, 0, totalH);
        g.addColorStop(0, st.bg1); g.addColorStop(1, st.bg2);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, totalH);
        const seed = hashCode(charName + styleIdx), rand = mulberry32(seed);
        ctx.fillStyle = st.spark;
        for (let i = 0; i < 35; i++) { ctx.globalAlpha = rand() * 0.25 + 0.08; ctx.beginPath(); ctx.arc(rand() * W, rand() * totalH, rand() * 2.5 + 0.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.accent; ctx.globalAlpha = 0.7; ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, totalH - 5, W, 5); ctx.globalAlpha = 1;
        const avatarSize = 120, ax = padding + avatarSize / 2, ay = padding + avatarSize / 2;
        const avatar = await loadImage(avatarUrl);
        ctx.strokeStyle = st.accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2 + 6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        if (avatar) { ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, ax - avatarSize / 2, ay - avatarSize / 2, avatarSize, avatarSize); ctx.restore(); }
        else { ctx.fillStyle = st.accent; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(charName ? charName.charAt(0) : '?', ax, ay); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; }
        const nameX = ax + avatarSize / 2 + 28;
        ctx.fillStyle = st.nameC; ctx.font = 'bold 48px -apple-system,sans-serif'; ctx.fillText(charName || '未知角色', nameX, ay - 8);
        ctx.fillStyle = st.text; ctx.globalAlpha = 0.55; ctx.font = '24px -apple-system,sans-serif'; ctx.fillText(`— ${st.name} · 高光剪报 —`, nameX, ay + 36); ctx.globalAlpha = 1;
        const divY = headerH;
        const lg = ctx.createLinearGradient(padding, divY, W - padding, divY);
        lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, st.accent); lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padding, divY); ctx.lineTo(W - padding, divY); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = st.quote; ctx.globalAlpha = 0.6; ctx.font = 'bold 160px "Songti SC",serif'; ctx.fillText('\u201C', padding - 5, divY + 110); ctx.globalAlpha = 1;
        ctx.fillStyle = st.text; ctx.font = '40px "Songti SC","Noto Serif SC",serif';
        const textTop = divY + quoteGap;
        lines.forEach((line, i) => ctx.fillText(line, padding, textTop + i * lineHeight + 40));
        ctx.fillStyle = st.quote; ctx.globalAlpha = 0.4; ctx.font = 'bold 100px "Songti SC",serif'; ctx.fillText('\u201D', W - padding - 80, textTop + textBlockH + 20); ctx.globalAlpha = 1;
        const fDivY = textTop + textBlockH + 40;
        const lg2 = ctx.createLinearGradient(padding, fDivY, W - padding, fDivY);
        lg2.addColorStop(0, 'rgba(0,0,0,0)'); lg2.addColorStop(0.5, st.accent); lg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = lg2; ctx.lineWidth = 2; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(padding, fDivY); ctx.lineTo(W - padding, fDivY); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = st.text; ctx.globalAlpha = 0.65; ctx.font = 'bold 26px -apple-system,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🐶🦴TOP · SillyTavern', W / 2, fDivY + 50);
        ctx.globalAlpha = 0.45; ctx.font = '20px -apple-system,sans-serif';
        const date = new Date();
        ctx.fillText(`${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`, W / 2, fDivY + 80);
        ctx.globalAlpha = 1; ctx.textAlign = 'start';
        return canvas;
    }

    function wrapText(ctx, text, maxWidth) {
        const out = [], paragraphs = text.split('\n');
        for (const para of paragraphs) { if (!para) { out.push(''); continue; } let line = ''; for (const ch of para) { const test = line + ch; if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = ch; } else line = test; } if (line) out.push(line); }
        return out;
    }
    function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return h >>> 0; }
    function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function saveCanvas(canvas, filename) {
        canvas.toBlob((blob) => {
            if (!blob) { showToast('❌ 生成失败'); return; }
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
            showToast('🎉 已保存到下载目录汪～', 3000);
        }, 'image/png');
    }
    async function generateCard(text, charName, avatarUrl, styleIdx) {
        showToast('🎨 正在绘制精美卡片汪～', 1500);
        try { const canvas = await drawPosterCard(text, charName, avatarUrl, styleIdx); saveCanvas(canvas, `DogTop_Card_${Date.now()}.png`); }
        catch (e) { showToast('❌ 生成失败：' + e.message, 3500); }
    }

    // ============ 微软翻译 ============
    let edgeAuthToken = null, edgeAuthExpire = 0;
    async function getEdgeToken() {
        if (edgeAuthToken && Date.now() < edgeAuthExpire) return edgeAuthToken;
        const res = await fetch('https://edge.microsoft.com/translate/auth');
        const tk = await res.text(); edgeAuthToken = tk; edgeAuthExpire = Date.now() + 8 * 60 * 1000; return tk;
    }
    async function translateByEdge(text, toLang) {
        const token = await getEdgeToken();
        const res = await fetch(`https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${toLang}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ Text: text }]) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return { text: data[0].translations[0].text, from: data[0].detectedLanguage ? data[0].detectedLanguage.language : 'auto' };
    }

    // ============ 划词翻译 ============
    function injectTranslateUI() {
        if (document.querySelector('[data-dog-tr-btn]')) return;
        const btn = document.createElement('div');
        btn.setAttribute('data-dog-tr-btn', '1');
        btn.style.cssText = 'position:fixed;display:none;z-index:2147483646;background:linear-gradient(135deg,#ff6b6b,#ee5a6f);color:#fff;width:34px;height:34px;border-radius:50%;align-items:center;justify-content:center;cursor:pointer;font-size:16px;box-shadow:0 3px 10px rgba(255,107,107,0.5);user-select:none;-webkit-user-select:none;';
        btn.innerHTML = '🌐'; document.body.appendChild(btn);
        let lastSel = '';
        function update() {
            if (!settings.translateEnabled) { btn.style.display = 'none'; return; }
            const sel = window.getSelection(); const txt = sel ? sel.toString().trim() : '';
            if (!txt || txt.length < 1) { btn.style.display = 'none'; return; }
            lastSel = txt;
            try { const r = sel.getRangeAt(0).getBoundingClientRect(); let top = r.bottom + 8, left = r.right + 6; if (left + 40 > window.innerWidth) left = r.left - 40; if (top + 40 > window.innerHeight) top = r.top - 40; btn.style.top = top + 'px'; btn.style.left = left + 'px'; btn.style.display = 'flex'; btn._txt = txt; } catch (e) { btn.style.display = 'none'; }
        }
        document.addEventListener('selectionchange', () => setTimeout(update, 50));
        window.addEventListener('scroll', () => { btn.style.display = 'none'; }, true);
        const fire = (e) => { e.preventDefault(); e.stopPropagation(); const t = btn._txt || lastSel; btn.style.display = 'none'; if (t) showTranslateBubble(t, e.clientX || 100, e.clientY || 100); };
        btn.addEventListener('click', fire); btn.addEventListener('touchend', fire, { passive: false });
    }

    function showTranslateBubble(text, x, y) {
        document.querySelectorAll('.dog-tr-bubble').forEach(el => el.remove());
        const bubble = document.createElement('div'); bubble.className = 'dog-tr-bubble';
        const top = Math.min(y + 20, window.innerHeight - 240), left = Math.min(Math.max(x - 150, 10), window.innerWidth - 320);
        bubble.style.cssText = `position:fixed;top:${top}px;left:${left}px;width:300px;background:rgba(255,255,255,0.98);border:2px solid #ff6b6b;border-radius:12px;padding:14px;z-index:2147483646;box-shadow:0 6px 24px rgba(255,107,107,0.4);font-size:14px;color:#333;font-family:-apple-system,sans-serif;`;
        bubble.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="color:#ff6b6b;font-weight:700;font-size:13px;">🌐 翻译中...</span><span class="dog-tr-close" style="cursor:pointer;color:#999;font-size:18px;line-height:1;">×</span></div><div class="dog-tr-content" style="line-height:1.6;color:#666;font-size:14px;">⚡ 调用中...</div>`;
        document.body.appendChild(bubble);
        bubble.querySelector('.dog-tr-close').onclick = () => bubble.remove();
        const off = (e) => { if (!bubble.contains(e.target)) { bubble.remove(); document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); } };
        setTimeout(() => { document.addEventListener('mousedown', off); document.addEventListener('touchstart', off, { passive: true }); }, 200);
        const target = /[\u4e00-\u9fa5]/.test(text) ? 'en' : 'zh-Hans';
        translateByEdge(text, target).then(({ text: translated, from }) => {
            bubble.querySelector('span').innerHTML = `🌐 ${from} → ${target} ⚡`;
            const c = bubble.querySelector('.dog-tr-content'); c.style.color = '#333';
            c.innerHTML = `<div style="margin-bottom:10px;line-height:1.6;">${translated.replace(/</g,'&lt;')}</div><div style="text-align:right;"><button class="dog-tr-copy" style="padding:5px 14px;border:1px solid #ff6b6b;background:#fff;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">📋 复制</button></div>`;
            bubble.querySelector('.dog-tr-copy').onclick = (e) => { navigator.clipboard.writeText(translated).then(() => { e.target.textContent = '✅ 已复制'; setTimeout(() => { e.target.textContent = '📋 复制'; }, 1500); }).catch(() => {}); };
        }).catch(err => { bubble.querySelector('.dog-tr-content').innerHTML = `<div style="color:#ff6b6b;">❌ 翻译失败<br><small style="color:#999;">${err.message}</small></div>`; });
    }

    // ============ 错误码捕获 ============
    function injectErrorCatcher() {
        if (window._dogErrorCatcher) return; window._dogErrorCatcher = true;
        const captureFromEl = (el) => { try { const txt = (el.innerText || el.textContent || '').trim(); if (txt && txt.length > 3) { lastErrorMsg = txt; lastErrorTime = Date.now(); } } catch (e) {} };
        new MutationObserver((ms) => { ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.classList && (n.classList.contains('toast-error') || n.classList.contains('toast-warning'))) captureFromEl(n); if (n.querySelectorAll) n.querySelectorAll('.toast-error,.toast-warning').forEach(captureFromEl); })); }).observe(document.body, { childList: true, subtree: true });
        if (!window._dogFetchErrCaught) { window._dogFetchErrCaught = true; const origFetch = window.fetch; window.fetch = async function () { const res = await origFetch.apply(this, arguments); try { if (!res.ok && res.clone) { const c = res.clone(); c.text().then(body => { if (body && body.length > 3 && body.length < 5000) { lastErrorMsg = `[HTTP ${res.status}] ${body}`; lastErrorTime = Date.now(); } }).catch(() => {}); } } catch (e) {} return res; }; }
    }

    function showErrorTranslate() {
        if (!lastErrorMsg) { showToast('🌟 暂无错误记录\n出现红色错误后再点这里', 3500); return; }
        const ageMin = Math.floor((Date.now() - lastErrorTime) / 60000);
        const ageStr = ageMin < 1 ? '刚刚' : ageMin + '分钟前';
        const dictHit = matchErrorDict(lastErrorMsg);
        document.querySelectorAll('.dog-err-modal').forEach(el => el.remove());

        const wrapper = document.createElement('div'); wrapper.className = 'dog-modal-wrapper dog-err-modal';
        const levelColor = dictHit ? (dictHit.level === 'err' ? '#ff5e5e' : '#ffa726') : '#9e9e9e';
        const dictHtml = dictHit ? `<div style="background:linear-gradient(135deg,rgba(102,126,234,0.18),rgba(118,75,162,0.18));border:1px solid rgba(130,177,255,0.35);border-radius:12px;padding:14px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="background:${levelColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;">📖 命中</span><span style="color:#fff;font-weight:700;font-size:15px;">${dictHit.tag}</span></div><div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px 12px;margin-bottom:8px;"><div style="font-size:11px;color:#a8c1ff;font-weight:700;margin-bottom:4px;">💡 说明</div><div style="font-size:13px;color:#fff;line-height:1.6;">${dictHit.cn}</div></div><div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px 12px;"><div style="font-size:11px;color:#80e0a8;font-weight:700;margin-bottom:4px;">🔧 方案</div><div style="font-size:13px;color:#e0ffe8;line-height:1.7;white-space:pre-wrap;">${dictHit.fix}</div></div></div>` : `<div style="background:rgba(255,167,38,0.12);border:1px dashed rgba(255,167,38,0.4);border-radius:10px;padding:10px 12px;margin-bottom:12px;text-align:center;"><span style="color:#ffb74d;font-size:12px;">📖 字典未命中，看下方机翻 ↓</span></div>`;
        wrapper.innerHTML = `<div class="dog-modal-panel" style="max-width:560px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><span style="font-size:18px;font-weight:700;color:#fff;">🩺 错误码翻译</span><span style="font-size:11px;color:rgba(255,255,255,0.5);">${ageStr}</span></div>${dictHtml}<div style="background:rgba(255,107,107,0.12);border-left:3px solid #ff6b6b;padding:10px 12px;border-radius:8px;margin-bottom:12px;max-height:140px;overflow:auto;"><div style="font-size:11px;color:#ff9999;font-weight:700;margin-bottom:4px;">📋 原文</div><div style="font-size:12px;color:#ffe0e0;line-height:1.5;font-family:monospace;word-break:break-all;white-space:pre-wrap;">${lastErrorMsg.replace(/</g,'&lt;')}</div></div><div style="background:rgba(130,177,255,0.12);border-left:3px solid #82b1ff;padding:10px 12px;border-radius:8px;margin-bottom:14px;max-height:160px;overflow:auto;"><div style="font-size:11px;color:#a8c1ff;font-weight:700;margin-bottom:4px;">🌐 机翻</div><div id="dog-err-tr" style="font-size:12px;color:#e0e8ff;line-height:1.6;">⚡ 翻译中...</div></div><div style="display:flex;gap:8px;"><button id="dog-err-copy" style="flex:1;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#ff6b6b,#ee5a6f);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">📋 复制</button><button id="dog-err-close" style="flex:1;padding:10px;border:none;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">关闭</button></div></div>`;
        document.body.appendChild(wrapper);

        setTimeout(() => {
            wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
            wrapper.querySelector('#dog-err-close').onclick = () => wrapper.remove();
            wrapper.querySelector('#dog-err-copy').onclick = (e) => { navigator.clipboard.writeText(lastErrorMsg).then(() => { e.target.textContent = '✅'; setTimeout(() => { e.target.textContent = '📋 复制'; }, 1500); }).catch(() => {}); };
        }, 100);

        translateByEdge((lastErrorMsg.length > 1500 ? lastErrorMsg.slice(0, 1500) : lastErrorMsg), 'zh-Hans').then(({ text }) => { const el = wrapper.querySelector('#dog-err-tr'); if (el) el.innerHTML = text.replace(/</g,'&lt;').replace(/\n/g,'<br>'); }).catch(err => { const el = wrapper.querySelector('#dog-err-tr'); if (el) el.innerHTML = `<span style="color:#ff9999;">❌ ${err.message}</span>`; });
    }

    // ====================================================
    // 🐾 悬浮球
    // ====================================================
    let folderEl = null;
    let currentSnappedSide = 'right';
    let currentTop = null;
    let isMenuOpen = false;

    function showFloatingMenu() { if (folderEl) { folderEl.style.display = ''; return; } injectFloatingMenu(); }
    function hideFloatingMenu() { if (folderEl) folderEl.style.display = 'none'; }

    function applySnap(animate) {
        if (!folderEl) return;
        const ballSize = 54;
        folderEl.style.transition = animate ? 'left 0.3s ease' : 'none';
        if (currentSnappedSide === 'right') {
            folderEl.style.left = (window.innerWidth - ballSize / 2) + 'px';
        } else {
            folderEl.style.left = (-ballSize / 2) + 'px';
        }
        folderEl.style.right = 'auto';
        folderEl.style.transform = 'none';
    }

    function applyExpanded() {
        if (!folderEl) return;
        const ballSize = 54;
        const margin = 8;
        folderEl.style.transition = 'left 0.2s ease';
        if (currentSnappedSide === 'right') {
            folderEl.style.left = (window.innerWidth - ballSize - margin) + 'px';
        } else {
            folderEl.style.left = margin + 'px';
        }
    }

    function savePosition() {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ top: currentTop, side: currentSnappedSide })); } catch (e) {}
    }

    function injectFloatingMenu() {
        if (document.querySelector('[data-dog-tool-folder]')) {
            folderEl = document.querySelector('[data-dog-tool-folder]');
            return;
        }

        try {
            const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            if (saved) {
                if (typeof saved.top === 'number') currentTop = saved.top;
                if (saved.side === 'left' || saved.side === 'right') currentSnappedSide = saved.side;
            }
        } catch (e) {}
        if (currentTop === null) currentTop = window.innerHeight * 0.45;

        const folder = document.createElement('div');
        folder.setAttribute('data-dog-tool-folder', '1');
        folder.className = 'dog-folder-v2';
        folderEl = folder;
        folder.style.top = currentTop + 'px';
        applySnap(false);

        const trigger = document.createElement('div');
        trigger.className = 'dog-trigger-v2';
        trigger.textContent = '🐾';

        const panel = document.createElement('div');
        panel.className = 'dog-panel-v2';

        function row(iconBg, emoji, title, desc, onTap, badge) {
            const r = document.createElement('div'); r.className = 'dog-row-v2';
            r.innerHTML = `<div class="ico" style="background:${iconBg};">${emoji}</div><div class="meta"><div class="title">${title}${badge || ''}</div><div class="desc">${desc}</div></div><div class="arrow">›</div>`;
            r.addEventListener('click', (e) => { e.stopPropagation(); onTap(); collapse(); });
            return r;
        }

        function buildPanel() {
            panel.innerHTML = '';
            panel.classList.remove('panel-left', 'panel-right');
            panel.classList.add(currentSnappedSide === 'left' ? 'panel-left' : 'panel-right');

            const hd = document.createElement('div'); hd.className = 'dog-header-v2';
            hd.innerHTML = `<span class="logo">🐶🦴</span><span class="name">🐶🦴TOP</span><span class="ver">v1.5.3</span>`;
            panel.appendChild(hd);
            panel.appendChild(Object.assign(document.createElement('div'), { className: 'dog-divider-v2' }));

            // 提示音
            panel.appendChild(row('linear-gradient(135deg,#667eea,#764ba2)', settings.soundEnabled ? '🔊' : '🔇', '提示音', settings.soundEnabled ? '回复完成叮咚' : '已静音', () => { settings.soundEnabled = !settings.soundEnabled; saveSettings(); showToast(settings.soundEnabled ? '🔊 已开启' : '🔇 已关闭'); if (settings.soundEnabled) playSound(); syncToExtPanel(); }, settings.soundEnabled ? '<span class="dog-badge-on">ON</span>' : '<span class="dog-badge-off">OFF</span>'));

            // 划词翻译
            panel.appendChild(row('linear-gradient(135deg,#ff6b6b,#ee5a6f)', settings.translateEnabled ? '🌐' : '🚫', '划词翻译', settings.translateEnabled ? '选中文字弹出翻译' : '已禁用', () => { settings.translateEnabled = !settings.translateEnabled; saveSettings(); showToast(settings.translateEnabled ? '🌐 已开启' : '🚫 已关闭'); syncToExtPanel(); }, settings.translateEnabled ? '<span class="dog-badge-on">ON</span>' : '<span class="dog-badge-off">OFF</span>'));

            // 后台提醒
            const notifDesc = settings.notificationEnabled
                ? (NOTIF_SUPPORTED ? '通知+振动提醒' : (VIBRATE_SUPPORTED ? '振动提醒' : '仅Toast提醒'))
                : '已禁用';
            panel.appendChild(row('linear-gradient(135deg,#43e97b,#38f9d7)', settings.notificationEnabled ? '🔔' : '🔕', '后台提醒', notifDesc, () => {
                settings.notificationEnabled = !settings.notificationEnabled;
                saveSettings();
                if (settings.notificationEnabled) {
                    if (NOTIF_SUPPORTED) requestNotificationPermission();
                    vibrateDevice([100, 50, 100]);
                    const capStr = getAlertCapability();
                    showToast(`🔔 后台提醒已开启\n当前支持：${capStr}`, 3500);
                } else {
                    showToast('🔕 后台提醒已关闭');
                }
                syncToExtPanel();
            }, settings.notificationEnabled ? '<span class="dog-badge-on">ON</span>' : '<span class="dog-badge-off">OFF</span>'));

            panel.appendChild(Object.assign(document.createElement('div'), { className: 'dog-divider-v2' }));

            // 错误码翻译
            panel.appendChild(row('linear-gradient(135deg,#eb3349,#f45c43)', '🩺', '错误码翻译', '字典+机翻 解析报错', showErrorTranslate));

            // 生成卡片
            panel.appendChild(row('linear-gradient(135deg,#f093fb,#f5576c)', '🔖', '生成卡片', '选中AI文字后弹出', () => showToast('💡 先选中AI消息文字\n再点弹出的"生成卡片"', 3500)));

            panel.appendChild(Object.assign(document.createElement('div'), { className: 'dog-divider-v2' }));

            // 测试提示音
            panel.appendChild(row('linear-gradient(135deg,#fa709a,#fee140)', '🎵', '测试提示音', '试听叮咚声', () => { if (!settings.soundEnabled) { showToast('🔇 声音已关闭'); return; } playSound(); showToast('🎵 叮咚~'); }));

            // 测试提醒
            panel.appendChild(row('linear-gradient(135deg,#a18cd1,#fbc2eb)', '🔔', '测试提醒', '测试振动/通知', () => {
                if (!settings.notificationEnabled) { showToast('🔕 后台提醒已关闭'); return; }

                // 先振动
                vibrateDevice([200, 100, 200, 100, 300]);

                if (!NOTIF_SUPPORTED) {
                    if (VIBRATE_SUPPORTED) {
                        showToast('📳 振动已触发！\n此浏览器不支持系统通知\n振动提醒可正常工作', 4000);
                    } else {
                        showToast('ℹ️ 此浏览器不支持通知和振动\n后台切回时会显示Toast提醒', 4000);
                    }
                    return;
                }
                if (Notification.permission === 'denied') {
                    showToast('📳 振动已触发！\n通知权限被拒绝\n请在浏览器设置中手动开启', 4000);
                    return;
                }
                if (Notification.permission !== 'granted') {
                    requestNotificationPermission();
                    showToast('📝 正在请求通知权限...\n振动已触发', 2500);
                    return;
                }
                try {
                    new Notification('🐶🦴TOP 测试通知', {
                        body: '通知+振动都正常！退到后台也能收到提醒了～',
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🐶</text></svg>',
                        tag: 'dog-top-test'
                    });
                    showToast('✅ 通知+振动已发送！', 3000);
                } catch (e) {
                    showToast('📳 振动OK，通知失败：' + e.message, 3500);
                }
            }));

            // 关于
            panel.appendChild(row('linear-gradient(135deg,#11998e,#38ef7d)', 'ℹ️', '关于', '查看插件信息', showAboutDialog));
        }

        function expand() {
            isMenuOpen = true;
            trigger.classList.add('open');
            trigger.textContent = '✕';
            applyExpanded();
            buildPanel();
            setTimeout(() => { panel.classList.add('show'); }, 220);
        }

        function collapse() {
            isMenuOpen = false;
            trigger.classList.remove('open');
            trigger.textContent = '🐾';
            panel.classList.remove('show');
            setTimeout(() => { applySnap(true); }, 200);
        }

        let dragMoved = false, dragging = false;
        let startX = 0, startY = 0, startTop2 = 0, startLeft2 = 0;

        function dragStart(cx, cy) {
            dragging = true; dragMoved = false;
            startX = cx; startY = cy;
            const rect = folder.getBoundingClientRect();
            startTop2 = rect.top; startLeft2 = rect.left;
            folder.style.transition = 'none';
            folder.style.left = rect.left + 'px';
            folder.style.right = 'auto';
            folder.style.transform = 'none';
        }
        function dragMove(cx, cy) {
            if (!dragging) return;
            const dx = cx - startX, dy = cy - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMoved = true;
            if (dragMoved) {
                const h = 54;
                let t = Math.max(0, Math.min(window.innerHeight - h, startTop2 + dy));
                let l = startLeft2 + dx;
                folder.style.top = t + 'px';
                folder.style.left = l + 'px';
                if (isMenuOpen) collapse();
            }
        }
        function dragEnd() {
            if (!dragging) return;
            dragging = false;
            if (dragMoved) {
                const rect = folder.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                currentTop = Math.max(0, Math.min(window.innerHeight - rect.height, rect.top));
                folder.style.top = currentTop + 'px';
                currentSnappedSide = centerX < window.innerWidth / 2 ? 'left' : 'right';
                applySnap(true);
                savePosition();
            }
        }

        trigger.addEventListener('touchstart', (e) => { dragStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
        trigger.addEventListener('touchmove', (e) => { dragMove(e.touches[0].clientX, e.touches[0].clientY); if (dragMoved) e.preventDefault(); }, { passive: false });
        trigger.addEventListener('touchend', () => { const m = dragMoved; dragEnd(); if (!m) { isMenuOpen ? collapse() : expand(); } });
        trigger.addEventListener('mousedown', (e) => { if (e.button !== 0) return; dragStart(e.clientX, e.clientY); e.preventDefault(); });
        document.addEventListener('mousemove', (e) => { if (dragging) dragMove(e.clientX, e.clientY); });
        document.addEventListener('mouseup', () => { if (!dragging) return; const m = dragMoved; dragEnd(); if (!m && !('ontouchstart' in window)) { isMenuOpen ? collapse() : expand(); } });

        window.addEventListener('resize', () => { if (!isMenuOpen) applySnap(false); });

        folder.appendChild(trigger);
        folder.appendChild(panel);
        document.body.appendChild(folder);
        if (!settings.floatEnabled) folder.style.display = 'none';
    }

    // ============ 关于弹窗（延迟弹出防误关） ============
    function showAboutDialog() {
        setTimeout(() => {
            const capStr = getAlertCapability();
            const wrapper = document.createElement('div'); wrapper.className = 'dog-modal-wrapper';
            wrapper.innerHTML = `<div class="dog-modal-panel" style="max-width:380px;">
                <div style="font-size:32px;text-align:center;margin-bottom:8px;">🐶🦴</div>
                <div style="font-size:19px;font-weight:700;text-align:center;margin-bottom:6px;color:#fff;">🐶🦴TOP</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:18px;">v1.5.3 · 跨平台增强插件</div>
                <div class="dog-about-card"><b>🐾 玻璃拟态菜单</b><br/>可拖动 / 边缘吸附 / 位置记忆</div>
                <div class="dog-about-card"><b>🔔 后台提醒</b><br/>当前支持：${capStr}</div>
                <div class="dog-about-card"><b>🩺 错误码字典翻译</b><br/>40+ 内置规则 + 机翻兜底</div>
                <div class="dog-about-card"><b>🔖 选中即生成卡片</b><br/>6种风格精美海报</div>
                <div class="dog-about-card"><b>🌐 划词翻译</b><br/>微软Edge引擎</div>
                <div class="dog-about-card"><b>🔊 智能AI提示音</b><br/>完成/截断/空回三种提醒</div>
                <div style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:11px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.5;">
                    通知: ${NOTIF_SUPPORTED ? '✅' : '❌'} · 振动: ${VIBRATE_SUPPORTED ? '✅' : '❌'}<br/>
                    浏览器: ${navigator.userAgent.slice(-40)}
                </div>
                <button class="dog-cancel-btn" id="dog-about-close" style="margin-top:12px;">关闭</button>
            </div>`;
            document.body.appendChild(wrapper);
            // 延迟绑定关闭事件
            setTimeout(() => {
                wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
                wrapper.querySelector('#dog-about-close').onclick = () => wrapper.remove();
            }, 150);
        }, 350);
    }

    // ============ 选中文字 → 卡片 ============
    function injectSelectionCard() {
        if (document.querySelector('[data-dog-card-btn]')) return;
        const btn = document.createElement('div');
        btn.setAttribute('data-dog-card-btn', '1'); btn.className = 'dog-card-btn'; btn.textContent = '🔖 生成卡片'; btn.style.display = 'none';
        document.body.appendChild(btn);
        function findAiMes(node) { let el = (node && node.nodeType === 1) ? node : (node ? node.parentElement : null); while (el && el !== document.body) { if (el.classList && el.classList.contains('mes')) { if (el.getAttribute('is_user') === 'true') return null; return el; } el = el.parentElement; } return null; }
        function update() { const sel = window.getSelection(); const txt = sel ? sel.toString().trim() : ''; if (!txt || txt.length < 2) { btn.style.display = 'none'; return; } const mes = findAiMes(sel.anchorNode); if (!mes) { btn.style.display = 'none'; return; } try { const r = sel.getRangeAt(0).getBoundingClientRect(); let top = r.bottom + 8, left = r.left + r.width / 2 - 60; if (top + 50 > window.innerHeight) top = r.top - 44; if (left < 8) left = 8; if (left + 130 > window.innerWidth) left = window.innerWidth - 138; btn.style.left = left + 'px'; btn.style.top = top + 'px'; btn.style.display = 'block'; btn._targetMes = mes; btn._selText = txt; } catch (e) { btn.style.display = 'none'; } }
        document.addEventListener('selectionchange', () => setTimeout(update, 50));
        window.addEventListener('scroll', () => { btn.style.display = 'none'; }, true);
        const triggerFn = (e) => { e.preventDefault(); e.stopPropagation(); const t = btn._selText || '', m = btn._targetMes; if (t && m) showStyleMenu(t, m); };
        btn.addEventListener('click', triggerFn); btn.addEventListener('touchend', triggerFn, { passive: false });
    }

    function showStyleMenu(text, mes) {
        try { window.getSelection().removeAllRanges(); } catch (e) {}
        document.querySelectorAll('[data-dog-card-btn]').forEach(b => b.style.display = 'none');
        document.querySelectorAll('[data-dog-tr-btn]').forEach(b => b.style.display = 'none');
        const old = document.getElementById('dog-poster-wrapper'); if (old) old.remove();
        const wrapper = document.createElement('div'); wrapper.id = 'dog-poster-wrapper'; wrapper.className = 'dog-modal-wrapper';
        const pd = document.createElement('div'); pd.className = 'dog-modal-panel';
        let html = `<div style="font-size:28px;text-align:center;margin-bottom:6px;">✨</div><div style="font-size:18px;font-weight:700;text-align:center;color:#fff;margin-bottom:6px;">选择卡片风格</div><div style="font-size:12px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:16px;">已选中 <span style="color:#fee140;font-weight:600;">${text.length}</span> 字</div>`;
        STYLES.forEach(s => { html += `<button data-style="${s.idx}" class="dog-poster-btn" style="background:${s.btnBg};color:${s.btnColor};"><span style="font-size:24px;flex-shrink:0;">${s.emoji}</span><span style="flex:1;min-width:0;text-align:left;"><span style="display:block;font-size:14px;font-weight:700;">${s.name}</span><span style="display:block;font-size:11px;opacity:0.75;margin-top:2px;">${s.desc}</span></span><span style="font-size:16px;opacity:0.5;">›</span></button>`; });
        html += `<button class="dog-cancel-btn" id="dog-poster-cancel">取消</button>`;
        pd.innerHTML = html; wrapper.appendChild(pd); document.body.appendChild(wrapper);

        setTimeout(() => {
            wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
            pd.querySelector('#dog-poster-cancel').onclick = () => wrapper.remove();
            pd.querySelectorAll('.dog-poster-btn').forEach(b => { b.onclick = () => { const si = parseInt(b.getAttribute('data-style')); const nn = mes.querySelector('.ch_name .name_text') || mes.querySelector('.name_text') || mes.querySelector('.ch_name'); const cn = nn ? (nn.innerText || nn.textContent || '').trim() : ''; const ai = mes.querySelector('.avatar img') || mes.querySelector('img.avatar') || mes.querySelector('img'); const au = ai ? (ai.src || '') : ''; generateCard(text, cn, au, si); wrapper.remove(); }; });
        }, 100);
    }

    // ============ AI 生成事件 ============
    function attachGenerationHooks() {
        let manualStop = false, finishReason = 'unknown';

        if (!window._dogFetchHooked) {
            window._dogFetchHooked = true;
            const origFetch = window.fetch;
            window.fetch = async function () {
                const u = (typeof arguments[0] === 'string') ? arguments[0] : (arguments[0] && arguments[0].url ? arguments[0].url : '');
                const isGen = u.indexOf('generate') >= 0 || u.indexOf('completions') >= 0 || u.indexOf('chat') >= 0;
                if (isGen) finishReason = 'unknown';
                const res = await origFetch.apply(this, arguments);
                if (isGen && res.body && res.clone) {
                    const c = res.clone();
                    (async () => {
                        try {
                            const r = c.body.getReader();
                            const d = new TextDecoder('utf-8');
                            let done = false;
                            while (!done) {
                                const x = await r.read();
                                done = x.done;
                                if (x.value) {
                                    const ck = d.decode(x.value, { stream: true });
                                    if (ck.includes('"finish_reason":"length"')) finishReason = 'length';
                                    else if (ck.includes('"finish_reason":"stop"') || ck.includes('"finish_reason":"eos_token"')) finishReason = 'stop';
                                }
                            }
                            window._dogFinishReason = finishReason;
                        } catch (e) {}
                    })();
                }
                return res;
            };
        }

        if (!window._dogErrorObserver) {
            window._dogErrorObserver = true;
            new MutationObserver((ms) => {
                ms.forEach(m => m.addedNodes.forEach(n => {
                    if (n.nodeType === 1) {
                        const et = (n.classList && n.classList.contains('toast-error')) ? n : (n.querySelector ? n.querySelector('.toast-error') : null);
                        if (et && !et._dogHandled) { et._dogHandled = true; window._dogHasError = true; }
                    }
                }));
            }).observe(document.body, { childList: true, subtree: true });
        }

        const tryHook = () => {
            if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') return false;
            const ctx = window.SillyTavern.getContext();
            if (!ctx || !ctx.eventSource) return false;
            if (window._dogHooksAdded) return true;
            window._dogHooksAdded = true;

            const es = ctx.eventSource;

            es.on('generation_started', () => {
                manualStop = false;
                finishReason = 'unknown';
                window._dogFinishReason = 'unknown';
                window._dogHasError = false;
            });

            es.on('generation_stopped', () => { manualStop = true; });

            es.on('generation_ended', () => {
                Promise.resolve().then(() => {
                    if (window._dogHasError) { window._dogHasError = false; return; }

                    const c2 = window.SillyTavern.getContext();
                    const chat = (c2 && c2.chat) ? c2.chat : [];
                    let t = '';
                    if (chat.length) {
                        const am = chat.filter(m => m.is_user !== true);
                        if (am.length) t = am[am.length - 1].mes || '';
                    }
                    t = t.replace(/<[^>]+>/g, '').replace(/[\s\r\n\u200B-\u200D\uFEFF]+$/, '');

                    const ms2 = manualStop === true;
                    const r = window._dogFinishReason || 'unknown';

                    let charName = '';
                    try {
                        const nameEl = document.querySelector('.mes:last-of-type .ch_name .name_text') ||
                                       document.querySelector('.mes:last-of-type .name_text');
                        if (nameEl) charName = (nameEl.innerText || nameEl.textContent || '').trim();
                        if (!charName && c2.name2) charName = c2.name2;
                    } catch (e) {}
                    const namePrefix = charName ? `${charName}：` : '';
                    const previewText = t.length > 80 ? t.slice(0, 80) + '...' : t;

                    if (t === '') {
                        showToast('😾 可恶的AI！空回了！', 3500);
                        playSound();
                        sendSystemNotification('😾 AI空回了！', `${namePrefix}什么都没说就交卷了...`);
                        return;
                    }
                    if (ms2 || r === 'length') {
                        showToast('😭 被截断了汪', 3500);
                        playSound();
                        sendSystemNotification('😭 回复被截断了', `${namePrefix}${previewText}`);
                        return;
                    }
                    if (r === 'stop') {
                        showToast('🎉 回复完毕汪！', 2500);
                        playSound();
                        sendSystemNotification('🎉 回复完毕！', `${namePrefix}${previewText}`);
                        return;
                    }

                    const lc = t.slice(-1);
                    const ve = ['.','!','?','。','！','？','"','\u201d','\u2019','~','*',']',')','}','-','\u2026','`','_'];
                    const emojiRe = /(?:\ud83c[\udf00-\udfff])|(?:\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/;

                    if (ve.indexOf(lc) >= 0 || emojiRe.test(lc)) {
                        showToast('🎉 回复完毕汪！', 2500);
                        playSound();
                        sendSystemNotification('🎉 回复完毕！', `${namePrefix}${previewText}`);
                    } else {
                        showToast('😭 好像被截断了汪', 3000);
                        playSound();
                        sendSystemNotification('😭 可能被截断了', `${namePrefix}${previewText}`);
                    }
                });
            });

            return true;
        };

        if (!tryHook()) {
            const ob = new MutationObserver(() => { if (tryHook()) ob.disconnect(); });
            ob.observe(document, { childList: true, subtree: true });
        }
    }

    // ====================================================
    // 🎛️ 扩展面板
    // ====================================================
    function injectExtensionPanel() {
        const targetContainer = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!targetContainer) { setTimeout(injectExtensionPanel, 1000); return; }
        if (document.getElementById('dog_top_settings')) return;

        const capStr = getAlertCapability();

        const settingsHtml = `
        <div id="dog_top_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🐶🦴TOP</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="font-size:14px;">
                    <div style="padding:12px;">
                        <div style="margin-bottom:14px;">
                            <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
                                <input id="dog_top_float_toggle" type="checkbox" ${settings.floatEnabled ? 'checked' : ''} />
                                <span>🐾 显示悬浮球</span>
                            </label>
                            <small style="color:var(--SmartThemeQuoteColor);margin-left:26px;">屏幕边缘显示工具悬浮球</small>
                        </div>
                        <div style="margin-bottom:14px;">
                            <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
                                <input id="dog_top_sound_toggle" type="checkbox" ${settings.soundEnabled ? 'checked' : ''} />
                                <span>🔊 AI回复提示音</span>
                            </label>
                            <small style="color:var(--SmartThemeQuoteColor);margin-left:26px;">回复完成时播放叮咚提示音</small>
                        </div>
                        <div style="margin-bottom:14px;">
                            <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
                                <input id="dog_top_translate_toggle" type="checkbox" ${settings.translateEnabled ? 'checked' : ''} />
                                <span>🌐 划词翻译</span>
                            </label>
                            <small style="color:var(--SmartThemeQuoteColor);margin-left:26px;">选中文字后出现翻译按钮</small>
                        </div>
                        <div style="margin-bottom:14px;">
                            <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
                                <input id="dog_top_notif_toggle" type="checkbox" ${settings.notificationEnabled ? 'checked' : ''} />
                                <span>🔔 后台提醒</span>
                            </label>
                            <small style="color:var(--SmartThemeQuoteColor);margin-left:26px;">当前支持：${capStr}</small>
                        </div>
                        <hr style="border:none;border-top:1px solid var(--SmartThemeBorderColor);margin:14px 0;" />
                        <div style="color:var(--SmartThemeQuoteColor);font-size:12px;line-height:1.6;">
                            <p style="margin:0 0 4px;">🐶🦴TOP v1.5.3</p>
                            <p style="margin:0 0 4px;">悬浮球 / 卡片 / 错误码翻译 / 划词翻译 / 提示音 / 后台提醒</p>
                            <p style="margin:0;">通知: ${NOTIF_SUPPORTED ? '✅' : '❌'} · 振动: ${VIBRATE_SUPPORTED ? '✅' : '❌'}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        targetContainer.insertAdjacentHTML('beforeend', settingsHtml);

        setTimeout(() => {
            const ft = document.getElementById('dog_top_float_toggle');
            const st2 = document.getElementById('dog_top_sound_toggle');
            const tt = document.getElementById('dog_top_translate_toggle');
            const nt = document.getElementById('dog_top_notif_toggle');

            if (ft) ft.addEventListener('change', (e) => {
                settings.floatEnabled = e.target.checked; saveSettings();
                if (settings.floatEnabled) { showFloatingMenu(); showToast('🐾 悬浮球已开启'); }
                else { hideFloatingMenu(); showToast('🐾 悬浮球已关闭'); }
            });
            if (st2) st2.addEventListener('change', (e) => {
                settings.soundEnabled = e.target.checked; saveSettings();
                showToast(settings.soundEnabled ? '🔊 已开启' : '🔇 已关闭');
                if (settings.soundEnabled) playSound();
            });
            if (tt) tt.addEventListener('change', (e) => {
                settings.translateEnabled = e.target.checked; saveSettings();
                showToast(settings.translateEnabled ? '🌐 已开启' : '🚫 已关闭');
            });
            if (nt) nt.addEventListener('change', (e) => {
                settings.notificationEnabled = e.target.checked; saveSettings();
                if (settings.notificationEnabled) {
                    if (NOTIF_SUPPORTED) requestNotificationPermission();
                    vibrateDevice([100, 50, 100]);
                    showToast(`🔔 后台提醒已开启\n当前支持：${getAlertCapability()}`, 3000);
                } else {
                    showToast('🔕 后台提醒已关闭');
                }
            });
        }, 100);
    }

    function syncToExtPanel() {
        try {
            const f = document.getElementById('dog_top_float_toggle');
            const s = document.getElementById('dog_top_sound_toggle');
            const t = document.getElementById('dog_top_translate_toggle');
            const n = document.getElementById('dog_top_notif_toggle');
            if (f) f.checked = settings.floatEnabled;
            if (s) s.checked = settings.soundEnabled;
            if (t) t.checked = settings.translateEnabled;
            if (n) n.checked = settings.notificationEnabled;
        } catch (e) {}
    }

    // ====================================================
    // 🚀 初始化
    // ====================================================
    function init() {
        console.log(`[${PLUGIN_NAME}] 🐶🦴TOP v1.5.3 启动...`);

        if (NOTIF_SUPPORTED) requestNotificationPermission();
        injectExtensionPanel();
        injectFloatingMenu();
        injectSelectionCard();
        injectTranslateUI();
        injectErrorCatcher();
        attachGenerationHooks();

        console.log(`[${PLUGIN_NAME}] ✅ OK | 通知:${NOTIF_SUPPORTED} 振动:${VIBRATE_SUPPORTED}`);
    }

    if (typeof jQuery !== 'undefined') {
        jQuery(() => setTimeout(init, 800));
    } else {
        if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 1000);
        else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    }

})();
