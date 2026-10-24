# HTML Editor

A free, browser-based visual HTML editor. Drop in any `.html` file, edit it visually like Pinegrow or Webflow, and save back to your local disk with live changes.

**Live:** https://mncoleman.github.io/html-editor/

## Features

- **Live local file editing** — link to a file on your disk and `⌘S` writes the edits straight back (Chrome/Edge/Arc via the File System Access API).
- **Click-to-select, drag-to-drop** editing of any element on the canvas.
- **Component library** — 40+ blocks across Typography, Layout, Components, Media, Lists, Forms, Navigation, Tables.
- **Drag from sidebar into canvas** with precise drop-zone indicators (before / after / inside).
- **DOM tree** panel with collapse, drag-reorder, and click-to-select.
- **Properties panel** — visual editing of typography, layout, spacing, background, border, effects.
- **Class chips, attribute editor, raw outer/inner HTML** editor for every element.
- **Inline text editing** — double-click any text element.
- **Undo / redo** with full document snapshots.
- **Autosave** to localStorage (restore last session on page reload).
- **Snippets** — save any selection as a reusable block.
- **Device preview** — desktop / tablet / mobile frames.
- **Preview mode** — hides editor chrome to see the page as a visitor would.
- **Dark and light themes.**

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘S` / `Ctrl+S` | Save to linked file (or export) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘D` | Duplicate selection |
| `Delete` / `Backspace` | Delete selection |
| `Esc` | Deselect |
| `⌘↑` / `⌘↓` | Move selection up / down |
| `P` | Toggle preview mode |
| Double-click | Edit text inline |

## How it works

The user's HTML loads into a sandboxed iframe. The editor reaches in (same-origin) to listen for clicks, attach a `MutationObserver`, and write style/attribute/HTML changes. An overlay layer in the parent document renders the selection outline, hover highlight, and drop indicators.

For "live local editing" the editor uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Once you pick a file, the browser hands the editor a persistent write handle. Saving calls `createWritable()` and writes the current HTML back to disk. No upload, no server, no extension required.

Safari and Firefox don't support File System Access — they fall back to import / export (file picker in, `.html` download out).

## Local development

It's a static site. Any static server works:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Edit a local site

`server.js` serves the editor and saves straight back into a folder of `.html` files — no File System Access API needed, so it works from Safari, Firefox and iPad. Node 18+, no dependencies:

```sh
node server.js --root ~/Code/my-site --port 8080
```

Open `http://localhost:8080/?file=index.html` (the path is relative to `--root`; use `?file=about/index.html` for subfolders). `⌘S` / `Ctrl+S` writes the file. Only `.html` files inside `--root` can be read or written.

From an iPad on the same Wi-Fi: the server listens on all interfaces and prints its LAN address at startup (or run `ipconfig getifaddr en0` on the Mac). Open `http://<mac-ip>:8080/?file=index.html` in Safari. Tap to select, then drag the handles with a finger or Apple Pencil: corner/edge squares resize, the blue grip reorders the element among its siblings, and the orange bars change padding. There is no login — anyone on the network who can reach the port can edit the site, so only run it on a network you trust.

## Architecture

```
index.html              — editor shell (toolbar + 3-pane workspace + statusbar)
css/editor.css          — all styling, dark/light tokens
js/state.js             — global state, undo/redo, autosave, snippets, recents
js/blocks.js            — component library (block definitions)
js/canvas.js            — iframe wiring, selection overlay, drag-drop, hover
js/handles.js           — resize / move / padding handles (Pointer Events)
js/tree.js              — DOM tree panel + status-bar breadcrumbs
js/properties.js        — style/attributes/HTML tabs
js/blocks-panel.js      — blocks sidebar + snippets/recent files
js/file.js              — File System Access API, import/export
js/keyboard.js          — global shortcuts
js/editor.js            — bootstrap, toolbar wiring, empty state
server.js               — optional local save server (node server.js --root <dir>)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, project layout, and how to add new blocks / shortcuts / style controls.

## License

[MIT](LICENSE) © 2026 mncoleman
