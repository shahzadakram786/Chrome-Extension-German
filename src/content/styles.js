/**
 * Stylesheet for the tooltip, kept as a string because it is adopted into a
 * shadow root. Nothing here can leak onto the page and — more importantly —
 * no page stylesheet can reach in and wreck the tooltip.
 */
globalThis.GL_TOOLTIP_CSS = `
:host { all: initial; }

* { box-sizing: border-box; margin: 0; padding: 0; }

.card {
  position: absolute;
  z-index: 2147483647;
  width: max-content;
  min-width: 240px;
  max-width: 360px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: var(--gl-size, 15px);
  line-height: 1.45;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 32px -8px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.05);
  padding: 12px 14px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity .13s ease, transform .13s ease;
  overflow-wrap: anywhere;
}
.card.visible { opacity: 1; transform: translateY(0); }

/* Dark is the default; the light block below flips the tokens. */
.card {
  --bg: #16181d;
  --bg-soft: #1e2128;
  --fg: #e8eaed;
  --muted: #8b93a1;
  --border: #2b2f38;
  --accent: #34d399;
  --term: #fbbf24;
  --danger: #f87171;
}
.card.light {
  --bg: #ffffff;
  --bg-soft: #f4f5f7;
  --fg: #16181d;
  --muted: #6b7280;
  --border: #e3e6ea;
  --accent: #059669;
  --term: #b45309;
  --danger: #dc2626;
}

header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.term {
  flex: 1;
  min-width: 0;
  color: var(--term);
  font-weight: 650;
  font-size: .94em;
  max-height: 3em;
  overflow: hidden;
}
.term[dir="rtl"] { text-align: right; }

.acts { display: flex; gap: 2px; flex-shrink: 0; }

button {
  all: unset;
  cursor: pointer;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  font-size: 14px;
  line-height: 1;
  color: var(--muted);
  transition: background .12s, color .12s, transform .12s;
}
button:hover { background: var(--bg-soft); color: var(--fg); }
button:active { transform: scale(.9); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.on { color: var(--accent); }
button svg { display: block; }
button[disabled] { opacity: .35; cursor: default; }

.body { padding-top: 9px; }

.translation {
  color: var(--accent);
  font-size: 1.12em;
  font-weight: 620;
  line-height: 1.4;
}
.translation[dir="rtl"] { text-align: right; line-height: 1.9; font-size: 1.3em; }

.roman {
  margin-top: 3px;
  color: var(--muted);
  font-size: .8em;
  font-style: italic;
}

.senses { margin-top: 9px; display: flex; flex-direction: column; gap: 5px; }
.sense { display: flex; gap: 7px; align-items: baseline; font-size: .82em; }
.pos {
  flex-shrink: 0;
  color: var(--muted);
  font-size: .88em;
  font-style: italic;
  min-width: 46px;
}
.terms { color: var(--fg); opacity: .82; }

.hint {
  margin-top: 9px;
  padding: 6px 8px;
  background: var(--bg-soft);
  border-left: 2px solid var(--term);
  border-radius: 0 6px 6px 0;
  font-size: .78em;
  color: var(--muted);
}
.hint b { color: var(--term); font-weight: 650; }

.example {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed var(--border);
  font-size: .78em;
  font-style: italic;
  color: var(--muted);
}

footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  padding-top: 7px;
  border-top: 1px solid var(--border);
  font-size: .68em;
  color: var(--muted);
  letter-spacing: .04em;
  text-transform: uppercase;
}
.route { display: flex; align-items: center; gap: 4px; }
.badge { opacity: .55; }

.error { color: var(--danger); font-size: .86em; }

/* ------------------------------------------------------------- grammar -- */

/* An explicit width: the card is sized to its content, and a conjugation
   table has no natural width of its own to push against. */
.card.wide { width: 420px; max-width: 420px; }

.gram {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  max-height: 340px;
  overflow-y: auto;
  padding-right: 6px;
  overscroll-behavior: contain; /* scrolling the table must not scroll the page */
}
.gram::-webkit-scrollbar { width: 8px; }
.gram::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.gram::-webkit-scrollbar-track { background: transparent; }

.gramHead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.gramWord { color: var(--term); font-weight: 650; font-size: 1em; }
.gramMeta { color: var(--muted); font-size: .72em; text-transform: uppercase; letter-spacing: .04em; }

.gramNote {
  margin-top: 6px;
  padding: 5px 7px;
  background: var(--bg-soft);
  border-radius: 6px;
  color: var(--muted);
  font-size: .73em;
  line-height: 1.4;
}

/* The three principal parts, given their own emphasis. */
.gramKey {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin: 9px 0 4px;
}
.keyCell {
  background: var(--bg-soft);
  border-radius: 7px;
  padding: 6px 7px;
  min-width: 0;
}
.keyCell b {
  display: block;
  color: var(--muted);
  font-size: .62em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .05em;
  margin-bottom: 2px;
}
.keyCell span {
  display: block;
  color: var(--accent);
  font-weight: 620;
  font-size: .82em;
  overflow-wrap: anywhere;
}

.gramTense { margin-top: 11px; }
.gramTitle {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 4px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.gramTitle span { color: var(--fg); font-weight: 620; font-size: .78em; }
.gramTitle i { color: var(--muted); font-size: .68em; font-style: normal; }

.gramRows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  font-size: .8em;
}
.pron { color: var(--muted); white-space: nowrap; }
.form { color: var(--fg); overflow-wrap: anywhere; }
.form.key { color: var(--accent); font-weight: 600; }

.caution {
  margin-top: 9px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--term) 13%, transparent);
  color: var(--term);
  font-size: .75em;
  line-height: 1.4;
}

.toast {
  margin-top: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-size: .78em;
  font-weight: 600;
}

/* Loading shimmer while the request is in flight. */
.skeleton { display: flex; flex-direction: column; gap: 7px; padding-top: 2px; }
.bar {
  height: 11px;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--bg-soft) 25%, var(--border) 50%, var(--bg-soft) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.1s linear infinite;
}
.bar.short { width: 45%; }
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .card { transition: none; }
  .bar { animation: none; }
}
`;

/** Styles for the inline paragraph translations added by immersion mode. */
globalThis.GL_IMMERSION_CSS = `
.gl-immersion-line {
  display: block;
  margin: 6px 0 2px;
  padding: 6px 10px;
  border-left: 3px solid rgba(52, 211, 153, .65);
  background: rgba(52, 211, 153, .07);
  border-radius: 0 6px 6px 0;
  color: inherit;
  opacity: .92;
  font-size: .95em;
  line-height: 1.55;
}
.gl-immersion-line[dir="rtl"] {
  border-left: none;
  border-right: 3px solid rgba(52, 211, 153, .65);
  border-radius: 6px 0 0 6px;
  text-align: right;
}
`;
