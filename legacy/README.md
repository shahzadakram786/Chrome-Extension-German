# Legacy version

The original extension, kept for reference. **Nothing here is loaded** — the
manifest points at `src/` instead.

These files are superseded by:

| Old | New |
|---|---|
| `content.js` | `src/content/content.js` + `src/content/ui.js` |
| `style.css` | `src/content/styles.js` (adopted into a shadow root) |
| `popup.html` / `popup.js` | `src/popup/` |

`popup.html` here still has the uncommitted edit that commented out the
auto-detect option. Auto-detect works in the new version — the underlying
problems were that the detected language was never used for text-to-speech and
that a failed detection had no fallback — so the option is enabled again.

Safe to delete this folder whenever you like; the files are in git history
either way (commit `5a39e04` and earlier).
