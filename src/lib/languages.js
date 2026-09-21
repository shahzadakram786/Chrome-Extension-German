/**
 * Shared language table. Loaded as a classic script by the content scripts,
 * by importScripts() in the service worker, and by <script> in the pages,
 * so everything hangs off globalThis rather than using ES exports.
 */
(function () {
  const L = {
    auto: { name: 'Auto-detect', native: 'Auto', bcp47: '', flag: '🌐' },
    ar: { name: 'Arabic', native: 'العربية', bcp47: 'ar-SA', rtl: true, flag: '🇸🇦' },
    bn: { name: 'Bengali', native: 'বাংলা', bcp47: 'bn-BD', flag: '🇧🇩' },
    cs: { name: 'Czech', native: 'Čeština', bcp47: 'cs-CZ', flag: '🇨🇿' },
    da: { name: 'Danish', native: 'Dansk', bcp47: 'da-DK', flag: '🇩🇰' },
    de: { name: 'German', native: 'Deutsch', bcp47: 'de-DE', flag: '🇩🇪' },
    el: { name: 'Greek', native: 'Ελληνικά', bcp47: 'el-GR', flag: '🇬🇷' },
    en: { name: 'English', native: 'English', bcp47: 'en-US', flag: '🇬🇧' },
    es: { name: 'Spanish', native: 'Español', bcp47: 'es-ES', flag: '🇪🇸' },
    fa: { name: 'Persian', native: 'فارسی', bcp47: 'fa-IR', rtl: true, flag: '🇮🇷' },
    fi: { name: 'Finnish', native: 'Suomi', bcp47: 'fi-FI', flag: '🇫🇮' },
    fr: { name: 'French', native: 'Français', bcp47: 'fr-FR', flag: '🇫🇷' },
    he: { name: 'Hebrew', native: 'עברית', bcp47: 'he-IL', rtl: true, flag: '🇮🇱' },
    hi: { name: 'Hindi', native: 'हिन्दी', bcp47: 'hi-IN', flag: '🇮🇳' },
    hu: { name: 'Hungarian', native: 'Magyar', bcp47: 'hu-HU', flag: '🇭🇺' },
    id: { name: 'Indonesian', native: 'Indonesia', bcp47: 'id-ID', flag: '🇮🇩' },
    it: { name: 'Italian', native: 'Italiano', bcp47: 'it-IT', flag: '🇮🇹' },
    ja: { name: 'Japanese', native: '日本語', bcp47: 'ja-JP', flag: '🇯🇵' },
    ko: { name: 'Korean', native: '한국어', bcp47: 'ko-KR', flag: '🇰🇷' },
    ms: { name: 'Malay', native: 'Melayu', bcp47: 'ms-MY', flag: '🇲🇾' },
    nl: { name: 'Dutch', native: 'Nederlands', bcp47: 'nl-NL', flag: '🇳🇱' },
    no: { name: 'Norwegian', native: 'Norsk', bcp47: 'nb-NO', flag: '🇳🇴' },
    pl: { name: 'Polish', native: 'Polski', bcp47: 'pl-PL', flag: '🇵🇱' },
    ps: { name: 'Pashto', native: 'پښتو', bcp47: 'ps-AF', rtl: true, flag: '🇦🇫' },
    pt: { name: 'Portuguese', native: 'Português', bcp47: 'pt-BR', flag: '🇵🇹' },
    ro: { name: 'Romanian', native: 'Română', bcp47: 'ro-RO', flag: '🇷🇴' },
    ru: { name: 'Russian', native: 'Русский', bcp47: 'ru-RU', flag: '🇷🇺' },
    sv: { name: 'Swedish', native: 'Svenska', bcp47: 'sv-SE', flag: '🇸🇪' },
    th: { name: 'Thai', native: 'ไทย', bcp47: 'th-TH', flag: '🇹🇭' },
    tr: { name: 'Turkish', native: 'Türkçe', bcp47: 'tr-TR', flag: '🇹🇷' },
    uk: { name: 'Ukrainian', native: 'Українська', bcp47: 'uk-UA', flag: '🇺🇦' },
    ur: { name: 'Urdu', native: 'اردو', bcp47: 'ur-PK', rtl: true, flag: '🇵🇰' },
    vi: { name: 'Vietnamese', native: 'Tiếng Việt', bcp47: 'vi-VN', flag: '🇻🇳' },
    'zh-CN': { name: 'Chinese (Simplified)', native: '简体中文', bcp47: 'zh-CN', flag: '🇨🇳' },
    'zh-TW': { name: 'Chinese (Traditional)', native: '繁體中文', bcp47: 'zh-TW', flag: '🇹🇼' }
  };

  // The translation API answers with plain "zh" sometimes; keep lookups forgiving.
  const ALIAS = { zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', iw: 'he', in: 'id', jw: 'jv' };

  const get = (code) => L[code] || L[ALIAS[code]] || null;

  /**
   * Windows has no flag glyphs: a regional-indicator pair renders as two
   * letters, so "🇩🇪 German" comes out as "DE German" and "🇬🇧 English" as
   * "GB English" — which reads like a typo. Measure once whether the pair
   * composes into a single glyph, and drop flags entirely when it does not.
   */
  let flagSupport = null;
  function flagsRender() {
    if (flagSupport !== null) return flagSupport;
    flagSupport = false;
    try {
      if (typeof document === 'undefined') return flagSupport;
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return flagSupport;

      // Draw in pure black. A real flag is a colour glyph and paints its own
      // colours regardless of fillStyle; letter fallbacks stay black. Measuring
      // widths does not work here — Windows has real glyphs for the regional
      // indicators, so the pair is exactly as wide as a composed flag would be.
      ctx.fillStyle = '#000000';
      ctx.font = '20px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('🇩🇪', 0, 0); // 🇩🇪

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 32) continue; // ignore near-transparent pixels
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Any meaningfully non-grey pixel means a colour glyph was painted.
        if (Math.max(r, g, b) - Math.min(r, g, b) > 24) {
          flagSupport = true;
          break;
        }
      }
    } catch (e) {
      flagSupport = false; // a blocked canvas just means plain names
    }
    return flagSupport;
  }

  globalThis.GL_LANGS = L;

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    langs: L,
    lang: get,
    /** Human label, falling back to the raw code so unknown codes still render. */
    langName: (code) => (get(code) ? get(code).name : (code || 'unknown')),
    /** Resolves aliases to the code this extension uses, or null if unknown. */
    canonical: (code) => {
      if (!code) return null;
      if (L[code]) return code;
      if (ALIAS[code] && L[ALIAS[code]]) return ALIAS[code];
      const base = String(code).split('-')[0];
      if (L[base]) return base;
      if (ALIAS[base] && L[ALIAS[base]]) return ALIAS[base];
      return null;
    },
    flagsRender,
    /** Empty string where flags do not render, so callers can concatenate safely. */
    langFlag: (code) => (flagsRender() && get(code) ? get(code).flag : ''),
    /** "🇩🇪 German" where flags render, plain "German" where they do not. */
    langLabel: (code) => {
      const name = get(code) ? get(code).name : code || 'unknown';
      const flag = flagsRender() && get(code) ? get(code).flag : '';
      return flag ? flag + ' ' + name : name;
    },
    isRtl: (code) => !!(get(code) && get(code).rtl),
    /** BCP-47 tag for speechSynthesis; undefined lets the browser choose. */
    bcp47: (code) => (get(code) ? get(code).bcp47 : undefined),
    /** Codes in alphabetical order by English name, auto-detect first. */
    sortedCodes: (withAuto) => {
      const codes = Object.keys(L).filter((c) => c !== 'auto');
      codes.sort((a, b) => L[a].name.localeCompare(L[b].name));
      return withAuto ? ['auto'].concat(codes) : codes;
    }
  });
})();
