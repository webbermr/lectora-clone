# Lectora Clone

A browser-based SCORM course editor in the spirit of Lectora. Import a SCORM
`.zip`, edit its pages visually, preview it against a built-in LMS, and publish
a new SCORM package.

Everything runs locally in your browser. No server, no uploads.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Or build a static site with `npm run build` and host `dist/` anywhere (it needs
HTTPS or `localhost`, because the preview uses a service worker).

Two sample packages live in `samples/` (regenerate with `npm run sample`):

- `coffee-basics-scorm12.zip`: three-page SCORM 1.2 course, zipped inside a parent folder
- `workshop-safety-scorm2004.zip`: single-SCO SCORM 2004 course with `xml:base` and sequencing
- `onboarding-modules-scorm2004.zip`: two modules with a nested section, shared assets and an unlisted file
- `fire-safety-scripted-scorm12.zip`: pages drawn by JavaScript (text in JS strings and a data file), for trying Live edit

## What it does

**Import**
- SCORM 1.2 and SCORM 2004 (2nd–4th edition) packages
- Handles zips made from the parent folder, `xml:base`, item `parameters`, non-UTF-8 pages

**Title Explorer**
- Shows the manifest's organization as a tree of modules, sections and pages
  (collapsible, with page counts)
- Each module, section or page can list the files it uses: its resource's files plus
  anything pulled in through `<dependency>`. Files used by several pages are tagged
  *shared*, and files no module claims are grouped under *Not in any module*
- The Files tab can filter by module and tags each file with the module it belongs to
- **Lectora titles published as one SCO** (the usual case) have a single item in the manifest.
  For those, the Title Explorer also shows **Chapters** recovered from Lectora's page file
  names (`a001_<chapter>_<page>.html`, listed in course order), with long runs such as test
  modules shown as sections. Images and audio are matched to pages by scanning each page's
  HTML, since Lectora lists every asset in one shared resource. Assets no page refers to are
  grouped under *Not used by any page*
- Add, rename (double-click), reorder and delete pages; rename the course
- Files tab: every file in the package, with filter, upload, rename and delete

**Edit view (WYSIWYG)**
- Click to select, drag to move, 8 handles to resize (images keep aspect ratio)
- Double-click (or Enter) to edit text in place
- Insert heading, text, image, button, link, shape, video, audio
- Properties panel: position/size, layer order, font, size, color, bold/italic/underline,
  alignment, background, border, radius, padding, shadow, image/media source,
  link target (pick a page from the package), alt text, id/class/tooltip, raw inner HTML
- Keyboard: Delete, Ctrl+D duplicate, arrows nudge (Shift = 10px), Alt+click selects parent,
  Esc deselects, Ctrl+Z / Ctrl+Y undo/redo
- Stage width presets (desktop, laptop, tablet, phone)

**Live edit view** (for pages built by JavaScript)
- Runs the page with its scripts, like a learner sees it, and lets you click text and images
- Shows which source file each piece of text lives in, then rewrites it there. It finds text
  inside JavaScript strings, JSON data files, HTML entities, `\u` escapes and `escape()` output,
  and writes the new text back in the same encoding so the file stays valid
- Double-click text to type over it, or edit it in the Properties panel (needed for SVG text)
- Replace an image or media file in place (it keeps its file name, so nothing else changes)
- With nothing selected, the right panel lists every image, video, audio and other file the page
  uses, with thumbnails, sizes and dimensions. It includes files the page's script only names
  (audio played by an action, a popup not yet open), marks what's on screen, and lets you
  **Show** or **Replace** each one. Lectora's transparent spacer GIFs are left out
- **Interact** mode lets you click through a single-page player to the screen you want
- If the same text appears in several places, you pick which ones change
- Edit view spots pages that are mostly script and offers to switch to Live edit

**Find & Replace** (sidebar)
- Searches every text file in the package, however the text is encoded

**Preview view**
- Runs the course with scripts enabled against a built-in LMS
  (`window.API` for 1.2 and `window.API_1484_11` for 2004)
- Prev/Next through the organization, live completion/score readout, SCORM call log, reset

**Code view**
- Edit any text file (HTML, CSS, JS, XML, JSON), including `imsmanifest.xml`

**Publish**
- Downloads a SCORM `.zip` with the manifest first. Files you didn't touch are byte-identical.
- Images, audio, video, PDFs and fonts are stored as-is (they're already compressed); only text
  files are deflated. On a 240 MB course-sized package this cut export from ~18s to ~3s with
  the same zip size
- A progress window shows each step, files done, the file being added, elapsed time and an
  estimate of time left, then a summary with a **Download again** button

Projects autosave to IndexedDB, with full undo/redo for every change.

## Limitations

- **Script-rendered content.** The Edit view pauses the page's JavaScript, so
  pages drawn by a player at runtime look empty there. Use Live edit for those.
  Live edit changes text and swaps images/media, but it can't move, resize or add
  objects on a script-built page. Text that the runtime assembles from pieces, or
  draws on a `<canvas>`, can't be traced back to the source; Find & Replace
  with a shorter phrase is the fallback.
- **Lectora's own format.** This edits published SCORM output, not Lectora `.awt`
  project files. Lectora HTML output is mostly positioned `<div>`s, so its text
  and images are editable, but its runtime JavaScript also references object IDs.
  Don't rename IDs on objects that Lectora actions or variables rely on.
- **No Lectora actions/variables/tests engine.** Buttons can link to pages or URLs;
  there's no visual action editor or quiz builder yet.
- **Saving rewrites edited pages.** A page you change is re-serialized by the
  browser, which normalizes its formatting (attribute quoting, whitespace).
  The content is the same; the diff won't be minimal.
- **Storage.** Projects live in this browser's IndexedDB. Clearing site data
  deletes them, so publish a `.zip` as your backup.

## Development

```bash
npm test           # vitest: manifest parsing/editing, zip round-trip, edit-copy fidelity
npm run typecheck
```

Layout:

```
src/lib/manifest.ts   imsmanifest.xml parse + edit (keeps unknown XML intact)
src/lib/structure.ts  which files belong to which module; Lectora chapter recovery
src/lib/assetRefs.ts  assets a page's source refers to
src/lib/package.ts    zip import/export
src/lib/html.ts       scripts-disabled edit copy <-> saved HTML
src/lib/vfs.ts        Cache Storage + public/sw.js serve project files to iframes
src/lib/store.ts      project state, undo/redo, autosave
src/lib/editor.ts     live editing session (select, insert, commit)
src/lib/scormApi.ts   preview LMS
src/lib/sourceMatch.ts  find on-screen text in source, however it's encoded
src/lib/live.ts       Live edit session (text write-back, asset replacement)
src/components/       React UI (ribbon, explorer, stage, properties)
```
