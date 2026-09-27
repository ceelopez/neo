# NEO

> A distraction-free word processor for authors, by a wannabe author.

NEO understands from the moment you install it that you are writing **books** and nothing else. No bloat, no distractions, with manuscripts that look like books as you write them.

NEO runs locally. WIPs are saved as plain files on your disk. No accounts, no subscriptions — and it's free.

---

## Table of Contents

- [Download](#download)
- [Why NEO?](#why-neo)
  - [The Bookshelf](#the-bookshelf)
  - [Just a Blank Page](#just-a-blank-page)
  - [Enter, Enter, Enter](#enter-enter-enter)
  - [Darlings](#darlings)
  - [Placeholders](#placeholders)
  - [Outlining for Plotters](#outlining-for-plotters)
  - [Writing AI](#writing-ai)
  - [Cover Art](#cover-art)
  - [Goals and Momentum](#goals-and-momentum)
  - [Exports](#exports)
  - [Import](#import)
  - [Backups](#backups)
- [Your Files](#your-files)
- [Building from Source](#building-from-source)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Philosophy](#philosophy)

---

## Download

Get the latest installer from the **[Releases page](../../releases)**:

| Platform | Installer | Notes |
|----------|-----------|-------|
| **macOS** | `.dmg` | Use the Intel build for older Macs, the arm64 file for Apple silicon. Open and drag NEO to Applications. |
| **Windows** | `.exe` | Standalone executable — just run it. |
| **Windows** | Setup installer | Use this if you prefer a traditional install flow. |

---

## Why NEO?

### The Bookshelf

Your library looks like a **bookshelf**, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere, rearrange shelves, and put cover art on your titles.

### Just a Blank Page

There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings — because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists **only when you invoke it** — no more red squiggles mid-sentence triggering your imposter syndrome.

### Enter, Enter, Enter

| Keys | Result |
|------|--------|
| **One** Enter | New paragraph |
| **Two** Enters | A `***` section break |
| **Three** Enters | A new chapter |

The goal is to **KEEP WRITING**.

### Darlings

The writing advice is *kill your darlings* — but I say: **keep the bodies**.

Drag any beautiful-but-in-the-way passage onto the **Darlings** tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot they came from. More like zombies than darlings.

### Placeholders

Mid-flow and need a name, a fact, a date? `⌘⇧X` drops a mark and a sticky note.

- The **left panel** shows a red dot on every chapter you need to get back to.
- The **right panel** lists all of these to-do items.

### Outlining for Plotters

Outline chapters and sections in the **Outline** tab; section notes appear in the manuscript as gray ghost paragraphs, ready to be overwritten. Pantsers can ignore all of it — or learn to draw a freakin' map for the first time. Try it. You might like it!

### Writing AI

NEO’s optional Writing Assistant revises selected passages. Set it up deliberately under **File → Writing Assistant…**; NEO never prompts during onboarding or sends text unless you invoke Rewrite.

- **Local AI.** Set up a small Ollama model that runs privately on your computer, with no account or API key.
- **API key.** Use OpenAI or another OpenAI-compatible service. Keys are stored encrypted on this computer, **never in your library folder**.

Placeholders start with `⌘⇧X` / `Ctrl+Shift+X`: type a short note inline, then later supply final text and choose **Insert & resolve**. Select prose to reveal the quiet **Rewrite** action; every proposed revision is previewed before replacement.

### Cover Art

Every book gets a cover!

- New books are dressed in a seeded abstract — six art styles, six type templates, typefaces bundled with NEO, so no two stories on the shelf look alike.
- Once a story passes 1,000 words, NEO can read it and paint an abstract cover from the text.

> **Heads up:** This requires a bit more work but is totally worth it. Get an OpenAI API key from their website and paste it under *File → Cover Art…*. Art is generated in the background for about a penny a picture. (These are not meant for publication — just writing inspiration!) The API key is stored encrypted in NEO's own settings, **never in your library folder**.
>
> The title and author are always set in real type on top, so the lettering is never left to a gen-AI model. The `↻` on any book re-rolls its type and colors, or paints it again. You can always switch back and forth between the seeded modern look and the painted variety.

### Goals and Momentum

Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

### Exports

- **EPUB 3** — with a proper table of contents built to KDP's guidelines
- **Word** — `.docx`
- **PDF**
- **HTML**
- **Markdown**
- **Plain text**

Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

### Import

Bring in existing `.docx`, `.txt`, and `.md` manuscripts; chapters and scene breaks are detected automatically.

This is still a bit rough and might require you to tweak things. It will try to grab your title and remove it from the body, and it seems to be working okay.

### Backups

- **Continuous autosave** — your work is never far from disk.
- **Daily zip backups** — kept for two weeks.
- **Everything stored as plain files** — point your NEO library folder at iCloud for extra safety.
- **Email copies** of your WIP to yourself with `⌘E`.

---

## Your Files

Everything lives in `~/Documents/NEO Library`:

```
NEO Library/
└── My Novel/
    ├── cover.png
    ├── metadata.json
    ├── chapters/
    │   ├── 001-the-beginning.html
    │   ├── 002-the-middle.html
    │   └── 003-the-end.html
    └── darlings/
        └── cut-passage-2026-09-26.html
```

- One folder per book.
- Chapters are readable HTML.
- Metadata is JSON.

Open them in your favorite text editor.

---

## Building from Source

*For the eggheads.*

Requires [Node.js](https://nodejs.org).

```bash
git clone https://github.com/hughhowey/neo.git
cd neo
npm install
npm start
```

### Packaging Installers

```bash
npm install electron-builder --save-dev
npm run package       # macOS
npm run package:win   # Windows
npm run package:all   # Both
```

Output lands in `dist/`.

### Project Layout

The app is intentionally simple:

| File | Purpose |
|------|---------|
| `main.js` | Electron shell |
| `preload.js` | Preload bridge |
| `app.js` | Renderer logic |
| `styles.css` | Styles |
| `index.html` | UI markup |

If you know JavaScript, you can change NEO. Have at it.

---

## Roadmap

*Things I'm dreaming up but may never get to:*

- [ ] Chapter version history
- [ ] Manuscript format for agent submissions — Times New Roman, double-spaced, address block (just to make Kristin Nelson happy)
- [ ] Global end matter that updates every book at once (copyright pages, bios, etc.)

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

> **Fair warning:** NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there. Nobody needs to use this but me.

---

## License

[MIT](LICENSE) — free to use, free to modify, free to share.

---

## Philosophy

> If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites — you can charge money for the things you write and keep every penny of the income. Lots of incredible *Silo Stories* out there. But readers are forever looking for more.

---

<p align="center">
  <em>Happy writing.</em>
</p>
