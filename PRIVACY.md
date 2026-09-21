# Privacy Policy — AksLingo

_Last updated: 18 September 2026_

AksLingo is a browser extension that translates words on the pages you read
and saves them to a personal vocabulary deck. This policy describes exactly what
it does with your data.

**Short version:** the developer of AksLingo operates no servers, collects
nothing, and sees nothing. Your deck stays on your computer. The only data that
leaves your machine is the text you explicitly ask to have translated, which
goes to the translation service you are using.

## What stays on your device

All of the following is stored locally, in your browser's own extension storage
(`chrome.storage.local`). It is never transmitted anywhere:

- **Your vocabulary deck** — saved words, their translations, the sentence you
  found each one in, the page URL you saved it from, and each card's review
  schedule.
- **Your settings** — language pair, trigger preferences, theme, and the list of
  sites where you have muted the extension.
- **Your usage statistics** — per-day counts of lookups, saves and reviews, used
  to draw the progress charts and streak. Kept for roughly a year, then dropped.
- **A translation cache** — recent translations, so repeating a lookup does not
  repeat the request. Entries expire after 30 days.
- **Your API key**, if you supply one (see below).

None of this is synced, backed up, or sent off the device by the extension.
Uninstalling the extension deletes all of it.

## What leaves your device

**Only the text you ask to translate.** When you hover a word, select a phrase,
or turn on immersion mode, that text — and, for accuracy in detecting the
language, the sentence immediately surrounding a hovered word — is sent to a
translation service. Nothing else about the page is sent: not its URL, not its
title, not its other contents, not your identity.

Requests are made without cookies or credentials (`credentials: 'omit'`), so
they cannot be tied to any account you may have with these services.

The extension reads the content of pages you visit in order to know what you are
pointing at. That reading happens entirely inside your browser. Page content is
not transmitted anywhere except the specific text you ask to translate.

### Which service receives it

By default, requests go to **Google Translate's public endpoint**, falling back
to **MyMemory** when the first is unavailable. If you supply your own API key in
Settings, requests go to **DeepL** or **Google Cloud Translation** instead, with
the default services remaining as a fallback.

These are independent third parties with their own policies:

- Google — <https://policies.google.com/privacy>
- MyMemory (Translated S.r.l.) — <https://mymemory.translated.net/doc/privacy.php>
- DeepL — <https://www.deepl.com/privacy>

Be aware that MyMemory's service is a shared, crowd-sourced translation memory,
and text sent to it may be retained and used to improve that service. If you
read pages containing information you consider confidential, mute the extension
on those sites in Settings, or disable it while you are on them.

### Your API key

If you supply a DeepL or Google Cloud key, it is stored locally in your browser
and sent only to that provider, as the credential for your own requests, in an
`Authorization` header or that provider's documented key parameter. It is never
sent to the developer or to any other party. Removing the key in Settings
deletes it.

### Your contact email

MyMemory allows a larger daily allowance for requests that include a contact
address. If — and only if — you enter an email address in Settings, it is
included in requests to MyMemory for that purpose. It goes nowhere else, and
leaving the field blank is fully supported.

## What the extension does not do

- It does not collect, transmit or store personal information.
- It contains no analytics, telemetry, advertising or tracking of any kind.
- It does not create an account or identify you.
- It does not sell or transfer data to third parties.
- It does not use your data for anything unrelated to translating and reviewing
  the words you look up.
- It does not use your data to determine creditworthiness or for lending.
- It loads no remote code; all code is contained in the published package.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| Access to all websites | Translation has to work on whatever page you are reading. The extension reads page text locally to find what you are pointing at. |
| `storage` | Keeps your deck, settings and cache on your device. |
| `contextMenus` | Adds the right-click "Translate" and "Save" entries. |
| `alarms` | Refreshes the due-card count on the toolbar badge. |
| `scripting` | Activates the extension in tabs that were already open when you installed it, so it works without a reload. |
| `activeTab` | Lets a keyboard shortcut act on the tab you are looking at. |
| DeepL / Google Cloud access | Optional. Requested only if you choose one of those providers, and not granted otherwise. |

## Children

AksLingo is not directed at children under 13 and collects no data from
anyone, of any age.

## Changes

If this policy changes, the updated version will be published at this address
and the date at the top will change. Material changes will also be noted in the
extension's listing.

## Contact

Questions about this policy, or about privacy in AksLingo:
**akslingo@gmail.com**
