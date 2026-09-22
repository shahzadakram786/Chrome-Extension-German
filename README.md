# AksLingo

A Chrome extension that turns reading the web into vocabulary practice. Hover or
select any word to translate it, hear it, and save it to a deck that schedules
its own reviews.

Grew out of a German→Urdu hover translator; now handles 36 languages in both
directions.

## Installing it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder

## What it does

**Look up a word.** Hover it, or select a phrase. The tooltip gives the
translation, the part of speech, the other common meanings, an example sentence,
and a romanization when the script is not Latin. Auto-detect works, so you do
not have to tell it what language the page is in.

**Hear it.** The speaker button uses a voice matched to the detected language;
hold <kbd>Shift</kbd> while clicking for a slow reading.

**Save it.** Press <kbd>S</kbd> and the word joins your deck — along with the
sentence you found it in and a link back to the page, so it still means something
a week later.

**Review it.** The extension badge shows how many cards are due. The review
screen runs an SM-2 scheduler with learning steps: cards you know drift weeks
apart, cards you keep missing come straight back.

**Read a whole page in two languages.** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>
puts a translation under every paragraph, loading them as you scroll.

**See the grammar.** For a German word the tooltip grows a table button (or
press <kbd>G</kbd>). It opens the full picture: the three principal parts
(Infinitiv · Präteritum · Partizip II), then Präsens, Präteritum, Perfekt,
Plusquamperfekt, Futur I, Konjunktiv I and II, Konjunktiv II Perfekt, the
Imperativ and both participles — every form beside its pronoun. Hovering an
inflected form works too: `spricht` is traced back to `sprechen` before the
table is built.

Nouns get their gender and the four cases; adjectives get Komparativ and
Superlativ. Modals are labelled as modals rather than lumped in with the strong
verbs, and their Perfekt carries the Ersatzinfinitiv caveat — `hat schwimmen
können`, not `hat schwimmen gekonnt`.

All of it is computed in the extension, so it is instant and works offline.

**Use your own translator, if you want one.** Out of the box it needs no setup
and no account. Settings also takes a DeepL or Google Cloud API key, which gets
you that provider's quality and its quota instead of a shared public endpoint's
rate limit. The free services stay as a fallback, so an exhausted quota or a
language your provider does not cover still translates.

### Keyboard

| Key | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>T</kbd> | translate the selection |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> | immersion mode on this page |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | turn the extension on or off |
| <kbd>S</kbd> <kbd>P</kbd> <kbd>G</kbd> <kbd>W</kbd> <kbd>C</kbd> <kbd>Esc</kbd> | with the tooltip open: save · play · grammar · flip direction · copy · close |
| <kbd>Space</kbd> then <kbd>1</kbd>–<kbd>4</kbd> | while reviewing: reveal, then grade |

Rebind any of the first three at `chrome://extensions/shortcuts`.

## How it is put together

```
manifest.json
icons/                           16/32/48/128 PNGs, generated from logo.png
src/
  background/service-worker.js   all network access, caching, retries, badge
  content/
    content.js                   what the user is pointing at, immersion mode
    ui.js                        the tooltip (shadow DOM)
    styles.js                    tooltip + immersion CSS, as strings
  lib/
    languages.js                 language table: names, BCP-47 tags, RTL flags
    srs.js                       the review scheduler
    store.js                     settings, deck and stats — one source of truth
    gtx.js                       primary provider's response parser
    mymemory.js                  fallback provider's response parser
    byokey.js                    DeepL and Google Cloud, for users with their own key
    grammar.js                   German article and separable-verb hints
    german.js                    conjugation, noun cases, adjective comparison
    german-verbs.js              GENERATED irregular verbs, from Wiktionary
  popup/                         the toolbar popup
  dashboard/                     review, deck, progress, settings
tools/                           development only, never shipped
  wiktionary.js                  API client: batching, throttling, template parsing
  verify-verbs.js                checks the bundled table against Wiktionary
  fetch-verbs.js                 regenerates src/lib/german-verbs.js
  build.js                       packages dist/<name>-<version>.zip for the store
tests/
  run.js                         unit tests (add --live to call the real APIs)
  german.js                      every conjugation, against forms written out by hand
  check-wiring.js                every referenced file exists and loads in order
  check-worker.js                the service worker boots and answers every message
legacy/                          the original version, kept for reference
docs/index.html                  the privacy policy as served by GitHub Pages
.github/ISSUE_TEMPLATE/          what a mistake report asks for
PRIVACY.md                       the published privacy policy
STORE-LISTING.md                 listing copy and permission justifications
```

Eight decisions worth knowing about:

**Network access lives only in the service worker.** The old version fetched from
the content script, which meant every request was subject to the visited page's
origin and CSP. The worker holds the host permissions, and one cache serves every
tab.

**The tooltip lives in a shadow root.** Page stylesheets cannot reach into it, and
nothing from the page is ever assigned to `innerHTML` — selected text is
attacker-controlled, and the old version interpolated it straight into markup.

**"Auto" is resolved before the request, not after.** Asking the translation
service to detect the language of a single hovered word does not work: it reads
the German `Haus` as English with 0.70 confidence and hands the word back
untranslated. Given the whole sentence it gets German right. So `content.js`
grabs the surrounding sentence, runs Chrome's offline detector
(`chrome.i18n.detectLanguage`) over it, falls back to the page's own `lang`
attribute, and only then sends a concrete language code. If it still cannot
tell, the tooltip says so instead of showing the word back to you.

**The grammar data has an open-source source of truth.** German Wiktionary
publishes each irregular verb's stems in a structured template, which is the
same shape the engine stores:

```
{{Deutsch Verb unregelmäßig|2=sprech|3=sprach|4=spräch|5=gesprochen|6=sprich}}
```

Two tools in `tools/` use it, both development-time only — a user's machine
never fetches grammar:

- `node tools/verify-verbs.js` checks every hand-written entry against
  Wiktionary. Its first full run verified 97 of 107 and found a real error
  (`geschehen` had `geschehe` for the Konjunktiv II instead of `geschähe`),
  two bugs in the checker itself, and six verbs that are strong in one sense
  and weak in another — `wachsen` grew / waxed, `hängen` hung / hung something,
  `schaffen` created / managed.
- `node tools/fetch-verbs.js` regenerates `src/lib/german-verbs.js` from
  Wiktionary, so the irregular list is derived rather than remembered.

Wiktionary text is CC BY-SA 4.0, recorded in the generated file's header.

**Generated answers need a way to be told they are wrong.** Every form in the
grammar panel is computed, which means an error is silent by construction: it
renders exactly like a correct answer, in the same font, with the same
confidence. Modals were labelled strong verbs from the first build until someone
looked at a screenshot — nothing in the extension could have surfaced it,
because nothing asked. So the panel carries a "Report a mistake" link, and
Settings carries the same button.

It sends nothing. It opens a prefilled issue form in a tab, which means the user
reads the report before it goes anywhere and can edit or abandon it. The prefill
is the word, the engine's verdict on it and the version — and deliberately not
the page URL, its title, or the sentence the word came from, all of which are
sitting right there in `content.js`. A convenience feature is not a reason to
make the privacy policy untrue, and `check-worker.js` asserts the report body
stays clean so a later "just add the URL, it helps debugging" cannot pass.

**Verb classes are a claim, so they get their own flag.** Until Sept 2026 the
classifier had three buckets — `weakPast ? 'mixed' : 'strong'`, else `'weak'` —
and a table entry carrying neither flag fell through to "strong". That made the
panel call every modal a strong verb. They are not: modals are
Präteritopräsentia, which is why the ich-form has no ending (it descends from an
old strong preterite) while the past is formed weakly, `konnte`. Modals now
carry `modal: true` and are checked before the mixed/strong split. `wissen` has
the same endingless present but governs a clause rather than a bare infinitive,
so it is marked mixed — vowel change plus weak endings — and not a modal.

The same flag drives a caveat the table could not otherwise express: `hat
gekonnt` is right only when the modal stands alone. Governing another verb,
German takes the Ersatzinfinitiv — `er hat schwimmen können`. Without saying so,
the Perfekt rows quietly teach `hat schwimmen gekonnt`.

**Why completeness is the safety property.** The engine conjugates anything not
on the irregular list as a regular verb. That inference is only sound if the
list really is complete — otherwise a strong verb nobody typed in silently
becomes weak, and the panel teaches `geschwört` for `geschworen`. So the
generated file records whether its run finished, and the engine only trusts
"absent, therefore regular" when it did. Until then the panel says outright
that a verb was conjugated by rule and could differ. The generator also checks
itself, conjugating every entry before writing and dropping any that comes out
malformed.

The bundled table is a finished run: 2,713 verbs, `complete: true`, so the
caveat is off. Three entries were dropped by the self-check on that run —
`waschen`, `beißen` and `gießen` — all three because a prefix was wrong.
`beißen` was inferred to have the separable prefix `bei`, and two pages carried
a literal `-Test` in the prefix parameter, which is what a wiki looks like from
the inside. All three are in the hand-written core, which wins over the
generated table, so nothing was lost; the generator now discards a prefix the
infinitive does not start with rather than writing the entry and relying on the
self-check to catch it.

**Grammar is computed, not looked up.** German conjugation is regular enough to
generate: weak verbs follow rules, and the strong and mixed ones carry a stem
table — about 110 written by hand, plus 2,713 generated from Wiktionary. That
keeps it instant and offline, and makes it testable —
`tests/german.js` checks every form against one written out by hand. Where a
form is not derivable the panel says so rather than guessing, because a wrong
Partizip II taught to a learner is worse than a blank. German plurals are the
clearest case: they are unpredictable from the singular, so no plural is shown.

**Providers are ranked, and the user can put their own on top.** The primary
endpoint rate-limits by IP and returns HTTP 429 with an HTML body. When that
happens the worker opens a circuit breaker and uses MyMemory instead, which also
reports the language it detected, so auto-detect keeps working. MyMemory's
crowd-sourced memory needs care: for "Haus" de→ur its headline answer is
"مچھلي" (*fish*) with a perfect match score but a quality score of 0, while the
correct "مکان" sits second in the candidate list. `lib/mymemory.js` ranks
candidates by quality and flags any answer with no quality signal so the tooltip
can caveat it.

Both of those are undocumented public endpoints with no usage terms, so Settings
takes a DeepL or Google Cloud key and puts that provider first. Three things
about how it is wired:

- The hosts are `optional_host_permissions`, requested at the moment the user
  picks a provider. Someone who never supplies a key is never asked for access
  to DeepL or Google Cloud, and the install prompt stays as small as it can be.
- The free chain stays underneath. A rejected key, an exhausted quota or a pair
  the provider does not handle degrades to the free chain rather than failing —
  DeepL has no Urdu, which is this extension's oldest language pair, so
  `keyedProvider()` returns null for that pair instead of sending a request that
  cannot succeed. A rejected key is remembered and surfaced in Settings, because
  silently falling back forever would leave the user wondering why the provider
  they configured never seems to answer.
- The provider is part of the cache key. Switching to your own DeepL key should
  start giving you DeepL's answers, not replay the free chain's from cache.

## If nothing happens when you hover or select

Chrome injects content scripts **as a page loads**. A tab that was already open
when you installed or reloaded the extension has no script in it, so hovering
there does nothing and reports nothing. The extension now injects itself into
open tabs on install, and the popup pings the current tab and offers a Reload
button when it cannot reach it.

If it is still silent, in order:

1. Open the popup. It names the problem — tab needs reloading, extension
   switched off, site muted, or trigger set to Off.
2. Content scripts never run on `chrome://` pages, the Chrome Web Store, or
   other extensions' pages. Try an ordinary website.
3. At `chrome://extensions`, check the card for an error, and click
   **service worker** to see the worker's console.
4. Selections shorter than two characters are ignored (one character is enough
   for Chinese and Japanese). Hover waits 500ms by default — adjustable in
   Settings.

## Tests

```
node tests/run.js            # 62 unit tests
node tests/run.js --live     # also calls both translation APIs
node tests/german.js         # 71 grammar tests
node tests/check-wiring.js   # referenced files exist, load order is sound, icons are real PNGs
node tests/check-worker.js   # the service worker boots and handles every message
```

`node tools/build.js` runs all four before it packages anything, so the
packaged zip cannot contain a build that fails its own tests.

Against live Wiktionary (needs network, development only):

```
node tools/verify-verbs.js          # every bundled verb, checked upstream
node tools/verify-verbs.js gehen    # or just the ones you name
```

The wiring check is worth running after editing `manifest.json`: a content script
that uses a library loaded after it fails quietly at runtime rather than loudly
at load.

To verify Chrome accepts the manifest without clicking through the UI:

```
chrome.exe --pack-extension="<absolute path to this folder>"
```

It writes a `.crx` on success and prints the offending file on failure. Run it
against a folder holding only what ships — unzip `dist/*.zip` somewhere and
point it there — or it packs `legacy/`, `tests/` and `tools/` too.

There is no command-line way to *load* the extension any more: branded Chrome
removed `--load-extension` in Chrome 137, and `--disable-extensions-except` in
139. Loading is `chrome://extensions` → Developer mode → **Load unpacked**, by
hand. Chrome for Testing still honours the flag if you want to automate it.

## Publishing

```
node tools/build.js --dry    # list exactly what would ship
node tools/build.js          # check, test, then write dist/akslingo-<version>.zip
```

The package's file list is derived from the manifest — every icon and page it
names, every script those pages pull in, and everything the worker reaches
through `importScripts` — rather than from what happens to be in the folder.
Zipping the directory by hand instead sweeps in `legacy/`, which still builds
its tooltip with `innerHTML` and would be found by any reviewer who greps the
bundle.

`STORE-LISTING.md` has the listing copy, the single-purpose statement and a
justification for each permission.

The privacy policy exists twice on purpose. `PRIVACY.md` is for reading in the
repo; `docs/index.html` is the same text as a web page, which is what GitHub
Pages serves at the public URL the Web Store demands. Pointing Pages at the
Markdown instead does not work — Jekyll only converts Markdown carrying YAML
front matter, so a plain `.md` is served raw or 404s. **Edit both or neither**:
a published policy that disagrees with the repo is worse than either version
alone. No domain is needed; the `github.io` URL is an acceptable answer.

### Before submitting

The test suite covers logic, not Chrome. Load the unpacked extension and check
the things only a browser can tell you:

1. The toolbar icon is crisp, not a scaled blur — the icons were a JPEG named
   `.png` until the wiring check started reading their magic bytes.
2. Hovering works in a tab that was **already open** before you loaded the
   extension. `injectIntoOpenTabs` finds those tabs with a URL-filtered
   `tabs.query`, which reads a sensitive tab property and so needs
   `http://*/*` and `https://*/*` in `host_permissions` — a content script's
   `<all_urls>` match does not cover it. Those two entries are therefore back
   in the manifest; they add nothing to the install prompt, which already says
   "read and change all your data on all websites" because of the content
   script. `check-worker.js` covers the fallback to an unfiltered query if the
   filtered one ever comes back empty.
3. Settings → Translation service: pick DeepL, grant the permission when asked,
   paste a key and press **Test this key**. Then decline the permission prompt
   on another provider and confirm it stays on the free service.
4. With a DeepL key set, look up an Urdu word. It should still translate,
   through the free chain, because DeepL has no Urdu.
5. Open a German verb's grammar panel and confirm there is no "not in the
   built-in irregular list" caveat — the bundled table is complete now, so that
   line should only appear if you regenerate it with an unfinished run.

## Limits

- The two default translation services are undocumented public endpoints with no
  stated terms for this kind of use. They rate-limit, and neither is guaranteed
  to stay available. The cache and the fallback chain reduce how often you
  notice; a DeepL or Google Cloud key in Settings removes the problem outright.
- Noun gender comes from suffix rules, not a dictionary, so a noun whose ending
  gives nothing away — `Haus`, `Tisch` — gets no article and no case table.
- A strong verb outside the irregular list is conjugated as if it were weak. The
  bundled list is the complete generated one (2,713 verbs), so the engine trusts
  "absent, therefore regular" and the panel no longer caveats. If you regenerate
  and the run does not finish, it goes back to caveating until it does.
- German plurals are not shown at all: they are unpredictable from the singular,
  and a guess is worse than a blank.

## Credits

Conjugation data is derived from [German Wiktionary](https://de.wiktionary.org),
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Translations come from public endpoints operated by Google and
[MyMemory](https://mymemory.translated.net).
