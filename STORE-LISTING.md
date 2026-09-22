# Chrome Web Store listing

Copy for the Developer Dashboard. Not shipped in the package.

---

## Store icon

`icons/store-icon-128.png` (128×128 PNG).

## Name

```
AksLingo — Immersive Translator & Vocabulary Trainer
```

52 characters, inside the 75 limit. If a reviewer objects to the trailing
descriptor as keyword stuffing, fall back to `AksLingo — Translate & Learn`.

## Summary (132 characters max)

```
Hover or select any text to translate it, hear it, and save it to a spaced-repetition deck you actually review.
```

## Category

Education. (Not "Productivity" — the deck and review scheduler are the point,
and Education matches the single-purpose statement below.)

## Single purpose

Required field, and the most common reason a multi-feature extension is
rejected. State it as one purpose with the features as parts of it:

```
AksLingo has one purpose: helping someone learn a language from the pages
they already read. Every feature serves it. Looking up a word supplies the
vocabulary; the spaced-repetition deck is how that vocabulary is retained;
immersion mode and the grammar tables are how the same word is met again in
context. They are not separate tools bundled together — none of them is useful
on its own, and removing any one of them breaks the loop the extension exists
to close.
```

## Permission justifications

One field per permission in the dashboard. Reviewers read these closely.

**Host permission — all sites (`<all_urls>` content script)**
```
Translation has to happen on whatever page the user is reading, which cannot be
known in advance. The content script reads page text locally to determine which
word the cursor is over and to find the surrounding sentence for language
detection. Page content is never transmitted; only the specific word or phrase
the user asks to translate is sent to a translation service.
```

**storage**
```
Stores the user's vocabulary deck, review schedule, settings and a local
translation cache on their own device. Nothing is synced or transmitted.
```

**contextMenus**
```
Adds "Translate" and "Save to my deck" entries to the right-click menu for
selected text, as an alternative to the keyboard shortcut.
```

**alarms**
```
Runs a periodic check that updates the toolbar badge with the number of
flashcards currently due for review.
```

**scripting**
```
Chrome only injects content scripts as a page loads, so tabs already open when
the extension is installed have no script in them and the extension appears
broken. This permission is used once, on install, to inject into those tabs so
it works immediately rather than after a manual reload of every tab.
```

**activeTab**
```
Lets the keyboard shortcut translate the current selection in the tab the user
is looking at.
```

**Optional host permissions — DeepL and Google Cloud Translation**
```
Only requested if the user chooses to supply their own API key for one of these
services in Settings. Users who stay on the default free service are never asked
for them and they are never granted.
```

**Remote code**: answer **No**. All code is in the package; nothing is fetched
and executed at runtime.

## Data usage disclosures

Tick **"Website content"** — the text the user selects or hovers is sent to a
third-party translation service.

Then confirm all three certifications, which are all true here:
- Not sold to third parties
- Not used or transferred for purposes unrelated to the single purpose
- Not used or transferred to determine creditworthiness or for lending

Everything else — name, address, email, phone, financial information,
authentication information, personal communications, location, health,
activity, browsing history — is **not** collected. Note that "browsing history"
is genuinely not collected: the page URL is stored only on the user's own device
as part of a card they chose to save, and is never transmitted.

## Privacy policy URL

Required, and the submission is blocked without it. The policy is already built
as a web page at `docs/index.html`, so all that is left is to switch Pages on:

1. Merge this branch into `main`.
2. On GitHub: **Settings → Pages**. Under "Build and deployment", set
   Source = *Deploy from a branch*, Branch = `main`, Folder = **`/docs`**. Save.
3. Wait a minute, then open:

```
https://shahzadakram786.github.io/Chrome-Extension-German/
```

That is the URL to paste into the Web Store's privacy policy field.

`PRIVACY.md` and `docs/index.html` hold the same text — the Markdown one is for
reading in the repo, the HTML one is what gets served. **If you change one,
change the other**, or the published policy stops matching the repo.

Why a folder of HTML rather than pointing Pages at `PRIVACY.md`: GitHub's Jekyll
build only converts Markdown that carries YAML front matter. A plain `.md` at the
repo root is copied verbatim, so the URL serves raw Markdown or 404s — and you
would not find out until a reviewer clicked it.

The contact address in `PRIVACY.md` is `akslingo@gmail.com`. Use the same one
for the developer account's contact email, so the two agree — a reviewer who
finds them different has to wonder which is real.

A domain is not needed for any of this. The GitHub Pages URL is an acceptable
privacy policy URL, and both it and the support URL stay editable in the
dashboard, so buying `akslingo.com` later costs nothing and breaks nothing.

## Support URL

The dashboard has a **Support** field. Point it at the issue tracker:

```
https://github.com/shahzadakram786/Chrome-Extension-German/issues
```

This matters more than it looks. Every form in the grammar panel is generated,
so a wrong answer is indistinguishable from a right one to the user *and* to us
— modals were labelled "strong verb" from the first build until someone read a
screenshot. The in-extension "Report a mistake" button feeds this tracker, and
it is the only channel that will ever tell you the German is wrong. Web Store
reviews will not: they are one-way and rarely specific.

Watch the repo so issues reach your inbox.

## Description

```
AksLingo turns the web you already read into vocabulary practice.

LOOK IT UP
Hover a word or select a phrase. You get the translation, the part of speech,
the other common meanings, an example sentence, and a romanization when the
script isn't Latin. Auto-detect means you don't have to tell it what language
the page is in. 36 languages, both directions.

HEAR IT
The speaker button uses a voice matched to the detected language. Hold Shift
while clicking for a slow reading.

SAVE IT
Press S and the word joins your deck — with the sentence you found it in and a
link back to the page, so it still means something a week later.

REVIEW IT
The toolbar badge shows how many cards are due. Reviews run on an SM-2
scheduler with learning steps: words you know drift weeks apart, words you keep
missing come straight back.

READ A PAGE IN TWO LANGUAGES
Alt+Shift+I puts a translation under every paragraph, loading as you scroll.

SEE THE GRAMMAR (GERMAN)
For a German word, open the full conjugation: the three principal parts, then
Präsens, Präteritum, Perfekt, Plusquamperfekt, Futur I, Konjunktiv I and II,
the Imperativ and both participles — every form beside its pronoun. Hovering an
inflected form works too; "spricht" is traced back to "sprechen" first. Nouns
get their gender and the four cases, adjectives get Komparativ and Superlativ.
It's computed in the extension from a table of 2,700 irregular verbs built from
Wiktionary, so it's instant and works offline.

BRING YOUR OWN KEY
The free service needs no setup. If you'd rather use your own DeepL or Google
Cloud key for better quality and no rate limits, Settings takes one.

PRIVATE BY DEFAULT
No account, no analytics, no tracking. Your deck never leaves your computer.
The only thing sent anywhere is the text you ask to have translated.

KEYBOARD
Alt+T          translate the selection
Alt+Shift+I    immersion mode on this page
Alt+Shift+O    turn AksLingo on or off
With the tooltip open: S save · P play · G grammar · W flip · C copy · Esc close
While reviewing: Space to reveal, then 1-4 to grade
```

## Screenshots

Required: at least one at 1280×800 or 640×400. Five is the maximum and the
listing looks thin with fewer than three. Worth capturing:

1. The tooltip open over a German paragraph, showing translation + part of
   speech + example.
2. The grammar panel with a full conjugation table.
3. The review screen mid-session, card revealed, grade buttons visible.
4. The stats tab, with the streak and the activity chart.
5. Immersion mode on a real article, translations under each paragraph.

Use a real article in a real language, not lorem ipsum — reviewers and users
both read these as evidence the thing works.

## Before you submit

- [x] Contact email in `PRIVACY.md` — `akslingo@gmail.com`
- [ ] Host the policy and have the URL ready
- [ ] Capture screenshots
- [ ] Smoke test the unpacked build in Chrome (see README, "Before submitting")
- [ ] `node tools/build.js`, upload `dist/akslingo-3.0.0.zip`

Expect extended review because of the all-sites host permission. Plan for
several weeks, not days, and don't schedule anything around the launch date.
