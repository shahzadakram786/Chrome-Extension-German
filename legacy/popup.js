const toggle = document.getElementById('statusToggle');
const sourceSelect = document.getElementById('sourceLangSelect');
const targetSelect = document.getElementById('targetLangSelect');

chrome.storage.local.get(['isEnabled', 'sourceLang', 'targetLang'], (res) => {
    toggle.checked = res.isEnabled !== false;
    if (res.sourceLang) sourceSelect.value = res.sourceLang;
    if (res.targetLang) targetSelect.value = res.targetLang;
});

sourceSelect.onchange = () => chrome.storage.local.set({ sourceLang: sourceSelect.value });
targetSelect.onchange = () => chrome.storage.local.set({ targetLang: targetSelect.value });
toggle.onchange = () => chrome.storage.local.set({ isEnabled: toggle.checked });
const elements = {
    toggle: document.getElementById('statusToggle'),
    source: document.getElementById('sourceLangSelect'),
    target: document.getElementById('targetLangSelect')
};

chrome.storage.local.get(['isEnabled', 'sourceLang', 'targetLang'], (res) => {
    elements.toggle.checked = res.isEnabled !== false;
    if (res.sourceLang) elements.source.value = res.sourceLang;
    if (res.targetLang) elements.target.value = res.targetLang;
});

elements.toggle.onchange = () => chrome.storage.local.set({ isEnabled: elements.toggle.checked });
elements.source.onchange = () => chrome.storage.local.set({ sourceLang: elements.source.value });
elements.target.onchange = () => chrome.storage.local.set({ targetLang: elements.target.value });