let isEnabled = true;
let sourceLang = 'auto';
let targetLang = 'en';
let debounceTimer;

// Load and Sync Settings
const updateSettings = (res) => {
    if (res.isEnabled !== undefined) isEnabled = res.isEnabled;
    if (res.sourceLang) sourceLang = res.sourceLang;
    if (res.targetLang) targetLang = res.targetLang;
};
chrome.storage.local.get(['isEnabled', 'sourceLang', 'targetLang'], updateSettings);
chrome.storage.onChanged.addListener((changes) => {
    if (changes.isEnabled) isEnabled = changes.isEnabled.newValue;
    if (changes.sourceLang) sourceLang = changes.sourceLang.newValue;
    if (changes.targetLang) targetLang = changes.targetLang.newValue;
});

const tooltip = document.createElement('div');
tooltip.id = 'uni-translator-tooltip';
document.body.appendChild(tooltip);

// Robust Translation Function (Fixed Auto-Detect)
async function getTranslation(text) {
    // We use the Google-GTX API as primary for Auto-Detect because it's much faster/accurate for detection
    const sl = sourceLang === 'auto' ? 'auto' : sourceLang;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    try {
        const res = await fetch(url).then(r => r.json());
        if (res && res[0]) {
            let translatedText = res[0].map(item => item[0]).join('');
            let detectedSource = res[2] || sourceLang; 
            return { translatedText, detectedSource };
        }
    } catch (e) {
        // Fallback to MyMemory if Google fails
        try {
            const pair = sourceLang === 'auto' ? `auto|${targetLang}` : `${sourceLang}|${targetLang}`;
            const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`).then(r => r.json());
            return { translatedText: res.responseData.translatedText, detectedSource: sourceLang };
        } catch (err) { return null; }
    }
    return null;
}

const showTooltip = async (text, x, y) => {
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.innerHTML = '<div style="color:#ffcc00; font-size:12px;">⏳ Detecting & Translating...</div>';

    const result = await getTranslation(text);
    if (!result || !result.translatedText) {
        tooltip.innerHTML = '<div style="color:#ff4444;">⚠️ Connection Busy. Try again.</div>';
        return;
    }

    tooltip.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start; border-bottom:1px solid #444; padding-bottom:5px; margin-bottom:8px;">
            <div style="color:#ffcc00; font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px;">${text}</div>
            <span id="uniSpeakBtn" style="cursor:pointer; font-size:20px; line-height:1;">🔊</span>
        </div>
        <div style="color:#00ffcc; font-size:17px; font-weight:bold; line-height:1.4;">${result.translatedText}</div>
        <div style="font-size:9px; color:#666; text-align:right; margin-top:5px; text-transform:uppercase;">
            ${result.detectedSource} → ${targetLang}
        </div>
    `;

    document.getElementById('uniSpeakBtn').onclick = (ev) => {
        ev.stopPropagation();
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = result.detectedSource === 'auto' ? 'de-DE' : result.detectedSource;
        window.speechSynthesis.speak(msg);
    };
};

// Selection Logic
document.addEventListener('mouseup', (e) => {
    if (!isEnabled || e.target.id === 'uniSpeakBtn') return;
    setTimeout(() => {
        const sel = window.getSelection().toString().trim();
        if (sel.length > 2) {
            const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
            showTooltip(sel, rect.left + window.scrollX, rect.bottom + window.scrollY);
        }
    }, 50);
});

// Hover Logic
document.addEventListener('mousemove', (e) => {
    if (!isEnabled || window.getSelection().toString().length > 0) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
            const txt = range.startContainer.textContent;
            const off = range.startOffset;
            const start = txt.lastIndexOf(' ', off) + 1;
            const end = txt.indexOf(' ', off) !== -1 ? txt.indexOf(' ', off) : txt.length;
            const word = txt.substring(start, end).replace(/[^\wäöüßÄÖÜa-zA-Z]/g, '').trim();
            if (word.length > 2) showTooltip(word, e.pageX, e.pageY);
        }
    }, 800);
});

document.addEventListener('mousedown', (e) => {
    if (!tooltip.contains(e.target)) tooltip.style.display = 'none';
});