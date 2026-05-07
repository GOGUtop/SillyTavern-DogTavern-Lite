/**
 * 🐶 小狗酒馆 Lite v1.4.2
 * 修复：
 *  - 截图前自动展开所有 <details> / collapsed / hidden 折叠块
 *  - iframe 内部折叠也会自动展开
 *  - iframe 永远预渲染（解决学生证等HTML块糊掉）
 *  - 截图期间所有 dog-* UI 元素 display:none（解决紫色脚印残影）
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
                    _shotEngine = 'modern';
                    return 'modern';
                }
                if (cdn.type === 'h2c' && window.html2canvas) {
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
            clonedDoc.querySelectorAll('*').forEach(el => {
                const s = el.getAttribute && el.getAttribute('style');
                if (s && re.test(s)) el.setAttribute('style', s.replace(re, '#888'));
            });
            clonedDoc.querySelectorAll('style').forEach(st => {
                if (st.textContent && re.test(st.textContent)) {
                    st.textContent = st.textContent.replace(re, '#888');
                }
            });
        } catch (e) {}
    }

    // 通用 iframe 预渲染
    async function snapshotIframe(iframe, engineType) {
        try {
            const doc = iframe.contentDocument;
            if (!doc || !doc.body) return null;

            // 展开 iframe 内的 details
            const reopenList = [];
            doc.querySelectorAll('details').forEach(d => {
                if (!d.open) { d.open = true; reopenList.push(d); }
            });

            try {
                if (doc.fonts && doc.fonts.ready) {
                    await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
                }
            } catch (e) {}

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

            void doc.body.offsetHeight;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await new Promise(r => setTimeout(r, 200));

            const w = iframe.offsetWidth || iframe.clientWidth || doc.body.scrollWidth;
            const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, iframe.offsetHeight || 0);
            if (w < 5 || h < 5) {
                reopenList.forEach(d => { d.open = false; });
                return null;
            }

            let bg;
            try {
                bg = iframe.contentWindow.getComputedStyle(doc.body).backgroundColor;
                if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = null;
            } catch (e) { bg = null; }

            const scale = Math.min(window.devicePixelRatio || 1, 2);
            let canvas;
            if (engineType === 'modern' && window.modernScreenshot) {
                canvas = await window.modernScreenshot.domToCanvas(doc.documentElement, {
                    backgroundColor: bg, scale, width: w, height: h,
                    fetch: { requestInit: { cache: 'force-cache' } }
                });
            } else if (window.html2canvas) {
                canvas = await window.html2canvas(doc.body, {
                    backgroundColor: bg, useCORS: true, allowTaint: true, logging: false,
                    imageTimeout: 8000, scale, width: w, height: h,
                    windowWidth: w, windowHeight: h,
                    onclone: (cd) => {
                        sanitizeModernCssInClone(cd);
                        cd.querySelectorAll('details').forEach(d => { d.open = true; });
                    }
                });
            }

            // 还原 iframe 内 details
            reopenList.forEach(d => { d.open = false; });

            return canvas ? { canvas, w, h } : null;
        } catch (e) {
            console.warn('[DogTavern] iframe 渲染失败:', e);
            return null;
        }
    }

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

        // 隐藏自己的UI
        const dogUiHidden = [];
        document.querySelectorAll(
            '[data-dog-tool-folder],[data-dog-card-btn],[data-dog-tr-btn],#dog-toast,.dog-tr-bubble,.dog-modal-wrapper,.dog-folder-v2'
        ).forEach(el => {
            dogUiHidden.push({ el, display: el.style.display });
            el.style.display = 'none';
        });

        // 隐藏其它 fixed 浮层
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

        // 🎯 展开所有可见消息内的折叠块
        const expandedRecords = [];
        const visibleMesArr = Array.from(visibleSet);
        const collapsedClasses = ['collapsed','mes_reasoning_collapsed','reasoning_collapsed','is-collapsed','closed','folded','hidden-content'];

        visibleMesArr.forEach(mes => {
            // <details>
            mes.querySelectorAll('details').forEach(d => {
                if (!d.open) {
                    d.open = true;
                    expandedRecords.push({ type: 'details', el: d });
                }
            });
            // collapsed 类名
            mes.querySelectorAll('*').forEach(el => {
                collapsedClasses.forEach(cls => {
                    if (el.classList && el.classList.contains(cls)) {
                        el.classList.remove(cls);
                        expandedRecords.push({ type: 'class', el, cls });
                    }
                });
            });
            // hidden 属性 / display:none 的关键容器
            ['.mes_reasoning_details','.mes_reasoning_content','.mes_reasoning','[hidden]'].forEach(sel => {
                mes.querySelectorAll(sel).forEach(el => {
                    if (el.hasAttribute && (el.hasAttribute('data-dog-tool-folder') || el.hasAttribute('data-dog-card-btn') || el.hasAttribute('data-dog-tr-btn'))) return;
                    const cs = getComputedStyle(el);
                    const wasHidden = el.hasAttribute('hidden');
                    if (cs.display === 'none' || wasHidden) {
                        expandedRecords.push({ type: 'show', el, display: el.style.display, hidden: wasHidden });
                        el.style.display = '';
                        if (wasHidden) el.removeAttribute('hidden');
                    }
                });
            });
        });

        // mes 自身 max-height
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

        // iframe 预渲染
        const iframeReplacements = [];
        const iframes = Array.from(chat.querySelectorAll('iframe')).filter(ifr => {
            let p = ifr.parentElement;
            while (p && p !== chat) {
                if (p.classList && p.classList.contains('mes')) return visibleSet.has(p);
                p = p.parentElement;
            }
            return true;
        });

        if (iframes.length > 0) {
            showToast(`🖼️ 渲染 ${iframes.length} 个HTML块（请等候）...`, 3000);
            for (const ifr of iframes) {
                const snap = await snapshotIframe(ifr, engineType);
                if (!snap) continue;
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
                } catch (e) { console.warn('iframe 替换失败', e); }
            }
        }

        void chat.offsetHeight;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 600));

        try {
            if (document.fonts && document.fonts.ready) {
                await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
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
                        if (el.classList && (el.classList.contains('dog-folder-v2') || el.classList.contains('dog-tr-bubble'))) return true;
                        return false;
                    }
                });
            }
        } catch (e) {
            console.error('[DogTavern] 渲染失败:', e);
            showToast('❌ 渲染失败：' + (e.message || e) + '\n（详情见控制台）', 5000);
        } finally {
            iframeReplacements.forEach(({ iframe, placeholder, parent, nextSibling }) => {
                try {
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(iframe, placeholder);
                    } else if (nextSibling && nextSibling.parentNode) {
                        nextSibling.parentNode.insertBefore(iframe, nextSibling);
                    } else {
                        parent.appendChild(iframe);
                    }
                } catch (e) {}
            });

            // 还原折叠
            expandedRecords.forEach(rec => {
                try {
                    if (rec.type === 'details') rec.el.open = false;
                    else if (rec.type === 'class') rec.el.classList.add(rec.cls);
                    else if (rec.type === 'show') {
                        rec.el.style.display = rec.display || '';
                        if (rec.hidden) rec.el.setAttribute('hidden', '');
                    }
                } catch (e) {}
            });

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

    function showLongShotMenu() {
        const old = document.getElementById('dog-shot-wrapper');
        if (old) old.remove();
        const allMes = document.querySelectorAll('#chat .mes, .mes');
        const total = allMes.length;
        const maxIdx = Math.max(0, total - 1);

        const wrapper = document.createElement('div');
        wrapper.id = 'dog-shot-wrapper';
        wrapper.className = 'dog-modal-wrapper';
        const panel = document.createElement('div');
        panel.className = 'dog-modal-panel';
        panel.innerHTML = `
            <div style="font-size:28px;text-align:center;margin-bottom:6px;">📸</div>
            <div style="font-size:18px;font-weight:700;text-align:center;color:#fff;margin-bottom:6px;">长截图范围</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:6px;">当前共 <b style="color:#fee140;">${total}</b> 楼（楼层号 0 ~ ${maxIdx}）</div>
            <div style="font-size:10px;color:rgba(130,177,255,0.7);text-align:center;margin-bottom:14px;">✨ 自动展开折叠 · HTML块预渲染</div>
            <div style="background:rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:12px;">
                <div style="font-size:13px;color:#fee140;font-weight:700;margin-bottom:8px;">🎯 自定义楼层</div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <input id="dog-shot-from" type="number" min="0" max="${maxIdx}" placeholder="起" value="0"
                        style="flex:1;padding:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;border-radius:6px;font-size:14px;text-align:center;">
                    <span style="color:rgba(255,255,255,0.6);">~</span>
                    <input id="dog-shot-to" type="number" min="0" max="${maxIdx}" placeholder="止" value="${maxIdx}"
                        style="flex:1;padding:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;border-radius:6px;font-size:14px;text-align:center;">
                    <button id="dog-shot-go" style="padding:8px 14px;border:none;border-radius:6px;background:linear-gradient(135deg,#fa709a,#fee140);color:#3e2723;font-weight:700;font-size:13px;cursor:pointer;">✨ 截取</button>
                </div>
            </div>
            <button data-scope="all" class="dog-poster-btn" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">
                <span style="font-size:24px;">📜</span>
                <span style="flex:1;text-align:left;"><span style="display:block;font-size:14px;font-weight:700;">全部消息</span><span style="display:block;font-size:11px;opacity:0.8;">完整对话历史（${total}条）</span></span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="ai" class="dog-poster-btn" style="background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;">
                <span style="font-size:24px;">🤖</span>
                <span style="flex:1;text-align:left;"><span style="display:block;font-size:14px;font-weight:700;">仅 AI 消息</span><span style="display:block;font-size:11px;opacity:0.8;">只导出AI回复</span></span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="last10" class="dog-poster-btn" style="background:linear-gradient(135deg,#11998e,#38ef7d);color:#fff;">
                <span style="font-size:24px;">🔟</span>
                <span style="flex:1;text-align:left;"><span style="display:block;font-size:14px;font-weight:700;">最近 10 条</span><span style="display:block;font-size:11px;opacity:0.8;">最新片段</span></span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button data-scope="last20" class="dog-poster-btn" style="background:linear-gradient(135deg,#fa709a,#fee140);color:#3e2723;">
                <span style="font-size:24px;">2️⃣0️⃣</span>
                <span style="flex:1;text-align:left;"><span style="display:block;font-size:14px;font-weight:700;">最近 20 条</span><span style="display:block;font-size:11px;opacity:0.8;">中等长度</span></span>
                <span style="opacity:0.5;">›</span>
            </button>
            <button class="dog-cancel-btn" id="dog-shot-cancel">取消</button>
        `;
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
        panel.querySelector('#dog-shot-cancel').onclick = () => wrapper.remove();
        panel.querySelector('#dog-shot-go').onclick = () => {
            const from = parseInt(panel.querySelector('#dog-shot-from').value);
            const to = parseInt(panel.querySelector('#dog-shot-to').value);
            if (isNaN(from) || isNaN(to)) { showToast('❌ 请输入有效楼层数字'); return; }
            if (from < 0 || to > maxIdx) { showToast(`❌ 楼层范围应在 0 ~ ${maxIdx}`); return; }
            if (from > to) { showToast('❌ 起始楼层不能大于结束楼层'); return; }
            wrapper.remove();
            generateLongScreenshot('custom', { start: from, end: to });
        };
        panel.querySelectorAll('[data-scope]').forEach(b => {
            b.onclick = () => { const scope = b.getAttribute('data-scope'); wrapper.remove(); generateLongScreenshot(scope); };
        });
    }

    // ====================================================
    // 🐾 悬浮球 + 玻璃拟态菜单
    // ====================================================
    function injectFloatingMenu() {
        if (document.querySelector('[data-dog-tool-folder]')) return;

        if (!document.getElementById('dog-folder-style-v2')) {
            const st = document.createElement('style');
            st.id = 'dog-folder-style-v2';
            st.textContent = `
                .dog-folder-v2{position:fixed;top:50%;right:12px;z-index:2147483640;font-family:-apple-system,"PingFang SC",sans-serif;}
                .dog-trigger-v2{
                    width:54px;height:54px;border-radius:50%;cursor:pointer;
                    background:radial-gradient(circle at 30% 30%,#a78bfa,#7c3aed 60%,#4c1d95);
                    box-shadow:0 0 0 1px rgba(255,255,255,0.15) inset, 0 8px 24px rgba(124,58,237,0.55), 0 2px 8px rgba(0,0,0,0.3);
                    display:flex;align-items:center;justify-content:center;font-size:24px;
                    transition:transform .25s cubic-bezier(.34,1.56,.64,1), background .2s;
                    user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
                    position:relative;color:#fff;
                }
                .dog-trigger-v2::before{
                    content:'';position:absolute;inset:-4px;border-radius:50%;
                    background:conic-gradient(from 0deg,#a78bfa,#f472b6,#60a5fa,#a78bfa);
                    z-index:-1;opacity:0.5;filter:blur(6px);animation:dogSpin 4s linear infinite;
                }
                @keyframes dogSpin{to{transform:rotate(360deg);}}
                .dog-trigger-v2:active{transform:scale(0.92);}
                .dog-trigger-v2.open{background:radial-gradient(circle at 30% 30%,#fb7185,#e11d48 60%,#881337);}
                .dog-panel-v2{
                    position:absolute;right:64px;top:50%;
                    width:230px;padding:8px;
                    background:rgba(20,20,30,0.85);backdrop-filter:blur(20px) saturate(180%);
                    -webkit-backdrop-filter:blur(20px) saturate(180%);
                    border:1px solid rgba(255,255,255,0.12);border-radius:18px;
                    box-shadow:0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset;
                    flex-direction:column;gap:4px;
                    transform:translateY(-50%) scale(0.85);transform-origin:right center;
                    opacity:0;pointer-events:none;visibility:hidden;
                    transition:opacity .2s, transform .25s cubic-bezier(.34,1.56,.64,1), visibility .2s;
                    display:flex;
                }
                .dog-panel-v2.show{opacity:1;pointer-events:auto;visibility:visible;transform:translateY(-50%) scale(1);}
                .dog-row-v2{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;color:#fff;transition:background .15s;}
                .dog-row-v2:hover{background:rgba(255,255,255,0.08);}
                .dog-row-v2:active{background:rgba(255,255,255,0.14);}
                .dog-row-v2 .ico{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.3);}
                .dog-row-v2 .meta{flex:1;min-width:0;}
                .dog-row-v2 .title{font-size:13px;font-weight:600;line-height:1.2;display:flex;align-items:center;}
                .dog-row-v2 .desc{font-size:10.5px;color:rgba(255,255,255,0.5);margin-top:2px;line-height:1.2;}
                .dog-row-v2 .arrow{color:rgba(255,255,255,0.3);font-size:14px;}
                .dog-divider-v2{height:1px;background:rgba(255,255,255,0.08);margin:4px 8px;flex-shrink:0;}
                .dog-header-v2{padding:10px 12px 6px;display:flex;align-items:center;gap:8px;}
                .dog-header-v2 .logo{font-size:18px;}
                .dog-header-v2 .name{font-size:13px;font-weight:700;color:#fff;flex:1;}
                .dog-header-v2 .ver{font-size:10px;color:rgba(255,255,255,0.4);}
                .dog-badge-on{background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;margin-left:4px;}
                .dog-badge-off{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;margin-left:4px;}

                .dog-modal-wrapper{position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:2147483645;display:flex;align-items:center;justify-content:center;padding:16px;animation:dogFadeIn .2s ease;}
                @keyframes dogFadeIn{from{opacity:0;}to{opacity:1;}}
                .dog-modal-panel{background:linear-gradient(135deg,rgba(40,30,80,0.98),rgba(30,20,60,0.98));border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:18px;max-width:420px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
                .dog-poster-btn{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border:none;border-radius:12px;margin-bottom:8px;cursor:pointer;transition:transform .15s;font-family:-apple-system,sans-serif;}
                .dog-poster-btn:hover{transform:translateX(2px);}
                .dog-poster-btn:active{transform:scale(0.98);}
                .dog-cancel-btn{width:100%;padding:11px;margin-top:6px;border:none;border-radius:10px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);font-weight:600;font-size:13px;cursor:pointer;font-family:-apple-system,sans-serif;}
                .dog-cancel-btn:hover{background:rgba(255,255,255,0.16);color:#fff;}
                .dog-card-btn{position:fixed;z-index:2147483646;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:6px 12px;border-radius:18px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(102,126,234,0.5);user-select:none;-webkit-user-select:none;font-family:-apple-system,sans-serif;}
                .dog-about-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:rgba(255,255,255,0.8);line-height:1.5;}
            `;
            document.head.appendChild(st);
        }

        const folder = document.createElement('div');
        folder.setAttribute('data-dog-tool-folder', '1');
        folder.className = 'dog-folder-v2';

        try {
            const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
                folder.style.top = saved.top + 'px';
                folder.style.left = saved.left + 'px';
                folder.style.right = 'auto';
                folder.style.transform = 'none';
            }
        } catch (e) {}

        const trigger = document.createElement('div');
        trigger.className = 'dog-trigger-v2';
        trigger.textContent = '🐾';

        const panel = document.createElement('div');
        panel.className = 'dog-panel-v2';
        let isOpen = false;

        function row(iconBg, emoji, title, desc, onTap, badge) {
            const r = document.createElement('div');
            r.className = 'dog-row-v2';
            r.innerHTML = `
                <div class="ico" style="background:${iconBg};">${emoji}</div>
                <div class="meta">
                    <div class="title">${title}${badge || ''}</div>
                    <div class="desc">${desc}</div>
                </div>
                <div class="arrow">›</div>
            `;
            r.addEventListener('click', (e) => { e.stopPropagation(); onTap(); collapse(); });
            return r;
        }

        function buildPanel() {
            panel.innerHTML = '';
            const hd = document.createElement('div');
            hd.className = 'dog-header-v2';
            hd.innerHTML = `<span class="logo">🐶🦴</span><span class="name">小狗酒馆 Lite</span><span class="ver">v1.4.2</span>`;
            panel.appendChild(hd);
            const div1 = document.createElement('div'); div1.className = 'dog-divider-v2'; panel.appendChild(div1);

            panel.appendChild(row(
                'linear-gradient(135deg,#667eea,#764ba2)',
                settings.soundEnabled ? '🔊' : '🔇',
                '提示音', settings.soundEnabled ? '回复完成叮咚' : '已静音',
                () => {
                    settings.soundEnabled = !settings.soundEnabled; saveSettings();
                    showToast(settings.soundEnabled ? '🔊 提示音已开启' : '🔇 提示音已关闭');
                    if (settings.soundEnabled) playSound();
                },
                settings.soundEnabled ? '<span class="dog-badge-on">ON</span>' : '<span class="dog-badge-off">OFF</span>'
            ));
            panel.appendChild(row(
                'linear-gradient(135deg,#ff6b6b,#ee5a6f)',
                settings.translateEnabled ? '🌐' : '🚫',
                '划词翻译', settings.translateEnabled ? '选中文字弹出翻译' : '已禁用',
                () => {
                    settings.translateEnabled = !settings.translateEnabled; saveSettings();
                    showToast(settings.translateEnabled ? '🌐 划词翻译已开启' : '🚫 划词翻译已关闭');
                },
                settings.translateEnabled ? '<span class="dog-badge-on">ON</span>' : '<span class="dog-badge-off">OFF</span>'
            ));

            const div2 = document.createElement('div'); div2.className = 'dog-divider-v2'; panel.appendChild(div2);

            panel.appendChild(row('linear-gradient(135deg,#eb3349,#f45c43)', '🩺', '错误码翻译', '字典+机翻 解析报错', showErrorTranslate));
            panel.appendChild(row('linear-gradient(135deg,#43cea2,#185a9d)', '📸', '长截图', '自动展开折叠+预渲染', showLongShotMenu));
            panel.appendChild(row('linear-gradient(135deg,#f093fb,#f5576c)', '🔖', '生成卡片', '选中AI文字后弹出',
                () => showToast('💡 请先选中AI消息文字\n再点击弹出的"生成卡片"', 3500)));

            const div3 = document.createElement('div'); div3.className = 'dog-divider-v2'; panel.appendChild(div3);

            panel.appendChild(row('linear-gradient(135deg,#fa709a,#fee140)', '🎵', '测试提示音', '试听一下叮咚声',
                () => { if (!settings.soundEnabled) { showToast('🔇 声音已关闭'); return; } playSound(); showToast('🎵 叮咚~'); }));
            panel.appendChild(row('linear-gradient(135deg,#11998e,#38ef7d)', 'ℹ️', '关于', '查看插件信息', showAboutDialog));
        }

        function expand() {
            isOpen = true;
            trigger.classList.add('open');
            trigger.textContent = '✕';
            buildPanel();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => panel.classList.add('show'));
            });
        }
        function collapse() {
            isOpen = false;
            trigger.classList.remove('open');
            trigger.textContent = '🐾';
            panel.classList.remove('show');
        }
        window._dogCollapseFolder = collapse;

        let dragMoved = false, dragging = false;
        let startX = 0, startY = 0, startTop = 0, startLeft = 0;

        function dragStart(cx, cy) {
            dragging = true; dragMoved = false;
            startX = cx; startY = cy;
            const rect = folder.getBoundingClientRect();
            startTop = rect.top; startLeft = rect.left;
        }
        function dragMove(cx, cy) {
            if (!dragging) return;
            const dx = cx - startX, dy = cy - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMoved = true;
            if (dragMoved) {
                const w = folder.offsetWidth || 54;
                const h = folder.offsetHeight || 54;
                let t = Math.max(0, Math.min(window.innerHeight - h, startTop + dy));
                let l = Math.max(0, Math.min(window.innerWidth - w, startLeft + dx));
                folder.style.top = t + 'px';
                folder.style.left = l + 'px';
                folder.style.right = 'auto';
                folder.style.transform = 'none';
                if (isOpen) collapse();
            }
        }
        function dragEnd() {
            if (!dragging) return;
            dragging = false;
            if (dragMoved) {
                const r = folder.getBoundingClientRect();
                try { localStorage.setItem(POS_KEY, JSON.stringify({ top: r.top, left: r.left })); } catch (e) {}
            }
        }

        trigger.addEventListener('touchstart', (e) => {
            dragStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        trigger.addEventListener('touchmove', (e) => {
            dragMove(e.touches[0].clientX, e.touches[0].clientY);
            if (dragMoved) e.preventDefault();
        }, { passive: false });
        trigger.addEventListener('touchend', () => {
            const m = dragMoved; dragEnd();
            if (!m) { isOpen ? collapse() : expand(); }
        });
        trigger.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragStart(e.clientX, e.clientY);
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => { if (dragging) dragMove(e.clientX, e.clientY); });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            const m = dragMoved; dragEnd();
            if (!m && !('ontouchstart' in window)) { isOpen ? collapse() : expand(); }
        });

        folder.appendChild(trigger);
        folder.appendChild(panel);
        document.body.appendChild(folder);
    }

    function showAboutDialog() {
        const wrapper = document.createElement('div');
        wrapper.className = 'dog-modal-wrapper';
        wrapper.innerHTML = `
            <div class="dog-modal-panel">
                <div style="font-size:32px;text-align:center;margin-bottom:8px;">🐶🦴</div>
                <div style="font-size:19px;font-weight:700;text-align:center;margin-bottom:6px;color:#fff;">小狗酒馆 Lite</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:18px;">v1.4.2 · 跨平台增强插件</div>
                <div class="dog-about-card"><b>📸 长截图智能版</b><br/>自动展开折叠 / iframe预渲染 / 浮窗自动隐藏</div>
                <div class="dog-about-card"><b>🐾 玻璃拟态菜单</b><br/>可拖动 / 位置记忆</div>
                <div class="dog-about-card"><b>🩺 错误码字典翻译</b><br/>40+ 内置规则 + 机翻兜底</div>
                <div class="dog-about-card"><b>🔖 选中即生成卡片</b><br/>6种风格精美海报</div>
                <div class="dog-about-card"><b>🌐 划词翻译</b><br/>微软Edge引擎</div>
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

    function init() {
        console.log(`[${PLUGIN_NAME}] 🐶 v1.4.2 启动中...`);
        injectFloatingMenu();
        injectSelectionCard();
        injectTranslateUI();
        injectErrorCatcher();
        attachGenerationHooks();
        console.log(`[${PLUGIN_NAME}] ✅ 启动成功！`);
    }
    if (typeof jQuery !== 'undefined') {
        jQuery(() => setTimeout(init, 500));
    } else {
        if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 800);
        else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
    }
})();
