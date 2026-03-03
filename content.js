let debounceTimer;
const tooltip = document.createElement('div');
tooltip.id = 'de-ur-tooltip';
document.body.appendChild(tooltip);

document.addEventListener('mousemove', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
            const text = range.startContainer.textContent;
            const offset = range.startOffset;
            const start = text.lastIndexOf(' ', offset) + 1;
            const end = text.indexOf(' ', offset);
            const word = text.substring(start, end !== -1 ? end : text.length)
                             .replace(/[^\wäöüßÄÖÜa-zA-Z]/g, '').trim();

            if (word.length > 2) {
                updateTooltip(word, e.pageX, e.pageY);
            }
        }
    }, 500);
});

async function updateTooltip(word, x, y) {
    tooltip.style.display = 'block';
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.innerHTML = '<i>Translating...</i>';

    try {
        const [enRes, urRes] = await Promise.all([
            fetch(`https://api.mymemory.translated.net/get?q=${word}&langpair=de|en`).then(r => r.json()),
            fetch(`https://api.mymemory.translated.net/get?q=${word}&langpair=de|ur`).then(r => r.json())
        ]);
        tooltip.innerHTML = 
            `<div class="word-header">${word}</div>` +
            `<div class="trans-en"><b>EN:</b> ${enRes.responseData.translatedText}</div>` +
            `<div class="trans-ur">${urRes.responseData.translatedText}</div>`;
    } catch (err) {
        tooltip.innerHTML = 'Connection Error';
    }
}
document.addEventListener('mousedown', () => tooltip.style.display = 'none');