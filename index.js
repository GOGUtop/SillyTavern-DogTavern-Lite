/**
 * 🐶 小狗酒馆 Lite v1.4.2
 * 修复：
 *  - 截图前自动展开所有折叠内容（<details>、ST推理块、aria-expanded、.collapsed等）
 *  - 同时处理 iframe 内部的折叠
 *  - iframe 永远预渲染（解决学生证等HTML块糊掉）
 *  - 截图期间所有 dog-* UI 元素 display:none
 */

(function () {
    'use strict';

    const PLUGIN_NAME = 'DogTavernLite';
    const LS_KEY = 'dog_tavern_lite_settings';
    const POS_KEY = 'dog_tavern_folder_pos';

    const SHOT_CDNS = [
        { type: 'modern', url: 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.4.39/dist/index.umd.js' },
        { type: 'modern', url: 'https://unpkg.com/modern-screenshot@4.4.39/dist/index.umd.js' },
        { type: 'modern', url: 'https://cdn.bootcdn.net/ajax/libs/modern-screenshot/4.4.39/index.umd.js' },
        { type: 'modern', url: 'https://lib.baomitu.com/modern-screenshot/4.4.39/index.umd.js' },
        { type: 'h2c',    url: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js' },
        { type: 'h2c',    url: 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js' },
        { type: 'h2c',    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' },
        { type: 'h2c',    url: 'https://lib.baomitu.com/html2canvas/1.4.1/html2canvas.min.js' }
    ];

    const defaultSettings = { soundEnabled: true, translateEnabled: true };
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
    // 📖 错误码字典
    // ====================================================
    const ERROR_DICT = [
        { re: /HTTP\s*401|unauthorized|invalid[_\s-]?api[_\s-]?key|incorrect api key/i, tag: '🔑 密钥错误', level: 'err', cn: 'API 密钥无效或已失效', fix: '检查 API Key 是否填错、是否过期、是否多了空格。重新去服务商后台复制一次。' },
        { re: /HTTP\s*402|insufficient[_\s]?quota|insufficient[_\s]?balance|billing|credit/i, tag: '💰 余额不足', level: 'err', cn: '账户余额不足或配额用完', fix: '去 API 服务商（OpenAI / 中转站）后台充值；或换一个有余额的 Key。' },
        { re: /HTTP\s*403|forbidden|permission[_\s]?denied|access[_\s]?denied/i, tag: '🚫 无权限', level: 'err', cn: '请求被拒绝（权限不足 / IP被封 / 区域限制）', fix: '检查 Key 权限范围；OpenAI 要挂代理；中转站可能限制了你的 IP。' },
        { re: /HTTP\s*404|model[_\s]?not[_\s]?found|no available channel for model/i, tag: '❓ 模型未找到', level: 'err', cn: '请求的模型不存在或当前渠道不支持', fix: '① 检查模型名拼写\n② 中转站可能没开通该模型\n③ New-API 报「No available channel」= 该分组无可用渠道' },
        { re: /HTTP\s*429|rate[_\s]?limit|too many requests|too_many_requests/i, tag: '🐢 请求过快', level: 'warn', cn: '请求频率超限（速率限制）', fix: '等待几秒重试；降低请求频率；升级 API 等级；或换其他 Key 轮询。' },
        { re: /HTTP\s*500|internal[_\s]?server[_\s]?error/i, tag: '💥 服务器爆炸', level: 'err', cn: '服务端 500 错误（不是你的问题）', fix: '官方/中转站后端崩了，等几分钟重试。' },
        { re: /HTTP\s*502|bad[_\s]?gateway/i, tag: '🌐 网关错误', level: 'err', cn: '中间网关挂了 / 后端无响应', fix: '通常是中转站到上游断了，等等再试或换渠道。' },
        { re: /HTTP\s*503|service[_\s]?unavailable|overloaded/i, tag: '⚠️ 服务过载', level: 'err', cn: '服务暂时不可用（过载/维护中）', fix: 'Claude/Gemini 高峰期常见，等30秒重试；或切到备用渠道。' },
        { re: /HTTP\s*504|gateway[_\s]?timeout|timeout/i, tag: '⏰ 超时', level: 'warn', cn: '请求超时（响应太慢被掐断）', fix: '上下文太长会超时 → 减少历史消息、降低 max_tokens；或换个更快的渠道。' },
        { re: /content[_\s]?policy|content[_\s]?filter|safety|usage policies/i, tag: '🛡️ 内容审核', level: 'err', cn: '内容触发审核', fix: '① 修改触发词\n② 用越狱预设\n③ 换不审核的模型' },
        { re: /context[_\s]?length[_\s]?exceeded|maximum context length|too many tokens|context_length/i, tag: '📏 上下文超长', level: 'err', cn: '上下文 token 数超过模型最大限制', fix: '① 减少世界书/角色卡内容\n② 降低聊天历史层数\n③ 换大窗口模型' },
        { re: /invalid[_\s]?request[_\s]?error|invalid_parameter|invalid[_\s]?json/i, tag: '📝 参数错误', level: 'err', cn: '请求参数格式有误', fix: '检查 temperature/top_p 是否超范围；预设里有没有非法字段。' },
        { re: /prompt is too long|prompt_too_long/i, tag: '📏 Claude上下文超长', level: 'err', cn: 'Claude 输入过长', fix: '减少历史/世界书；Claude 3.5 上限 200K tokens。' },
        { re: /credit balance is too low|low credit/i, tag: '💰 Claude余额低', level: 'err', cn: 'Anthropic 账户余额过低', fix: '去 console.anthropic.com 充值。' },
        { re: /claude.*overloaded|anthropic.*overload/i, tag: '⚠️ Claude过载', level: 'err', cn: 'Claude 服务过载', fix: '等30秒~1分钟重试；或换中转站节点。' },
        { re: /google.*api.*key.*not.*valid|API_KEY_INVALID/i, tag: '🔑 Gemini Key 无效', level: 'err', cn: 'Google AI Studio API Key 无效', fix: '去 aistudio.google.com 重新生成 Key。' },
        { re: /quota.*exceeded.*generativelanguage|RESOURCE_EXHAUSTED/i, tag: '💰 Gemini配额用完', level: 'err', cn: 'Gemini 免费配额已用完', fix: '免费版每分钟15次/每天1500次；等明天重置。' },
        { re: /SAFETY|safety_settings|harm_category|finishReason.*SAFETY/i, tag: '🛡️ Gemini安全过滤', level: 'err', cn: 'Gemini 安全过滤拦截了回复', fix: '在 ST 设置里把 Gemini 安全等级全部设为 BLOCK_NONE。' },
        { re: /failed to fetch|network[_\s]?error|ECONNREFUSED|connection refused/i, tag: '📡 网络错误', level: 'err', cn: '无法连接到服务器', fix: '① 检查代理\n② API 地址写错\n③ 服务器宕机' },
        { re: /ETIMEDOUT|ESOCKETTIMEDOUT|connection.*timeout/i, tag: '⏰ 连接超时', level: 'warn', cn: '连接服务器超时', fix: '检查网络/代理。' },
        { re: /CORS|cross[_\s]?origin/i, tag: '🚧 跨域错误', level: 'err', cn: '浏览器跨域(CORS)被拦截', fix: '中转站没正确配置 CORS。' },
        { re: /SSL|certificate|self[_\s]?signed/i, tag: '🔒 SSL证书错误', level: 'err', cn: 'SSL 证书校验失败', fix: '中转站用了自签证书，或换 https 正规站。' },
        { re: /chat.*not.*found|character.*not.*found/i, tag: '👤 角色丢失', level: 'err', cn: '聊天/角色卡未找到', fix: '可能是角色卡被删了；尝试重启 ST。' },
        { re: /world[_\s]?info|lorebook.*error/i, tag: '📚 世界书错误', level: 'warn', cn: '世界书加载错误', fix: '检查世界书 JSON 格式。' },
        { re: /preset.*not.*found|preset.*invalid/i, tag: '⚙️ 预设错误', level: 'err', cn: '预设文件错误或丢失', fix: '重新导入预设。' },
        { re: /extension.*failed|extension.*error/i, tag: '🧩 扩展加载失败', level: 'warn', cn: '某个扩展加载失败', fix: '在 Extensions 里禁用问题扩展。' },
        { re: /no[_\s]?available[_\s]?channel/i, tag: '🔌 无可用渠道', level: 'err', cn: 'New-API：当前分组下没有可用渠道', fix: '后台「渠道」启用对应模型。' },
        { re: /distributor|new_api_error/i, tag: '🔌 New-API 分发错误', level: 'err', cn: 'New-API 中转站分发失败', fix: '查看 New-API 日志。' },
        { re: /channel.*disabled|channel.*banned/i, tag: '🔌 渠道被禁用', level: 'err', cn: '中转渠道已被禁用', fix: '后台启用渠道。' },
        { re: /unexpected token|JSON\.parse|invalid json|SyntaxError/i, tag: '📝 JSON解析失败', level: 'err', cn: '响应不是合法 JSON', fix: '通常是上游返回了 HTML 错误页。' },
        { re: /stream.*error|sse.*error|EventStream/i, tag: '📡 流式响应错误', level: 'err', cn: '流式(SSE)响应中断', fix: '关闭 streaming 试试非流式。' },
        { re: /error/i, tag: '⚠️ 通用错误', level: 'warn', cn: '检测到错误信息', fix: '查看下方机翻获取详细内容。' },
    ];

    function matchErrorDict(text) {
        if (!text) return null;
        for (const item of ERROR_DICT) if (item.re.test(text)) return item;
        return null;
    }

    function isMobileDevice() {
        return window.innerWidth < 768 || ('ontouchstart' in window) ||
               /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }

    // ============ Toast ============
    function showToast(msg, duration = 2500) {
        const old = document.getElementById('dog-toast');
        if (old) old.remove();
        const t = document.createElement('div');
        t.id = 'dog-toast';
        t.textContent = msg;

        const mobile = isMobileDevice();
        const posCss = mobile
            ? 'left:50%;top:18%;transform:translateX(-50%);'
            : 'left:50%;top:50%;transform:translate(-50%,-50%);';

        t.style.cssText = `
            position:fixed;${posCss}
            z-index:2147483647;background:linear-gradient(135deg,#667eea,#764ba2);
            color:#fff;padding:14px 24px;border-radius:30px;font-size:15px;
            font-weight:600;
            box-shadow:0 8px 24px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.15);
            font-family:-apple-system,sans-serif;max-width:80vw;text-align:center;
            white-space:pre-line;pointer-events:none;
            opacity:0;transition:opacity .25s ease;`;
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

    // ============ 微软翻译 ============
    let edgeAuthToken = null;
    let edgeAuthExpire = 0;
    async function getEdgeToken() {
        if (edgeAuthToken && Date.now() < edgeAuthExpire) return edgeAuthToken;
        const res = await fetch('https://edge.microsoft.com/translate/auth');
        const tk = await res.text();
        edgeAuthToken = tk;
        edgeAuthExpire = Date.now() + 8 * 60 * 1000;
        return tk;
    }
    async function translateByEdge(text, toLang) {
        const token = await getEdgeToken();
        const url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${toLang}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ Text: text }])
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return { text: data[0].translations[0].text, from: data[0].detectedLanguage ? data[0].detectedLanguage.language : 'auto' };
    }

    // ============ 划词翻译 ============
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
            align-items:center;justify-content:center;
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
            font-size:14px;color:#333;font-family:-apple-system,sans-serif;`;
        bubble.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="color:#ff6b6b;font-weight:700;font-size:13px;">🌐 翻译中...</span>
                <span class="dog-tr-close" style="cursor:pointer;color:#999;font-size:18px;line-height:1;">×</span>
            </div>
            <div class="dog-tr-content" style="line-height:1.6;color:#666;font-size:14px;">⚡ 微软Edge引擎调用中...</div>
        `;
        document.body.appendChild(bubble);
        bubble.querySelector('.dog-tr-close').onclick = () => bubble.remove();
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
                }).catch(() => {});
            };
        }).catch(err => {
            bubble.querySelector('.dog-tr-content').innerHTML =
                `<div style="color:#ff6b6b;">❌ 翻译失败<br><small style="color:#999;">${err.message}</small></div>`;
        });
    }

    // ============ 错误码捕获 ============
    function injectErrorCatcher() {
        if (window._dogErrorCatcher) return;
        window._dogErrorCatcher = true;

        const captureFromEl = (el) => {
            try {
                const txt = (el.innerText || el.textContent || '').trim();
                if (txt && txt.length > 3) {
                    lastErrorMsg = txt;
                    lastErrorTime = Date.now();
                }
            } catch (e) {}
        };

        new MutationObserver((ms) => {
            ms.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.classList && (n.classList.contains('toast-error') || n.classList.contains('toast-warning'))) {
                    captureFromEl(n);
                }
                if (n.querySelectorAll) {
                    n.querySelectorAll('.toast-error, .toast-warning').forEach(captureFromEl);
                }
            }));
        }).observe(document.body, { childList: true, subtree: true });

        if (!window._dogFetchErrCaught) {
            window._dogFetchErrCaught = true;
            const origFetch = window.fetch;
            window.fetch = async function () {
                const res = await origFetch.apply(this, arguments);
                try {
                    if (!res.ok && res.clone) {
                        const c = res.clone();
                        c.text().then(body => {
                            if (body && body.length > 3 && body.length < 5000) {
                                lastErrorMsg = `[HTTP ${res.status}] ${body}`;
                                lastErrorTime = Date.now();
                            }
                        }).catch(() => {});
                    }
                } catch (e) {}
                return res;
            };
        }
    }

    function showErrorTranslate() {
        if (!lastErrorMsg) {
            showToast('🌟 暂无错误记录\n出现红色错误后再点这里就能翻译啦', 3500);
            return;
        }
        const ageMin = Math.floor((Date.now() - lastErrorTime) / 60000);
        const ageStr = ageMin < 1 ? '刚刚' : ageMin + '分钟前';
        const dictHit = matchErrorDict(lastErrorMsg);

        document.querySelectorAll('.dog-err-modal').forEach(el => el.remove());
        const wrapper = document.createElement('div');
        wrapper.className = 'dog-modal-wrapper dog-err-modal';

        const levelColor = dictHit
            ? (dictHit.level === 'err' ? '#ff5e5e' : dictHit.level === 'warn' ? '#ffa726' : '#42a5f5')
            : '#9e9e9e';

        const dictHtml = dictHit ? `
            <div style="background:linear-gradient(135deg,rgba(102,126,234,0.18),rgba(118,75,162,0.18));border:1px solid rgba(130,177,255,0.35);border-radius:12px;padding:14px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="background:${levelColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;">📖 字典命中</span>
                    <span style="color:#fff;font-weight:700;font-size:15px;">${dictHit.tag}</span>
                </div>
                <div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                    <div style="font-size:11px;color:#a8c1ff;font-weight:700;margin-bottom:4px;">💡 说明</div>
                    <div style="font-size:13px;color:#fff;line-height:1.6;">${dictHit.cn}</div>
                </div>
                <div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px 12px;">
                    <div style="font-size:11px;color:#80e0a8;font-weight:700;margin-bottom:4px;">🔧 解决方案</div>
                    <div style="font-size:13px;color:#e0ffe8;line-height:1.7;white-space:pre-wrap;">${dictHit.fix}</div>
                </div>
            </div>
        ` : `
            <div style="background:rgba(255,167,38,0.12);border:1px dashed rgba(255,167,38,0.4);border-radius:10px;padding:10px 12px;margin-bottom:12px;text-align:center;">
                <span style="color:#ffb74d;font-size:12px;">📖 字典未命中此错误，请查看下方机翻 ↓</span>
            </div>
        `;

        wrapper.innerHTML = `
            <div class="dog-modal-panel" style="max-width:560px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <span style="font-size:18px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;">
                        <span style="font-size:22px;">🩺</span>错误码翻译
                    </span>
                    <span style="font-size:11px;color:rgba(255,255,255,0.5);">${ageStr}</span>
                </div>
                ${dictHtml}
                <div style="background:rgba(255,107,107,0.12);border-left:3px solid #ff6b6b;padding:10px 12px;border-radius:8px;margin-bottom:12px;max-height:140px;overflow:auto;">
                    <div style="font-size:11px;color:#ff9999;font-weight:700;margin-bottom:4px;">📋 错误原文</div>
                    <div style="font-size:12px;color:#ffe0e0;line-height:1.5;font-family:Consolas,Menlo,monospace;word-break:break-all;white-space:pre-wrap;">${lastErrorMsg.replace(/</g,'&lt;')}</div>
                </div>
                <div style="background:rgba(130,177,255,0.12);border-left:3px solid #82b1ff;padding:10px 12px;border-radius:8px;margin-bottom:14px;max-height:160px;overflow:auto;">
                    <div style="font-size:11px;color:#a8c1ff;font-weight:700;margin-bottom:4px;">🌐 机器翻译</div>
                    <div id="dog-err-tr" style="font-size:12px;color:#e0e8ff;line-height:1.6;">⚡ 翻译中...</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button id="dog-err-copy" style="flex:1;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#ff6b6b,#ee5a6f);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">📋 复制原文</button>
                    <button id="dog-err-close" style="flex:1;padding:10px;border:none;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
        wrapper.querySelector('#dog-err-close').onclick = () => wrapper.remove();
        wrapper.querySelector('#dog-err-copy').onclick = (e) => {
            navigator.clipboard.writeText(lastErrorMsg).then(() => {
                e.target.textContent = '✅ 已复制';
                setTimeout(() => { e.target.textContent = '📋 复制原文'; }, 1500);
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = lastErrorMsg; document.body.appendChild(ta);
                ta.select(); document.execCommand('copy'); ta.remove();
                e.target.textContent = '✅ 已复制';
            });
        };

        const toTranslate = lastErrorMsg.length > 1500 ? lastErrorMsg.slice(0, 1500) : lastErrorMsg;
        translateByEdge(toTranslate, 'zh-Hans').then(({ text }) => {
            const el = wrapper.querySelector('#dog-err-tr');
            if (el) el.innerHTML = text.replace(/</g,'&lt;').replace(/\n/g,'<br>');
        }).catch(err => {
            const el = wrapper.querySelector('#dog-err-tr');
            if (el) el.innerHTML = `<span style="color:#ff9999;">❌ 翻译失败：${err.message}</span>`;
        });
    }

    // ====================================================
    // 📸 长截图 v3 — 自动展开折叠版
    // ====================================================
    function loadScriptOnce(url, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            let done = false;
            const timer = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error('超时')); } }, timeoutMs);
            s.src = url;
            s.crossOrigin = 'anonymous';
            s.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
            s.onerror = () => { if (!done) { done = true; clearTimeout(timer); s.remove(); reject(new Error('网络错误')); } };
            document.head.appendChild(s);
        });
    }

    let _shotEngine = null;
    async function loadShotEngine() {
        if (_shotEngine === 'modern' && window.modernScreenshot) return 'modern';
        if (_shotEngine === 'h2c' && window.html2canvas) return 'h2c';
        if (window.modernScreenshot) { _shotEngine = 'modern'; return 'modern'; }
        if (window.html2canvas) { _shotEngine = 'h2c'; return 'h2c'; }

        let lastErr = null;
        for (const cdn of SHOT_CDNS) {
            try {
                console.log('[DogTavern] 尝试加载截图引擎:', cdn.type, cdn.url);
                await loadScriptOnce(cdn.url);
                if (cdn.type === 'modern' && window.modernScreenshot) {
                    console.log('[DogTavern] ✨ modern-screenshot 加载成功');
                    _shotEngine = 'modern';
                    return 'modern';
                }
                if (cdn.type === 'h2c' && window.html2canvas) {
                    console.log('[DogTavern] html2canvas 加载成功（兜底模式）');
                    _shotEngine = 'h2c';
                    return 'h2c';
                }
            } catch (e) {
                console.warn('[DogTavern] CDN 失败:', cdn.url, e.message);
                lastErr = e;
            }
        }
        throw new Error('所有截图引擎 CDN 均失败' + (lastErr ? '（' + lastErr.message + '）' : ''));
    }

    function sanitizeModernCssInClone(clonedDoc) {
        try {
            const re = /\b(oklch|oklab|color-mix|lab|lch|hwb)\s*\([^)]*\)/gi;
            const all = clonedDoc.querySelectorAll('*');
            all.forEach(el => {
                const s = el.getAttribute && el.getAttribute('style');
                if (s && re.test(s)) {
                    el.setAttribute('style', s.replace(re, '#888'));
                }
            });
            clonedDoc.querySelectorAll('style').forEach(st => {
                if (st.textContent && re.test(st.textContent)) {
                    st.textContent = st.textContent.replace(re, '#888');
                }
            });
        } catch (e) { console.warn('[DogTavern] sanitize 失败:', e); }
    }

    // ====================================================
    // 🎯 核心新增：递归展开 doc 内所有折叠内容
    // 返回 restore 函数，截图后调用即可恢复原状
    // ====================================================
    function expandAllCollapsibles(doc) {
        const undos = [];

        try {
            // 1) <details> 标签
            doc.querySelectorAll('details').forEach(d => {
                if (!d.open) {
                    d.open = true;
                    undos.push(() => { d.open = false; });
                }
            });

            // 2) ST 推理块 / 思考块（mes_reasoning 等）
            doc.querySelectorAll('.mes_reasoning_details, .mes_reasoning').forEach(d => {
                if (d.tagName === 'DETAILS' && !d.open) {
                    d.open = true;
                    undos.push(() => { d.open = false; });
                }
                if (d.classList.contains('collapsed')) {
                    d.classList.remove('collapsed');
                    undos.push(() => d.classList.add('collapsed'));
                }
            });

            // 3) ST 长消息「show more」按钮 - 自动点开
            doc.querySelectorAll('.mes_text').forEach(t => {
                const cs = doc.defaultView ? doc.defaultView.getComputedStyle(t) : null;
                if (!cs) return;
                if (cs.maxHeight && cs.maxHeight !== 'none' && t.scrollHeight > t.clientHeight + 2) {
                    const oldMax = t.style.maxHeight;
                    const oldOver = t.style.overflow;
                    t.style.maxHeight = 'none';
                    t.style.overflow = 'visible';
                    undos.push(() => {
                        t.style.maxHeight = oldMax;
                        t.style.overflow = oldOver;
                    });
                }
            });

            // 4) 通用折叠类名 .collapsed / .is-collapsed / .closed / .folded
            const collapsedClassRe = /(^|\s)(collapsed|is-collapsed|closed|folded|hidden-content|is-hidden)(\s|$)/i;
            doc.querySelectorAll('[class*="collapsed"],[class*="folded"],[class*="closed"]').forEach(el => {
                const cls = el.className;
                if (typeof cls !== 'string') return;
                if (collapsedClassRe.test(cls)) {
                    const orig = cls;
                    const cleaned = cls.replace(/\b(collapsed|is-collapsed|closed|folded|hidden-content|is-hidden)\b/gi, '').replace(/\s+/g, ' ').trim();
                    el.className = cleaned;
                    undos.push(() => { el.className = orig; });
                }
            });

            // 5) aria-expanded="false" → 找对应的 panel 强制展开
            doc.querySelectorAll('[aria-expanded="false"]').forEach(el => {
                el.setAttribute('aria-expanded', 'true');
                undos.push(() => el.setAttribute('aria-expanded', 'false'));
                // 尝试触发其 click（很多自定义折叠靠 click）
                try {
                    const ctrls = el.getAttribute('aria-controls');
                    if (ctrls) {
                        const tgt = doc.getElementById(ctrls);
                        if (tgt) {
                            const oldDisp = tgt.style.display;
                            const oldMax = tgt.style.maxHeight;
                            const oldOver = tgt.style.overflow;
                            const oldVis = tgt.style.visibility;
                            tgt.style.display = '';
                            tgt.style.maxHeight = 'none';
                            tgt.style.overflow = 'visible';
                            tgt.style.visibility = 'visible';
                            tgt.hidden = false;
                            undos.push(() => {
                                tgt.style.display = oldDisp;
                                tgt.style.maxHeight = oldMax;
                                tgt.style.overflow = oldOver;
                                tgt.style.visibility = oldVis;
                            });
                        }
                    }
                } catch (e) {}
            });

            // 6) hidden 属性元素（注意：不能展开 dog-* 自己的）
            doc.querySelectorAll('[hidden]').forEach(el => {
                if (el.hasAttribute && (
                    el.hasAttribute('data-dog-tool-folder') ||
                    el.hasAttribute('data-dog-card-btn') ||
                    el.hasAttribute('data-dog-tr-btn')
                )) return;
                el.hidden = false;
                undos.push(() => { el.hidden = true; });
            });

            // 7) 含 max-height 限制 + overflow:hidden 的「假折叠」容器
            doc.querySelectorAll('.mes *').forEach(el => {
                try {
                    const cs = doc.defaultView ? doc.defaultView.getComputedStyle(el) : null;
                    if (!cs) return;
                    if (cs.overflow === 'hidden' &&
                        cs.maxHeight && cs.maxHeight !== 'none' &&
                        parseFloat(cs.maxHeight) > 0 &&
                        el.scrollHeight > el.clientHeight + 4) {
                        const oldMax = el.style.maxHeight;
                        const oldOver = el.style.overflow;
                        el.style.maxHeight = 'none';
                        el.style.overflow = 'visible';
                        undos.push(() => {
                            el.style.maxHeight = oldMax;
                            el.style.overflow = oldOver;
                        });
                    }
                } catch (e) {}
            });

            // 8) 尝试给所有「展开按钮」类元素发个 click（小心：会修改状态，但有 undo 兜底）
            //    匹配文字「展开 / 点击展开 / 查看更多 / show more / expand」
            const expandTextRe = /^[\s\u200B]*(展开|点击展开|点击查看|查看更多|查看完整|更多|show more|expand|read more|see more|更多内容|更多回帖)[\s\u200B…\.]*$/i;
            const candidates = Array.from(doc.querySelectorAll('a,button,div,span,p,summary'))
                .filter(el => {
                    if (el.children.length > 2) return false;
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (!txt || txt.length > 12) return false;
                    return expandTextRe.test(txt);
                });
            candidates.forEach(btn => {
                try {
                    btn.click();
                    // click 不易 undo，但折叠通常是单向（点了就展开），不影响截图
                } catch (e) {}
            });

        } catch (e) {
            console.warn('[DogTavern] expandAll 失败:', e);
        }

        return () => {
            // 倒序还原
            for (let i = undos.length - 1; i >= 0; i--) {
                try { undos[i](); } catch (e) {}
            }
        };
    }

    // 通用 iframe 预渲染
    async function snapshotIframe(iframe, engineType) {
        try {
            const doc = iframe.contentDocument;
            if (!doc || !doc.body) return null;

            // 🎯 先在 iframe 里展开所有折叠
            const restoreIframe = expandAllCollapsibles(doc);

            // 等字体加载
            try {
                if (doc.fonts && doc.fonts.ready) {
                    await Promise.race([
                        doc.fonts.ready,
                        new Promise(r => setTimeout(r, 1500))
                    ]);
                }
            } catch (e) {}

            // 等图片加载
            try {
                const imgs = Array.from(doc.querySelectorAll('img'));
                await Promise.all(imgs.map(img => {
                    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                    return new Promise(r => {
                        const t = setTimeout(r, 2000);
                        img.addEventListener('load', () => { clearTimeout(t); r(); }, { once: true });
                        img.addEventListener('error', () => { clearTimeout(t); r(); }, { once: true });
                    });
                }));
            } catch (e) {}

            // 等 layout 稳定（折叠内容展开后）
            void doc.body.offsetHeight;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await new Promise(r => setTimeout(r, 200));

            const w = iframe.offsetWidth || iframe.clientWidth || doc.body.scrollWidth;
            // 🎯 重新计算高度（展开后的真实高度）
            const h = Math.max(
                doc.body.scrollHeight,
                doc.documentElement.scrollHeight,
                doc.body.offsetHeight,
                doc.documentElement.offsetHeight
            );
            if (w < 5 || h < 5) {
                restoreIframe();
                return null;
            }

            let bg;
            try {
                bg = iframe.contentWindow.getComputedStyle(doc.body).backgroundColor;
                明白了，是 `<details>` 折叠块（reasoning/思考过程/可折叠世界书等）没展开。修复方案：截图前**强制展开所有 details**，截完再还原。

只需要替换 `generateLongScreenshot` 函数（其他不动）：

```javascript
async function generateLongScreenshot(scope = 'all', range = null) {
    showToast('📸 准备长截图...', 1500);

    let engineType;
    try {
        engineType = await loadShotEngine();
    } catch (e) {
        showToast('❌ 截图引擎加载失败\n请检查网络（详情见控制台）', 4000);
        console.error(e);
        return;
    }

    const chat = document.getElementById('chat') || document.querySelector('#chat');
    if (!chat) { showToast('❌ 找不到 #chat 容器'); return; }

    const allMes = Array.from(chat.querySelectorAll('.mes'));
    if (!allMes.length) { showToast('❌ 没有消息可截'); return; }

    let visibleSet;
    if (scope === 'ai') visibleSet = new Set(allMes.filter(m => m.getAttribute('is_user') !== 'true'));
    else if (scope === 'last10') visibleSet = new Set(allMes.slice(-10));
    else if (scope === 'last20') visibleSet = new Set(allMes.slice(-20));
    else if (scope === 'custom' && range) {
        const s = Math.max(0, range.start);
        const e = Math.min(allMes.length - 1, range.end);
        visibleSet = new Set(allMes.slice(s, e + 1));
    } else visibleSet = new Set(allMes);

    if (visibleSet.size === 0) { showToast('❌ 范围内没有消息'); return; }

    // 隐藏不在范围内的消息
    const hiddenList = [];
    allMes.forEach(m => {
        if (!visibleSet.has(m)) {
            hiddenList.push({ el: m, display: m.style.display });
            m.style.display = 'none';
        }
    });

    // 🎯 修复1：彻底 display:none 自己的 UI
    const dogUiHidden = [];
    document.querySelectorAll(
        '[data-dog-tool-folder],[data-dog-card-btn],[data-dog-tr-btn],#dog-toast,.dog-tr-bubble,.dog-modal-wrapper,.dog-folder-v2'
    ).forEach(el => {
        dogUiHidden.push({ el, display: el.style.display });
        el.style.display = 'none';
    });

    // 隐藏其它所有 fixed 浮层
    const floatingEls = [];
    document.querySelectorAll('body *').forEach(el => {
        try {
            if (el.hasAttribute && (
                el.hasAttribute('data-dog-tool-folder') ||
                el.hasAttribute('data-dog-card-btn') ||
                el.hasAttribute('data-dog-tr-btn')
            )) return;
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' && cs.visibility !== 'hidden' && el.offsetParent !== null) {
                floatingEls.push({ el, display: el.style.display });
                el.style.display = 'none';
            }
        } catch (e) {}
    });

    // 🎯 新修复：强制展开所有折叠块（details / collapsed / mes_reasoning 等）
    const expandedRecords = [];
    const visibleMesArr = Array.from(visibleSet);

    // 1) 展开 chat 内所有可见消息里的 <details>
    visibleMesArr.forEach(mes => {
        mes.querySelectorAll('details').forEach(d => {
            if (!d.open) {
                d.open = true;
                expandedRecords.push({ type: 'details', el: d });
            }
        });
        // 同时展开 iframe 内的 details（自定义HTML块里也常用）
        mes.querySelectorAll('iframe').forEach(ifr => {
            try {
                const idoc = ifr.contentDocument;
                if (idoc) {
                    idoc.querySelectorAll('details').forEach(d => {
                        if (!d.open) {
                            d.open = true;
                            expandedRecords.push({ type: 'details', el: d });
                        }
                    });
                }
            } catch (e) {}
        });
    });

    // 2) ST 常见的 collapsed/折叠类名 → 临时去掉
    const collapsedClasses = [
        'collapsed', 'mes_reasoning_collapsed',
        'reasoning_collapsed', 'is-collapsed',
        'closed', 'fold', 'folded', 'hidden-content'
    ];
    visibleMesArr.forEach(mes => {
        mes.querySelectorAll('*').forEach(el => {
            collapsedClasses.forEach(cls => {
                if (el.classList && el.classList.contains(cls)) {
                    el.classList.remove(cls);
                    expandedRecords.push({ type: 'class', el, cls });
                }
            });
        });
    });

    // 3) 强行把 .mes_reasoning_details / .mes_reasoning_content 等显示出来
    const forceShowSelectors = [
        '.mes_reasoning_details',
        '.mes_reasoning_content',
        '.mes_reasoning',
        '.mes_text',
        '.mes_block',
        '[hidden]'
    ];
    visibleMesArr.forEach(mes => {
        forceShowSelectors.forEach(sel => {
            mes.querySelectorAll(sel).forEach(el => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || el.hasAttribute('hidden')) {
                    expandedRecords.push({
                        type: 'show',
                        el,
                        display: el.style.display,
                        hidden: el.hasAttribute('hidden')
                    });
                    el.style.display = '';
                    if (el.hasAttribute('hidden')) el.removeAttribute('hidden');
                }
            });
        });
    });

    // 4) 自身 mes 如果被折叠（max-height 限制），临时解除
    const mesStyleRecords = [];
    visibleMesArr.forEach(mes => {
        mesStyleRecords.push({
            el: mes,
            maxHeight: mes.style.maxHeight,
            overflow: mes.style.overflow,
            height: mes.style.height
        });
        mes.style.maxHeight = 'none';
        mes.style.overflow = 'visible';
        mes.style.height = 'auto';
    });

    const oldOverflow = chat.style.overflow;
    const oldHeight = chat.style.height;
    const oldMaxHeight = chat.style.maxHeight;
    chat.style.overflow = 'visible';
    chat.style.height = 'auto';
    chat.style.maxHeight = 'none';

    if (expandedRecords.length > 0) {
        console.log(`[DogTavern] 已展开 ${expandedRecords.length} 个折叠块`);
    }

    // 🎯 修复2：永远预渲染 iframe
    const iframeReplacements = [];
    const iframes = Array.from(chat.querySelectorAll('iframe')).filter(ifr => {
        // 只渲染可见消息内的 iframe
        let p = ifr.parentElement;
        while (p && p !== chat) {
            if (p.classList && p.classList.contains('mes')) {
                return visibleSet.has(p);
            }
            p = p.parentElement;
        }
        return true;
    });

    if (iframes.length > 0) {
        showToast(`🖼️ 渲染 ${iframes.length} 个HTML块（请等候）...`, 3000);
        for (const ifr of iframes) {
            const snap = await snapshotIframe(ifr, engineType);
            if (!snap) {
                console.warn('[DogTavern] 跳过一个 iframe');
                continue;
            }
            try {
                const dataUrl = snap.canvas.toDataURL('image/png');
                const img = document.createElement('img');
                img.src = dataUrl;
                const cs = getComputedStyle(ifr);
                img.style.cssText = `display:block;width:${ifr.offsetWidth || snap.w}px;height:${ifr.offsetHeight || snap.h}px;max-width:100%;border:none;margin:${cs.margin};border-radius:${cs.borderRadius};`;
                const parent = ifr.parentNode;
                const nextSibling = ifr.nextSibling;
                parent.replaceChild(img, ifr);
                iframeReplacements.push({ iframe: ifr, placeholder: img, parent, nextSibling });
            } catch (e) {
                console.warn('iframe 替换失败', e);
            }
        }
    }

    // 强制 reflow + 等渲染稳定（折叠展开后需要更多时间）
    void chat.offsetHeight;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 600));

    try {
        if (document.fonts && document.fonts.ready) {
            await Promise.race([
                document.fonts.ready,
                new Promise(r => setTimeout(r, 1500))
            ]);
        }
    } catch (e) {}

    showToast(engineType === 'modern' ? '✨ 渲染中...' : '📸 渲染中...', 2500);

    let canvas;
    try {
        const bg = getComputedStyle(document.body).backgroundColor || '#1a1a2e';

        if (engineType === 'modern') {
            canvas = await window.modernScreenshot.domToCanvas(chat, {
                backgroundColor: bg,
                scale: Math.min(window.devicePixelRatio || 1, 2),
                width: chat.scrollWidth,
                height: chat.scrollHeight,
                fetch: { requestInit: { cache: 'force-cache' } },
                filter: (node) => {
                    if (!node) return true;
                    if (node.nodeType === 3) return true;
                    if (!node.getAttribute) return true;
                    if (node.hasAttribute && (
                        node.hasAttribute('data-dog-tool-folder') ||
                        node.hasAttribute('data-dog-card-btn') ||
                        node.hasAttribute('data-dog-tr-btn')
                    )) return false;
                    if (node.id === 'dog-toast') return false;
                    if (node.classList && (
                        node.classList.contains('dog-tr-bubble') ||
                        node.classList.contains('dog-modal-wrapper') ||
                        node.classList.contains('dog-folder-v2')
                    )) return false;
                    return true;
                }
            });
        } else {
            canvas = await window.html2canvas(chat, {
                backgroundColor: bg,
                useCORS: true, allowTaint: true, logging: false,
                imageTimeout: 10000,
                scale: Math.min(window.devicePixelRatio || 1, 2),
                width: chat.scrollWidth,
                height: chat.scrollHeight,
                windowWidth: chat.scrollWidth,
                windowHeight: chat.scrollHeight,
                scrollX: 0, scrollY: 0,
                onclone: (clonedDoc) => {
                    sanitizeModernCssInClone(clonedDoc);
                    clonedDoc.querySelectorAll('[data-dog-tool-folder],[data-dog-card-btn],[data-dog-tr-btn],#dog-toast,.dog-tr-bubble,.dog-modal-wrapper,.dog-folder-v2').forEach(n => n.remove());
                    // 克隆里也强制展开 details
                    clonedDoc.querySelectorAll('details').forEach(d => { d.open = true; });
                    const cChat = clonedDoc.getElementById('chat');
                    if (cChat) {
                        cChat.style.overflow = 'visible';
                        cChat.style.height = 'auto';
                        cChat.style.maxHeight = 'none';
                    }
                },
                ignoreElements: (el) => {
                    if (!el.getAttribute) return false;
                    if (el.hasAttribute('data-dog-tool-folder')) return true;
                    if (el.hasAttribute('data-dog-card-btn')) return true;
                    if (el.hasAttribute('data-dog-tr-btn')) return true;
                    if (el.id === 'dog-toast') return true;
                    if (el.classList && (
                        el.classList.contains('dog-folder-v2') ||
                        el.classList.contains('dog-tr-bubble')
                    )) return true;
                    return false;
                }
            });
        }
    } catch (e) {
        console.error('[DogTavern] 渲染失败:', e);
        showToast('❌ 渲染失败：' + (e.message || e) + '\n（详情见控制台）', 5000);
    } finally {
        // 还原 iframe
        iframeReplacements.forEach(({ iframe, placeholder, parent, nextSibling }) => {
            try {
                if (placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(iframe, placeholder);
                } else if (nextSibling && nextSibling.parentNode) {
                    nextSibling.parentNode.insertBefore(iframe, nextSibling);
                } else {
                    parent.appendChild(iframe);
                }
            } catch (e) { console.warn('iframe 还原失败:', e); }
        });

        // 还原折叠状态
        expandedRecords.forEach(rec => {
            try {
                if (rec.type === 'details') {
                    rec.el.open = false;
                } else if (rec.type === 'class') {
                    rec.el.classList.add(rec.cls);
                } else if (rec.type === 'show') {
                    rec.el.style.display = rec.display || '';
                    if (rec.hidden) rec.el.setAttribute('hidden', '');
                }
            } catch (e) {}
        });

        // 还原 mes 自身样式
        mesStyleRecords.forEach(rec => {
            try {
                rec.el.style.maxHeight = rec.maxHeight;
                rec.el.style.overflow = rec.overflow;
                rec.el.style.height = rec.height;
            } catch (e) {}
        });

        hiddenList.forEach(({ el, display }) => { el.style.display = display; });
        chat.style.overflow = oldOverflow;
        chat.style.height = oldHeight;
        chat.style.maxHeight = oldMaxHeight;
        floatingEls.forEach(({ el, display }) => { el.style.display = display; });
        dogUiHidden.forEach(({ el, display }) => { el.style.display = display; });
    }

    if (!canvas) return;

    try {
        const footerH = 50;
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = canvas.width;
        finalCanvas.height = canvas.height + footerH;
        const fctx = finalCanvas.getContext('2d');
        const bg = getComputedStyle(document.body).backgroundColor || '#1a1a2e';
        fctx.fillStyle = bg;
        fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        fctx.drawImage(canvas, 0, 0);
        fctx.fillStyle = 'rgba(255,255,255,0.5)';
        fctx.font = `${Math.max(14, finalCanvas.width / 60)}px -apple-system,sans-serif`;
        fctx.textAlign = 'center';
        const date = new Date();
        const ds = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
        const engineTag = engineType === 'modern' ? '✨' : '📸';
        fctx.fillText(`🐶🦴 SillyTavern · 小狗酒馆 Lite ${engineTag}  ·  ${ds}  ·  ${visibleSet.size} 条`, finalCanvas.width / 2, canvas.height + 30);

        saveCanvas(finalCanvas, `Tavern_LongShot_${Date.now()}.png`);
    } catch (e) {
        console.error(e);
        showToast('❌ 保存失败：' + e.message, 3500);
    }
}
