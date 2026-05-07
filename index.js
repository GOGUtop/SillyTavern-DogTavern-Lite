/**
 * 🐶 小狗酒馆 Lite - SillyTavern 整合插件 v1.1.0
 * 功能：悬浮菜单 / 选中生成卡片 / 6种风格海报 / AI回复提示音 / 截断空回检测
 *      + 🌐 红框秒翻（微软Edge引擎）+ 📸 长截图
 */

(function () {
    'use strict';

    const PLUGIN_NAME = 'DogTavernLite';
    const LS_KEY = 'dog_tavern_lite_settings';

    // ============ 设置存储 ============
    const defaultSettings = { soundEnabled: true, translateEnabled: true };
    let settings = { ...defaultSettings };
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved) settings = { ...defaultSettings, ...JSON.parse(saved) };
    } catch (e) {}
    function saveSettings() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
    }

    // ============ Toast ============
    function showToast(msg, duration = 2500) {
        const old = document.getElementById('dog-toast');
        if (old) old.remove();
        const t = document.createElement('div');
        t.id = 'dog-toast';
        t.textContent = msg;
        t.style.cssText = `
            position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
            z-index:2147483647;background:linear-gradient(135deg,#667eea,#764ba2);
            color:#fff;padding:14px 24px;border-radius:30px;font-size:15px;
            font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);
            font-family:-apple-system,sans-serif;max-width:80vw;text-align:center;
            white-space:pre-line;pointer-events:none;`;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, duration - 300);
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
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + delay);
                gain.gain.linearRampToValueAtTime(0.25, now + delay + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + delay);
                osc.stop(now + delay + 0.4);
            });
        } catch (e) {}
    }

    function stripHtml(s) {
        return (s || '').replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, '\n\n').trim();
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
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => {
                const img2 = new Image();
                img2.onload = () => resolve(img2);
                img2.onerror = () => resolve(null);
                img2.src = url;
            };
            img.src = url;
        });
    }

    // ============ 海报卡片绘制 ============
    async function drawPosterCard(rawText, charName, avatarUrl, styleIdx) {
        const st = STYLES[Math.max(0, Math.min(STYLES.length - 1, styleIdx))];
        const cleanText = stripHtml(rawText);
        const displayText = cleanText.length > 600 ? cleanText.slice(0, 600) + '…' : cleanText;
        const W = 1080, padding = 80;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        const ctx = canvas.getContext('2d');
        ctx.font = '40px "Songti SC","Noto Serif SC","SimSun",serif';
        const lines = wrapText(ctx, displayText, W - padding * 2);
        const lineHeight = 54;
        const textBlockH = lines.length * lineHeight;
        const headerH = 200, footerH = 120, quoteGap = 110;
        const totalH = Math.max(900, headerH + quoteGap + textBlockH + 60 + footerH);
        canvas.height = totalH;
        const g = ctx.createLinearGradient(0, 0, 0, totalH);
        g.addColorStop(0, st.bg1); g.addColorStop(1, st.bg2);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, totalH);
        const seed = hashCode(charName + styleIdx);
        const rand = mulberry32(seed);
        ctx.fillStyle = st.spark;
        for (let i = 0; i < 35; i++) {
            ctx.globalAlpha = rand() * 0.25 + 0.08;
            ctx.beginPath(); ctx.arc(rand() * W, rand() * totalH, rand() * 2.5 + 0.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.accent; ctx.globalAlpha = 0.7;
        ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, totalH - 5, W, 5);
        ctx.globalAlpha = 1;
        const avatarSize = 120;
        const ax = padding + avatarSize / 2, ay = padding + avatarSize / 2;
        const avatar = await loadImage(avatarUrl);
        ctx.strokeStyle = st.accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2 + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (avatar) {
            ctx.save();
            ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(avatar, ax - avatarSize / 2, ay - avatarSize / 2, avatarSize, avatarSize);
            ctx.restore();
        } else {
            ctx.fillStyle = st.accent; ctx.globalAlpha = 0.7;
            ctx.beginPath(); ctx.arc(ax, ay, avatarSize / 2, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff'; ctx.font = 'bold 50px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(charName ? charName.charAt(0) : '?', ax, ay);
            ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        }
        const nameX = ax + avatarSize / 2 + 28;
        ctx.fillStyle = st.nameC;
        ctx.font = 'bold 48px -apple-system,sans-serif';
        ctx.fillText(charName || '未知角色', nameX, ay - 8);
        ctx.fillStyle = st.text; ctx.globalAlpha = 0.55;
        ctx.font = '24px -apple-system,sans-serif';
        ctx.fillText(`— ${st.name} · 高光剪报 —`, nameX, ay + 36);
        ctx.globalAlpha = 1;
        const divY = headerH;
        const lg = ctx.createLinearGradient(padding, divY, W - padding, divY);
        lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, st.accent); lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(padding, divY); ctx.lineTo(W - padding, divY); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.quote; ctx.globalAlpha = 0.6;
        ctx.font = 'bold 160px "Songti SC",serif';
        ctx.fillText('\u201C', padding - 5, divY + 110);
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.text;
        ctx.font = '40px "Songti SC","Noto Serif SC",serif';
        const textTop = divY + quoteGap;
        lines.forEach((line, i) => ctx.fillText(line, padding, textTop + i * lineHeight + 40));
        ctx.fillStyle = st.quote; ctx.globalAlpha = 0.4;
        ctx.font = 'bold 100px "Songti SC",serif';
        ctx.fillText('\u201D', W - padding - 80, textTop + textBlockH + 20);
        ctx.globalAlpha = 1;
        const fDivY = textTop + textBlockH + 40;
        const lg2 = ctx.createLinearGradient(padding, fDivY, W - padding, fDivY);
        lg2.addColorStop(0, 'rgba(0,0,0,0)'); lg2.addColorStop(0.5, st.accent); lg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = lg2; ctx.lineWidth = 2; ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.moveTo(padding, fDivY); ctx.lineTo(W - padding, fDivY); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.text; ctx.globalAlpha = 0.65;
        ctx.font = 'bold 26px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🐶🦴 酒馆 · SillyTavern', W / 2, fDivY + 50);
        ctx.globalAlpha = 0.45;
        ctx.font = '20px -apple-system,sans-serif';
        const date = new Date();
        const dateStr = `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
        ctx.fillText(dateStr, W / 2, fDivY + 80);
        ctx.globalAlpha = 1; ctx.textAlign = 'start';
        return canvas;
    }

    function wrapText(ctx, text, maxWidth) {
        const out = [];
        const paragraphs = text.split('\n');
        for (const para of paragraphs) {
            if (!para) { out.push(''); continue; }
            let line = '';
            for (const ch of para) {
                const test = line + ch;
                if (ctx.measureText(test).width > maxWidth && line) {
                    out.push(line); line = ch;
                } else line = test;
            }
            if (line) out.push(line);
        }
        return out;
    }
    function hashCode(s) {
        let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
        return h >>> 0;
    }
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = a;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function saveCanvas(canvas, filename) {
        canvas.toBlob((blob) => {
            if (!blob) { showToast('❌ 生成失败'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
            showToast('🎉 已保存到下载目录汪～', 3000);
        }, 'image/png');
    }
    async function generateCard(text, charName, avatarUrl, styleIdx) {
        showToast('🎨 正在绘制精美卡片汪～', 1500);
        try {
            const canvas = await drawPosterCard(text, charName, avatarUrl, styleIdx);
            saveCanvas(canvas, `Tavern_Card_${Date.now()}.png`);
        } catch (e) {
            showToast('❌ 生成失败：' + e.message, 3500);
        }
    }

    // ====================================================
    // 🌐 红框秒翻（微软 Edge 翻译引擎，全球秒开免Key）
    // ====================================================
    let edgeAuthToken = null;
    let edgeAuthExpire = 0;

    async function getEdgeToken() {
        if (edgeAuthToken && Date.now() < edgeAuthExpire) return edgeAuthToken;
        const res = await fetch('https://edge.microsoft.com/translate/auth');
        const tk = await res.text();
        edgeAuthToken = tk;
        edgeAuthExpire = Date.now() + 8 * 60 * 1000; // 8分钟刷新
        return tk;
    }

    async function translateByEdge(text, toLang) {
        const token = await getEdgeToken();
        const url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${toLang}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([{ Text: text }])
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return {
            text: data[0].translations[0].text,
            from: data[0].detectedLanguage ? data[0].detectedLanguage.language : 'auto'
        };
    }

    function injectTranslateUI() {
        if (document.querySelector('[data-dog-tr-btn]')) return;
        const btn = document.createElement('div');
        btn.setAttribute('data-dog-tr-btn', '1');
        btn.className = 'dog-tr-btn';
        btn.innerHTML = '🌐';
        btn.style.cssText = `
            position:fixed;display:none;z-index:2147483646;
            background:linear-gradient(135deg,#ff6b6b,#ee5a6f);
            color:#fff;width:34px;height:34px;border-radius:50%;
            display:none;align-items:center;justify-content:center;
            cursor:pointer;font-size:16px;
            box-shadow:0 3px 10px rgba(255,107,107,0.5);
            user-select:none;-webkit-user-select:none;`;
        document.body.appendChild(btn);

        let lastSel = '';
        function update() {
            if (!settings.translateEnabled) { btn.style.display = 'none'; return; }
            const sel = window.getSelection();
            const txt = sel ? sel.toString().trim() : '';
            if (!txt || txt.length < 1) { btn.style.display = 'none'; return; }
            lastSel = txt;
            try {
                const r = sel.getRangeAt(0).getBoundingClientRect();
                let top = r.bottom + 8;
                let left = r.right + 6;
                if (left + 40 > window.innerWidth) left = r.left - 40;
                if (top + 40 > window.innerHeight) top = r.top - 40;
                btn.style.top = top + 'px';
                btn.style.left = left + 'px';
                btn.style.display = 'flex';
                btn._txt = txt;
            } catch (e) { btn.style.display = 'none'; }
        }
        document.addEventListener('selectionchange', () => setTimeout(update, 50));
        window.addEventListener('scroll', () => { btn.style.display = 'none'; }, true);

        const fire = (e) => {
            e.preventDefault(); e.stopPropagation();
            const t = btn._txt || lastSel;
            btn.style.display = 'none';
            if (t) showTranslateBubble(t, e.clientX || 100, e.clientY || 100);
        };
        btn.addEventListener('click', fire);
        btn.addEventListener('touchend', fire, { passive: false });
    }

    function showTranslateBubble(text, x, y) {
        document.querySelectorAll('.dog-tr-bubble').forEach(el => el.remove());
        const bubble = document.createElement('div');
        bubble.className = 'dog-tr-bubble';
        const top = Math.min(y + 20, window.innerHeight - 240);
        const left = Math.min(Math.max(x - 150, 10), window.innerWidth - 320);
        bubble.style.cssText = `
            position:fixed;top:${top}px;left:${left}px;width:300px;
            background:rgba(255,255,255,0.98);border:2px solid #ff6b6b;
            border-radius:12px;padding:14px;z-index:2147483646;
            box-shadow:0 6px 24px rgba(255,107,107,0.4);
            font-size:14px;color:#333;
            font-family:-apple-system,sans-serif;`;
        bubble.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="color:#ff6b6b;font-weight:700;font-size:13px;">🌐 翻译中...</span>
                <span class="dog-tr-close" style="cursor:pointer;color:#999;font-size:18px;line-height:1;">×</span>
            </div>
            <div class="dog-tr-content" style="line-height:1.6;color:#666;font-size:14px;">⚡ 微软Edge引擎调用中...</div>
        `;
        document.body.appendChild(bubble);
        bubble.querySelector('.dog-tr-close').onclick = () => bubble.remove();

        // 点空白关闭
        const off = (e) => {
            if (!bubble.contains(e.target)) {
                bubble.remove();
                document.removeEventListener('mousedown', off);
                document.removeEventListener('touchstart', off);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', off);
            document.addEventListener('touchstart', off, { passive: true });
        }, 200);

        const hasChinese = /[\u4e00-\u9fa5]/.test(text);
        const target = hasChinese ? 'en' : 'zh-Hans';

        translateByEdge(text, target).then(({ text: translated, from }) => {
            bubble.querySelector('span').innerHTML = `🌐 ${from} → ${target} ⚡`;
            const c = bubble.querySelector('.dog-tr-content');
            c.style.color = '#333';
            c.innerHTML = `
                <div style="margin-bottom:10px;line-height:1.6;">${translated.replace(/</g,'&lt;')}</div>
                <div style="text-align:right;">
                    <button class="dog-tr-copy" style="padding:5px 14px;border:1px solid #ff6b6b;background:#fff;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">📋 复制</button>
                </div>
            `;
            bubble.querySelector('.dog-tr-copy').onclick = (e) => {
                navigator.clipboard.writeText(translated).then(() => {
                    e.target.textContent = '✅ 已复制';
                    setTimeout(() => { e.target.textContent = '📋 复制'; }, 1500);
                }).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = translated; document.body.appendChild(ta);
                    ta.select(); document.execCommand('copy'); ta.remove();
                    e.target.textContent = '✅ 已复制';
                });
            };
        }).catch(err => {
            bubble.querySelector('.dog-tr-content').innerHTML =
                `<div style="color:#ff6b6b;">❌ 翻译失败<br><small style="color:#999;">${err.message}</small></div>`;
        });
    }

    // ====================================================
    // 📸 长截图（拼接整个对话为一张长图）
    // ====================================================
    async function generateLongScreenshot(scope = 'all') {
        showToast('📸 正在合成长截图，请稍候...', 2000);
        try {
            const allMes = Array.from(document.querySelectorAll('#chat .mes, .mes'));
            if (!allMes.length) { showToast('❌ 没找到对话内容'); return; }

            let target = allMes;
            if (scope === 'ai') target = allMes.filter(m => m.getAttribute('is_user') !== 'true');
            else if (scope === 'last10') target = allMes.slice(-10);
            else if (scope === 'last20') target = allMes.slice(-20);

            if (!target.length) { showToast('❌ 没有匹配的消息'); return; }

            const W = 900, padding = 30, avatarSize = 60, gap = 18;
            const canvas = document.createElement('canvas');
            const tmp = canvas.getContext('2d');
            tmp.font = '22px -apple-system,"PingFang SC",sans-serif';

            // 预计算每条消息高度
            const blocks = [];
            for (const mes of target) {
                const isUser = mes.getAttribute('is_user') === 'true';
                const nameEl = mes.querySelector('.ch_name .name_text') || mes.querySelector('.name_text');
                const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : (isUser ? '你' : 'AI');
                const mesEl = mes.querySelector('.mes_text');
                const text = mesEl ? stripHtml(mesEl.innerHTML) : '';
                if (!text) continue;
                const avImg = mes.querySelector('.avatar img') || mes.querySelector('img.avatar') || mes.querySelector('img');
                const avSrc = avImg ? avImg.src : '';
                const lines = wrapText(tmp, text, W - padding * 2 - avatarSize - 20);
                const blockH = Math.max(avatarSize + 10, 40 + lines.length * 32 + 20);
                blocks.push({ isUser, name, text, lines, avSrc, blockH });
            }

            if (!blocks.length) { showToast('❌ 没有可用文字内容'); return; }

            const headerH = 110, footerH = 70;
            const totalH = headerH + blocks.reduce((s, b) => s + b.blockH + gap, 0) + footerH;
            canvas.width = W; canvas.height = totalH;
            const ctx = canvas.getContext('2d');

            // 背景
            const bg = ctx.createLinearGradient(0, 0, 0, totalH);
            bg.addColorStop(0, '#f5f7fa'); bg.addColorStop(1, '#e8ecf1');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, W, totalH);

            // 顶部
            ctx.fillStyle = '#667eea';
            ctx.fillRect(0, 0, W, 6);
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 28px -apple-system,sans-serif';
            ctx.fillText('🐶 酒馆对话长截图', padding, 50);
            ctx.fillStyle = '#718096';
            ctx.font = '16px -apple-system,sans-serif';
            const d = new Date();
            ctx.fillText(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}  ·  共 ${blocks.length} 条`, padding, 80);

            // 绘制每条
            let cy = headerH;
            for (const b of blocks) {
                // 卡片背景
                ctx.fillStyle = b.isUser ? '#e3f2fd' : '#ffffff';
                roundRect(ctx, padding, cy, W - padding * 2, b.blockH, 12);
                ctx.fill();
                // 阴影
                ctx.shadowColor = 'rgba(0,0,0,0.06)';
                ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
                ctx.fill();
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

                // 头像
                const avX = padding + 16 + avatarSize / 2;
                const avY = cy + 22 + avatarSize / 2;
                const av = await loadImage(b.avSrc);
                if (av) {
                    ctx.save();
                    ctx.beginPath(); ctx.arc(avX, avY, avatarSize / 2, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(av, avX - avatarSize/2, avY - avatarSize/2, avatarSize, avatarSize);
                    ctx.restore();
                } else {
                    ctx.fillStyle = b.isUser ? '#42a5f5' : '#9c27b0';
                    ctx.beginPath(); ctx.arc(avX, avY, avatarSize / 2, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(b.name.charAt(0) || '?', avX, avY);
                    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
                }

                // 名字
                const txX = padding + 16 + avatarSize + 16;
                ctx.fillStyle = b.isUser ? '#1976d2' : '#6a1b9a';
                ctx.font = 'bold 18px -apple-system,sans-serif';
                ctx.fillText(b.name, txX, cy + 32);

                // 正文
                ctx.fillStyle = '#2d3748';
                ctx.font = '22px -apple-system,"PingFang SC",sans-serif';
                b.lines.forEach((ln, i) => {
                    ctx.fillText(ln, txX, cy + 64 + i * 32);
                });

                cy += b.blockH + gap;
            }

            // 页脚
            ctx.fillStyle = '#a0aec0';
            ctx.font = '14px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🐶🦴 SillyTavern · 小狗酒馆 Lite 生成', W / 2, totalH - 30);
            ctx.textAlign = 'start';

            saveCanvas(canvas, `Tavern_LongShot_${Date.now()}.png`);
        } catch (e) {
            console.error(e);
            showToast('❌ 长截图失败：' + e.message, 3500);
        }
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function showLongShotMenu() {
        const old = document.getElementById('dog-shot-wrapper');
        if (old) old.remove();
        const wrapper = document.createElement('div');
        wrapper.id = 'dog-shot-wrapper';
        wrapper.className = 'dog-modal-wrapper';
        const panel = document.createElement('div');
        panel.className = 'dog-modal-panel';
        panel.innerHTML = `
            <div style="font-size:28px;text-align:center;margin-bottom:6px;">📸</div>
            <div style="font-size:18px;font-weight:700;text-align:center;color:#fff;margin-bottom:16px;">长截图范围</div>
            <button data-scope="all" class="dog-poster-btn" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">
                <span style="font-size:24px;">📜</span>
                <span style="flex:1;text-align:left;">
                    <span style="display:block;font-size:14px;font-weight:700;">全部消息</span>
                    <span style="display:block;font-size:11px;opacity:0.8;">完整对话历史</span>
                </span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="ai" class="dog-poster-btn" style="background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;">
                <span style="font-size:24px;">🤖</span>
                <span style="flex:1;text-align:left;">
                    <span style="display:block;font-size:14px;font-weight:700;">仅 AI 消息</span>
                    <span style="display:block;font-size:11px;opacity:0.8;">只导出AI回复</span>
                </span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="last10" class="dog-poster-btn" style="background:linear-gradient(135deg,#11998e,#38ef7d);color:#fff;">
                <span style="font-size:24px;">🔟</span>
                <span style="flex:1;text-align:left;">
                    <span style="display:block;font-size:14px;font-weight:700;">最近 10 条</span>
                    <span style="display:block;font-size:11px;opacity:0.8;">最新片段</span>
                </span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="last20" class="dog-poster-btn" style="background:linear-gradient(135deg,#fa709a,#fee140);color:#fff;">
                <span style="font-size:24px;">2️⃣0️⃣</span>
                <span style="flex:1;text-align:left;">
                    <span style="display:block;font-size:14px;font-weight:700;">最近 20 条</span>
                    <span style="display:block;font-size:11px;opacity:0.8;">中等长度</span>
                </span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button class="dog-cancel-btn" id="dog-shot-cancel">取消</button>
        `;
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
        panel.querySelector('#dog-shot-cancel').onclick = () => wrapper.remove();
        panel.querySelectorAll('[data-scope]').forEach(b => {
            b.onclick = () => {
                const scope = b.getAttribute('data-scope');
                wrapper.remove();
                generateLongScreenshot(scope);
            };
        });
    }

    // ============ 悬浮工具菜单 ============
    function injectFloatingMenu() {
        if (document.querySelector('[data-dog-tool-folder]')) return;
        const folder = document.createElement('div');
        folder.setAttribute('data-dog-tool-folder', '1');
        folder.className = 'dog-folder';
        const trigger = document.createElement('div');
        trigger.className = 'dog-trigger';
        trigger.textContent = '🐾';
        const items = document.createElement('div');
        items.className = 'dog-items';
        let isOpen = false;

        function makeItem(emoji, label, bg, onTap) {
            const it = document.createElement('div');
            it.className = 'dog-item';
            it.style.background = bg;
            it.innerHTML = `<span class="dog-item-emoji">${emoji}</span><span>${label}</span>`;
            it.addEventListener('click', (e) => { e.stopPropagation(); onTap(); collapse(); });
            return it;
        }
        function buildItems() {
            items.innerHTML = '';
            items.appendChild(makeItem(
                settings.soundEnabled ? '🔊' : '🔇',
                settings.soundEnabled ? '声音 开' : '声音 关',
                'linear-gradient(135deg,#667eea,#764ba2)',
                () => {
                    settings.soundEnabled = !settings.soundEnabled;
                    saveSettings();
                    showToast(settings.soundEnabled ? '🔊 提示音已开启' : '🔇 提示音已关闭');
                    if (settings.soundEnabled) playSound();
                }
            ));
            items.appendChild(makeItem(
                settings.translateEnabled ? '🌐' : '🚫',
                settings.translateEnabled ? '翻译 开' : '翻译 关',
                'linear-gradient(135deg,#ff6b6b,#ee5a6f)',
                () => {
                    settings.translateEnabled = !settings.translateEnabled;
                    saveSettings();
                    showToast(settings.translateEnabled ? '🌐 划词翻译已开启' : '🚫 划词翻译已关闭');
                }
            ));
            items.appendChild(makeItem('📸', '长截图', 'linear-gradient(135deg,#43cea2,#185a9d)', showLongShotMenu));
            items.appendChild(makeItem('🔖', '生成卡片', 'linear-gradient(135deg,#f093fb,#f5576c)',
                () => showToast('💡 请先选中AI消息文字\n再点击弹出的"生成卡片"', 3500)));
            items.appendChild(makeItem('🎵', '测试提示音', 'linear-gradient(135deg,#fa709a,#fee140)',
                () => { if (!settings.soundEnabled) { showToast('🔇 声音已关闭'); return; } playSound(); showToast('🎵 叮咚~'); }));
            items.appendChild(makeItem('ℹ️', '关于', 'linear-gradient(135deg,#11998e,#38ef7d)', showAboutDialog));

            setTimeout(() => {
                Array.from(items.children).forEach((c, i) => {
                    setTimeout(() => { c.style.transform = 'translateX(0)'; c.style.opacity = '1'; }, i * 50);
                });
            }, 10);
        }
        function expand() {
            isOpen = true;
            trigger.style.transform = 'translateX(0)';
            trigger.textContent = '✕';
            items.style.display = 'flex';
            items.style.pointerEvents = 'auto';
            buildItems();
        }
        function collapse() {
            isOpen = false;
            trigger.style.transform = 'translateX(55%)';
            trigger.textContent = '🐾';
            items.style.display = 'none';
            items.style.pointerEvents = 'none';
        }
        window._dogCollapseFolder = collapse;

        let dragMoved = false, dY = 0, dTop = 0;
        trigger.addEventListener('touchstart', (e) => {
            dragMoved = false;
            dY = e.touches[0].clientY;
            dTop = folder.getBoundingClientRect().top;
        }, { passive: true });
        trigger.addEventListener('touchmove', (e) => {
            const dy = e.touches[0].clientY - dY;
            if (Math.abs(dy) > 8) {
                dragMoved = true;
                folder.style.top = (dTop + dy) + 'px';
                e.preventDefault();
            }
        }, { passive: false });
        trigger.addEventListener('touchend', () => { if (!dragMoved) { isOpen ? collapse() : expand(); } });
        trigger.addEventListener('click', () => { if (!('ontouchstart' in window)) { isOpen ? collapse() : expand(); } });
        document.addEventListener('touchstart', (e) => { if (isOpen && !folder.contains(e.target)) collapse(); }, { passive: true });
        document.addEventListener('mousedown', (e) => { if (isOpen && !folder.contains(e.target)) collapse(); });
        setInterval(() => { if (isOpen) collapse(); }, 8000);

        folder.appendChild(trigger);
        folder.appendChild(items);
        document.body.appendChild(folder);
    }

    function showAboutDialog() {
        const wrapper = document.createElement('div');
        wrapper.className = 'dog-modal-wrapper';
        wrapper.innerHTML = `
            <div class="dog-modal-panel">
                <div style="font-size:32px;text-align:center;margin-bottom:8px;">🐶🦴</div>
                <div style="font-size:19px;font-weight:700;text-align:center;margin-bottom:6px;color:#fff;">小狗酒馆 Lite</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:18px;">v1.1.0 · 跨平台增强插件</div>
                <div class="dog-about-card"><b>🐾 悬浮工具菜单</b><br/>点击右侧肉掌展开</div>
                <div class="dog-about-card"><b>🔖 选中即生成卡片</b><br/>6种风格精美海报</div>
                <div class="dog-about-card"><b>🌐 红框秒翻</b><br/>微软Edge引擎，国内秒开免Key</div>
                <div class="dog-about-card"><b>📸 长截图</b><br/>整段对话拼接成长图</div>
                <div class="dog-about-card"><b>🔊 智能AI提示音</b><br/>完成/截断/空回三种提醒</div>
                <button class="dog-cancel-btn" id="dog-about-close">关闭</button>
            </div>
        `;
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
        wrapper.querySelector('#dog-about-close').onclick = () => wrapper.remove();
    }

    // ============ 选中文字 → 卡片按钮 ============
    function injectSelectionCard() {
        if (document.querySelector('[data-dog-card-btn]')) return;
        const btn = document.createElement('div');
        btn.setAttribute('data-dog-card-btn', '1');
        btn.className = 'dog-card-btn';
        btn.textContent = '🔖 生成卡片';
        btn.style.display = 'none';
        document.body.appendChild(btn);

        function findAiMes(node) {
            let el = (node && node.nodeType === 1) ? node : (node ? node.parentElement : null);
            while (el && el !== document.body) {
                if (el.classList && el.classList.contains('mes')) {
                    if (el.getAttribute('is_user') === 'true') return null;
                    return el;
                }
                el = el.parentElement;
            }
            return null;
        }
        function update() {
            const sel = window.getSelection();
            const txt = sel ? sel.toString().trim() : '';
            if (!txt || txt.length < 2) { btn.style.display = 'none'; return; }
            const mes = findAiMes(sel.anchorNode);
            if (!mes) { btn.style.display = 'none'; return; }
            try {
                const r = sel.getRangeAt(0).getBoundingClientRect();
                let top = r.bottom + 8;
                let left = r.left + r.width / 2 - 60;
                if (top + 50 > window.innerHeight) top = r.top - 44;
                if (left < 8) left = 8;
                if (left + 130 > window.innerWidth) left = window.innerWidth - 138;
                btn.style.left = left + 'px';
                btn.style.top = top + 'px';
                btn.style.display = 'block';
                btn._targetMes = mes;
                btn._selText = txt;
            } catch (e) { btn.style.display = 'none'; }
        }
        document.addEventListener('selectionchange', () => setTimeout(update, 50));
        window.addEventListener('scroll', () => { btn.style.display = 'none'; }, true);
        const trigger = (e) => {
            e.preventDefault(); e.stopPropagation();
            const t = btn._selText || '', m = btn._targetMes;
            if (t && m) showStyleMenu(t, m);
        };
        btn.addEventListener('click', trigger);
        btn.addEventListener('touchend', trigger, { passive: false });
    }

    function showStyleMenu(text, mes) {
        try { window.getSelection().removeAllRanges(); } catch (e) {}
        const btn = document.querySelector('[data-dog-card-btn]');
        if (btn) btn.style.display = 'none';
        const trBtn = document.querySelector('[data-dog-tr-btn]');
        if (trBtn) trBtn.style.display = 'none';
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
        const old = document.getElementById('dog-poster-wrapper');
        if (old) old.remove();
        const wrapper = document.createElement('div');
        wrapper.id = 'dog-poster-wrapper';
        wrapper.className = 'dog-modal-wrapper';
        const panel = document.createElement('div');
        panel.className = 'dog-modal-panel';
        let html = `
            <div style="font-size:28px;text-align:center;margin-bottom:6px;">✨</div>
            <div style="font-size:18px;font-weight:700;text-align:center;color:#fff;margin-bottom:6px;">选择卡片风格</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:16px;">已选中 <span style="color:#fee140;font-weight:600;">${text.length}</span> 字</div>
        `;
        STYLES.forEach(s => {
            html += `
                <button data-style="${s.idx}" class="dog-poster-btn" style="background:${s.btnBg};color:${s.btnColor};">
                    <span style="font-size:24px;flex-shrink:0;">${s.emoji}</span>
                    <span style="flex:1;min-width:0;text-align:left;">
                        <span style="display:block;font-size:14px;font-weight:700;">${s.name}</span>
                        <span style="display:block;font-size:11px;opacity:0.75;margin-top:2px;">${s.desc}</span>
                    </span>
                    <span style="font-size:16px;opacity:0.5;flex-shrink:0;">›</span>
                </button>`;
        });
        html += `<button class="dog-cancel-btn" id="dog-poster-cancel">取消</button>`;
        panel.innerHTML = html;
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);
        function closeAll() { try { wrapper.remove(); } catch (e) {} }
        wrapper.addEventListener('click', (e) => { if (e.target === wrapper) closeAll(); });
        panel.querySelector('#dog-poster-cancel').onclick = closeAll;
        panel.querySelectorAll('.dog-poster-btn').forEach(b => {
            b.onclick = () => {
                const si = parseInt(b.getAttribute('data-style'));
                const nn = mes.querySelector('.ch_name .name_text') || mes.querySelector('.name_text') || mes.querySelector('.ch_name');
                const cn = nn ? (nn.innerText || nn.textContent || '').trim() : '';
                const ai = mes.querySelector('.avatar img') || mes.querySelector('img.avatar') || mes.querySelector('img');
                const au = ai ? (ai.src || '') : '';
                generateCard(text, cn, au, si);
                closeAll();
            };
        });
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
                                const x = await r.read(); done = x.done;
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
                manualStop = false; finishReason = 'unknown';
                window._dogFinishReason = 'unknown'; window._dogHasError = false;
            });
            es.on('generation_stopped', () => { manualStop = true; });
            es.on('generation_ended', () => {
                Promise.resolve().then(() => {
                    if (window._dogHasError) { window._dogHasError = false; return; }
                    const c = window.SillyTavern.getContext();
                    const chat = (c && c.chat) ? c.chat : (window.chat || []);
                    let t = '';
                    if (chat && chat.length) {
                        const am = chat.filter(m => m.is_user !== true);
                        if (am.length) t = am[am.length - 1].mes || '';
                    }
                    t = t.replace(/<[^>]+>/g, '').replace(/[\s\r\n\u200B-\u200D\uFEFF]+$/, '');
                    const ms = manualStop === true;
                    const r = window._dogFinishReason || 'unknown';
                    if (t === '') { showToast('😾 可恶的AI！竟然空回本汪！', 3500); playSound(); return; }
                    if (ms || r === 'length') { showToast('😭 呜呜呜！为什么截断我汪', 3500); playSound(); return; }
                    if (r === 'stop') { showToast('🎉 回复完毕汪！', 2500); playSound(); return; }
                    const lc = t.slice(-1);
                    const ve = ['.','!','?','。','！','？','"','\u201d','\u2019','~','*',']',')','}','-','\u2026','`','_'];
                    const emojiRe = /(?:\ud83c[\udf00-\udfff])|(?:\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/;
                    if (ve.indexOf(lc) >= 0 || emojiRe.test(lc)) showToast('🎉 回复完毕汪！', 2500);
                    else showToast('😭 呜呜！好像被截断了汪', 3000);
                    playSound();
                });
            });
            return true;
        };
        if (!tryHook()) {
            const ob = new MutationObserver(() => { if (tryHook()) ob.disconnect(); });
            ob.observe(document, { childList: true, subtree: true });
        }
    }

    // ============ 入口 ============
    function init() {
        console.log(`[${PLUGIN_NAME}] 🐶 v1.1.0 启动中...`);
        injectFloatingMenu();
        injectSelectionCard();
        injectTranslateUI();
        attachGenerationHooks();
        console.log(`[${PLUGIN_NAME}] ✅ 启动成功！新增功能：🌐红框秒翻 + 📸长截图`);
    }
    if (typeof jQuery !== 'undefined') {
        jQuery(() => setTimeout(init, 500));
    } else {
        if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 800);
        else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
    }
})();
