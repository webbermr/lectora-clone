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
- `lectora-style-scorm12.zip`: built the way Lectora publishes (trivExitPage links, page-tracking tree, a dashboard that unlocks the final assessment when every module is done), for trying deletes
- `fire-safety-scripted-scorm12.zip`: pages drawn by JavaScript (text in JS strings and a data file), for trying Live edit

## What it does

**Import**
- SCORM 1.2 and SCORM 2004 (2nd–4th edition) packages
- A progress window walks through reading the zip, extracting files, setting up the preview and
  saving in the browser, with file counts, the current file and time left. Problems (such as a
  zip with no `imsmanifest.xml`) are shown there. Reopening a saved project shows the same window
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

**Deleting chapters, sections and pages** (Lectora courses)
- Pick any mix of chapters, sections and pages in the Title Explorer and press 🗑. Selection works the
  usual way: click for one, Ctrl/⌘-click to add or remove (removing a chapter removes its sections too),
  Shift-click for a range, Esc to clear. The 🗑 button shows how many pages that adds up to.
  A review window shows everything that will change before anything does:
  - the page files, plus images/audio that only those pages use (anything still used elsewhere is kept)
  - every Next, Back, menu and jump link that pointed at a deleted page, rewired across the gap:
    forward links go to the next remaining page, backward links to the previous one, never to the
    linking page itself
  - Lectora's visit tracking (`trivantis-pagetracking.js`): deleted pages leave the tree so
    "visit every page" can still reach 100%, and `numPages` drops by the pages removed
  - the manifest: their `P_<id>` resources, every `<dependency>` on them, and removed files
  - the table of contents (`a001_toc*.html`): deleted pages' entries are removed, chapters left
    empty go too, and a chapter whose link pointed at a deleted page opens its first remaining page
  - fixed progress totals: when pages add to a counter that's compared with a fixed total
    (Lectora: `Varprogress_track` vs `Vara_progress_total = 379`), the total and any progress bar
    sized to it drop by what the deleted pages contributed, so progress can still reach 100%
  - **keeping the course finishable**: if a deleted page was the only one setting a flag that other
    pages check (say, "module 3 done" before the final assessment unlocks), those checks are answered
    as if the deleted pages had run (`VarModule3Done.equals('1')` becomes `true`), so nothing waits on
    it forever. This doesn't depend on when the runtime loads saved values from the LMS. It's only done
    when every use of the flag can be answered; otherwise you get a warning. Shown in the review, and
    can be switched off
- Test questions can be deleted too. Lectora encrypts the test's question list (`_tobj….txt`);
  it's decrypted and re-encrypted with the package's own `enc.js` and `trivantis-titlemgr.js`
  (no key is stored in this app), and checked to read back exactly before saving, so learners
  still can't read the answers. Deleted questions leave the test, a section never draws more
  random questions than it has left, emptied sections go, and the pass/fail/back pages are
  pointed elsewhere if deleted. The test's results page can't be deleted
- Deleting a **main page** (the page the course opens on, or one many pages link to, like a student
  dashboard) gets a warning in the review. Links that have nowhere to go (the only page left nearby
  is the linking page itself) are listed there too, rather than silently left broken
- The Files tab can select several files the same way and delete them through the same review:
  pages are handled as above, other files show which pages still use them, and the course's player
  and tracking files (manifest, `trivantis*.js`, `enc.js`, the test files) can't be deleted
- The course check runs straight after, and the whole delete is one undo step. A broken link it
  finds has a **Fix** button: pick the page it should go to and the link is repointed

**Course check** (sidebar **Check** tab)
- Broken links have a **Fix** button to repoint them at a page you choose
- Finds links to pages that aren't in the package, Next/Back buttons that loop or point at their own
  page, visit tracking that lists missing pages, progress totals the pages can no longer reach, and
  manifest problems. Lectora's own runtime files (trivantis*.js etc.) aren't treated as course pages
- The Title Explorer uses the table of contents' page and chapter names when there is one

**Live edit view** (for pages built by JavaScript)
- Runs the page with its scripts, like a learner sees it, and lets you click text and images
- Shows which source file each piece of text lives in, then rewrites it there. It finds text
  inside JavaScript strings, JSON data files, HTML entities, `\u` escapes and `escape()` output,
  and writes the new text back in the same encoding so the file stays valid
- Double-click text to type over it, or edit it in the Properties panel (needed for SVG text)
- Replace an image or media file in place (it keeps its file name, so nothing else changes)
- With nothing selected, the right panel lists every image, video, audio and other file the page
  uses, with thumbnails, sizes and dimensions. Audio and video have a ▶ Play button. Images show
  **replacement specs** read from the file itself (real format, pixel size, aspect ratio,
  transparency, and the size it's shown at on the page), with a Copy button; replacing with an image
  of a different format, shape or transparency asks first. It includes files the page's script only names
  (audio played by an action, a popup not yet open), marks what's on screen, and lets you
  **Show** or **Replace** each one. Lectora's transparent spacer GIFs are left out
- **Interact** mode lets you click through a single-page player to the screen you want.
  Press **S** for Select & edit and **I** for Interact (ignored while typing in a text box)
- **Remove** callouts, buttons, images and other objects: select one and press 🗑 Remove in the
  panel. A click on part of an object (an SVG path, a word) removes the whole object, shown with
  Lectora's own name for it. Lectora draws an object with several elements named after it
  (`button6746path`, `button6746SVG`, `button6746MapArea`…), not always nested, and every part is hidden. Objects sitting on top of it (a callout's text) can go with it, and
  objects that repeat on many pages (a Table of Contents button) can be removed from all of them
  at once. Buttons that move the learner to another page get a warning first. Objects are hidden
  with a rule in the page's own `<style id="lc-removed">` block rather than cut out of the code,
  because the page's scripts still show, hide and animate them by id. With nothing selected, the
  panel lists what's been removed on the page, with Restore buttons
- Ctrl/⌘+Z and Ctrl/⌘+Y (or Shift+Z) undo and redo in every view, including while the Live edit
  page has focus; text boxes keep their own undo
- If the same text appears in several places, you pick which ones change
- Edit view spots pages that are mostly script and offers to switch to Live edit

**Find & Replace** (sidebar)
- Searches every text file in the package, however the text is encoded

**Preview view**
- Runs the course with scripts enabled against a built-in LMS
  (`window.API` for 1.2 and `window.API_1484_11` for 2004)
- Prev/Next through the organization, live completion/score readout, SCORM call log, reset
- Audio and video can be scrubbed: the preview server answers the byte-range requests players
  use to seek
- As you click through the course (in Preview or Live edit), the Title Explorer and Files tab
  highlight the page on screen and scroll to it. Switching views carries on from that page
- Works with Lectora's page player too, where the address stays on `a001index.html` while pages
  are swapped in: the page on screen is recognised by the Lectora objects it declares (the ones
  only that page has decide it), so the highlight, Remove and the page assets panel all follow it

**Code view**
- Edit any text file (HTML, CSS, JS, XML, JSON), including `imsmanifest.xml`

**Publish**
- Downloads a SCORM `.zip` with the manifest first. Files you didn't touch are byte-identical.
- Images, audio, video, PDFs and fonts are stored as-is (they're already compressed); only text
  files are deflated. On a 240 MB course-sized package this cut export from ~18s to ~3s with
  the same zip size
- A progress window (the same one used for import) shows each step, files done, the file being
  added, elapsed time and an estimate of time left, then a summary with a **Download again** button

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
src/lib/lectora.ts    Lectora page tracking; delete planning (rewire, tracking, manifest, flags)
src/lib/courseCheck.ts  broken links, loops, tracking and manifest checks
src/lib/package.ts    zip import/export
src/lib/html.ts       scripts-disabled edit copy <-> saved HTML
src/lib/vfs.ts        Cache Storage + public/sw.js serve project files to iframes
src/lib/store.ts      project state, undo/redo, autosave
src/lib/editor.ts     live editing session (select, insert, commit)
src/lib/scormApi.ts   preview LMS
src/lib/sourceMatch.ts  find on-screen text in source, however it's encoded
src/lib/live.ts       Live edit session (text write-back, asset replacement)
src/lib/frameFollow.ts  Follows the page a Live edit / Preview frame has navigated to
src/lib/removeObjects.ts  Hiding page objects by id (Live edit Remove / Restore)
src/lib/pageIdentity.ts   Which page a running document shows (address, or Lectora objects)
src/components/       React UI (ribbon, explorer, stage, properties)
```
