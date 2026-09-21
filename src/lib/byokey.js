/**
 * Bring-your-own-key providers: DeepL and Google Cloud Translation.
 *
 * Why these exist alongside the free chain: the free path uses undocumented
 * public endpoints that rate-limit by IP and carry no usage terms. A user who
 * supplies their own key gets a documented, contractual endpoint with a quota
 * they control. The free chain stays the default so the extension works on
 * install without any setup.
 *
 * Only the request shaping and response parsing live here — the worker owns
 * the actual fetch, the same way it does for gtx.js and mymemory.js. That keeps
 * every parser testable without the network.
 */
(function () {
  /** The shape every provider returns; the worker treats these as interchangeable. */
  const blank = (requestedSource) => ({
    text: '',
    detected: requestedSource,
    confidence: 1,
    senses: [],
    pos: '',
    romanSource: '',
    romanTarget: '',
    examples: []
  });

  /* ------------------------------------------------------------- DeepL -- */

  /**
   * DeepL translates fewer languages than the free chain — notably it has no
   * Urdu, which is this extension's oldest language pair. An unsupported pair
   * is not an error: the worker falls back to the free chain for that lookup.
   */
  const DEEPL_SOURCE = new Set([
    'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu',
    'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'no', 'nl', 'pl', 'pt', 'ro',
    'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh'
  ]);

  // Targets DeepL insists on qualifying with a variant.
  const DEEPL_TARGET = { en: 'EN-US', pt: 'PT-PT', zh: 'ZH' };

  const deeplSupports = (code) => code === 'auto' || DEEPL_SOURCE.has(String(code).toLowerCase());

  const deeplPair = (sl, tl) => {
    const s = String(sl || '').toLowerCase();
    const t = String(tl || '').toLowerCase();
    return {
      // Omitting source_lang is how DeepL is asked to detect.
      source: s && s !== 'auto' ? (s === 'no' ? 'NB' : s.toUpperCase()) : '',
      target: DEEPL_TARGET[t] || (t === 'no' ? 'NB' : t.toUpperCase())
    };
  };

  /**
   * A free-tier DeepL key ends in ":fx" and is only valid against the free
   * host; a paid key only against the paid one. Picking the wrong host returns
   * 403, so the key itself tells us where to send it.
   */
  const deeplHost = (key) =>
    /:fx$/.test(String(key || '').trim())
      ? 'https://api-free.deepl.com'
      : 'https://api.deepl.com';

  function deeplParse(json, requestedSource) {
    const out = blank(requestedSource);
    const first = json && Array.isArray(json.translations) ? json.translations[0] : null;
    if (!first) return out;
    if (typeof first.text === 'string') out.text = first.text;
    if (typeof first.detected_source_language === 'string' && first.detected_source_language) {
      out.detected = first.detected_source_language.toLowerCase();
    }
    return out;
  }

  /* ------------------------------------------ Google Cloud Translation -- */

  function gcloudParse(json, requestedSource) {
    const out = blank(requestedSource);
    const data = json && json.data;
    const first = data && Array.isArray(data.translations) ? data.translations[0] : null;
    if (!first) return out;
    if (typeof first.translatedText === 'string') out.text = decodeEntities(first.translatedText);
    if (typeof first.detectedSourceLanguage === 'string' && first.detectedSourceLanguage) {
      out.detected = first.detectedSourceLanguage.toLowerCase();
    }
    return out;
  }

  /**
   * The v2 endpoint HTML-escapes its output even when the input was plain text,
   * so "sie sagte >hallo<" comes back with &gt; and &lt;. Decoded by table
   * rather than by assigning to innerHTML, which would be a parser we do not
   * want anywhere near translated text.
   */
  const ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' '
  };

  function decodeEntities(s) {
    return String(s).replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => ENTITIES[m] || m);
  }

  /** A key the user has clearly mistyped, caught before it costs a round trip. */
  function validateKey(provider, key) {
    const k = String(key || '').trim();
    if (!k) return 'Enter your API key.';
    if (/\s/.test(k)) return 'That key contains a space — check for a stray copy/paste.';
    if (provider === 'deepl' && k.length < 20) return 'DeepL keys are longer than that.';
    if (provider === 'gcloud' && !/^AIza[\w-]{20,}$/.test(k)) {
      return 'Google Cloud API keys start with "AIza".';
    }
    return '';
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    byokey: {
      deepl: {
        supports: deeplSupports,
        pair: deeplPair,
        host: deeplHost,
        parse: deeplParse
      },
      gcloud: { parse: gcloudParse, decodeEntities },
      validateKey
    }
  });
})();
