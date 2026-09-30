# SCORM Editor

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
- Deleting every page of a test, results page included, removes the test as a whole. Its question list
  is left as it is (the launch page loads it at start; nothing can open the test any more), and the
  review reminds you to check completion by reaching the last page in Preview
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

**Course rules** (sidebar **Rules** tab)
- Scans every page's own scripts and lists, in plain words, what the course does by itself:
  - **timers**: how long, what starts them, and what happens when they run out (e.g. a 10-minute timer
    that shows an inactivity warning, then a 2-minute one that goes to the session time-out page)
  - **when narration or video ends** (e.g. show the Next button; go on if auto-advance is chosen)
  - **what each page checks when it opens** (e.g. go to a lockout page if a saved flag is set)
  - **buttons with rules**: conditions, counters and lockouts (e.g. Next counts quick clicks and locks
    out after the fourth), buttons that close the course or jump elsewhere
  - **passwords written into the page code** (shown masked, with where they lead)
  - **test settings**: pass mark, time limit, questions per attempt and pool, pass/fail pages
  - **variables saved in the LMS**, with their starting values
- It follows Lectora's triggers (`loadActions`, `…onDone`, `…onUp`, `…onSelChg`, `…actionShow`) through the
  actions they call, including each condition's "otherwise" branch. A rule that repeats on many pages is
  listed once with the pages it's on (click one to open it); "the next page" is read from each page's own
  `trivNextPage`, so per-page targets still merge
- **Copy report** puts the whole list on the clipboard as text, to paste into an email or a chat. Passwords
  stay masked there too
- Runs in the browser on the course you've imported; about a second for a 400-page course

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
- **Move** objects: drag the selected object, nudge it with the arrow keys (Shift: 10px; hold to keep
  going), or type an exact X/Y in the Position panel. It moves on screen straight away and is saved
  when you stop (on drop, or a moment after the last key), so a burst of nudges is one undo step. Lectora's page declares each object's position
  (`new ObjText('text63337', null, 320, 9, …)` and `addIe8Attr(320, 9, …)`); those numbers are
  rewritten, so the course places the object there itself. An object repeated on many pages moves on
  all of them by default (or on this page only). "The same object" means the same id, or, since
  Lectora makes a separate copy per chapter (the copyright line is `text236596` in one chapter and
  `text236384` in another), the same kind and size at the same spot with the same text, picture
  (compared by the image's contents, since each copy gets its own file) or name.
  Only copies at the same spot move; a page that placed it elsewhere (a different layout) keeps its own.
  Remove and text edits use the same matching
- Editing text that belongs to an object repeated across pages (a copyright line, a header) ticks
  every page that has that object, so it changes everywhere by default
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
- Files a course loads with a synchronous request (Lectora's player reads its encrypted test,
  `_tobj….txt`, this way when it starts) are answered from the open project too. Browsers don't pass
  those through the service worker, so without this the course asked the web server and showed
  "You must run this content from a web-based server". The small helper that does it
  (`public/vfs-sync.js`) is added to pages only in the editor's view, never to the files you publish
- As you click through the course (in Preview or Live edit), the Title Explorer and Files tab
  highlight the page on screen and scroll to it. Switching views carries on from that page
- Works with Lectora's page player too, where the address stays on `a001index.html` while pages
  are swapped in: the page on screen is recognised by the Lectora objects it declares (the ones
  only that page has decide it), so the highlight, Remove and the page assets panel all follow it

**Answer required?** (Properties, and Live edit)
- Question pages are detected: final-test pages from the course's test file, pages with a Lectora
  question on them (module quizzes), and pages named like quizzes (`quiz`, `question`,
  `knowledge_check`, `kc`…). Any other page can be set by hand
- Per page: **Course default**, **Required** or **Not required**. Required holds the learner on the
  page until they answer (pick an option, type an answer, or the question's own answer variable gets a
  value): Next stays hidden, and a Submit button (quiz pages that score and move on in one click) stays
  on screen but only says "Please choose an answer first" when clicked
- Until then the page also can't move itself on: an auto-advance to the next page (when the narration
  ends, say) is dropped. Moves the learner asks for (Back, the table of contents) and moves elsewhere
  (a session timeout) still happen
- The course default applies to every question page that hasn't been set on its own; pages without
  a Next button are left as they are and listed. The Rules report shows which pages require an answer
- The rule is a small script the editor adds to the page (`<script id="lc-answer-rule">`), so
  choosing Not required or undoing removes it cleanly

**Code view**
- Edit any text file (HTML, CSS, JS, XML, JSON), including `imsmanifest.xml`

**Publish**
- Downloads a SCORM `.zip` with the manifest first. Files you didn't touch are byte-identical.
- Images, audio, video, PDFs and fonts are stored as-is (they're already compressed); only text
  files are deflated. On a 240 MB course-sized package this cut export from ~18s to ~3s with
  the same zip size
- A progress window (the same one used for import) shows each step, files done, the file being
  added, elapsed time and an estimate of time left, then a summary with a **Download again** button

Projects autosave to IndexedDB, with full undo/redo for every change. Refreshing the browser reopens
the project, page and view you had open. If part of the editor fails, it shows the error with
**Back to the editor** and **Copy details** instead of a blank page; the project stays open.

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

## Deploy with Docker

The editor is a static web app: everything runs in the browser, and projects are saved in each
user's own browser (IndexedDB). The container only serves files, keeps no data and needs no volumes.

```bash
docker compose up -d --build        # or:
docker build -t scorm-editor . && docker run -d --name scorm-editor -p 127.0.0.1:8080:8080 scorm-editor
```

Then open http://localhost:8080 on the same computer. `docker build --build-arg RUN_TESTS=true …` also
runs the unit tests during the build. Port 8080 only listens on this computer; for anyone else, see below.

### Let other people on your network use it

Browsers only show course pages over HTTPS (or on `localhost`), so other computers connect through
the HTTPS service in `docker-compose.yml`. It runs [Caddy](https://caddyserver.com), which makes its
own certificate for your address. Each computer then trusts Caddy's root certificate once.

1. **Find this computer's address on the network**, e.g. `192.168.1.50`: `ipconfig` on Windows
   (IPv4 Address), `ipconfig getifaddr en0` on macOS, `hostname -I` on Linux. Ask IT to reserve it
   (a DHCP reservation) so it doesn't change.
2. **Start it with HTTPS:**
   ```bash
   SITE_ADDRESS=192.168.1.50 docker compose --profile https up -d --build
   ```
   On Windows PowerShell: `$env:SITE_ADDRESS="192.168.1.50"; docker compose --profile https up -d --build`.
   Add `SITE_NAME=lectora.office.lan` too if your network has a name for this computer.
3. **Allow it through the firewall:** inbound TCP 443 (and 80, which just redirects to HTTPS).
   Windows: *Windows Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP 443*.
4. **Copy out the root certificate** (it stays the same across restarts, so this is once per setup):
   ```bash
   docker compose --profile https cp https:/data/caddy/pki/authorities/local/root.crt ./scorm-editor-root.crt
   ```
5. **Trust it on each computer that uses the editor** (yours too, if you'll use the HTTPS address):
   - Windows: double-click `scorm-editor-root.crt` → *Install Certificate* → *Local Machine* → *Place all
     certificates in the following store* → **Trusted Root Certification Authorities**. Restart the browser.
     (Chrome and Edge use this; so does Firefox with `security.enterprise_roots.enabled`.)
   - macOS: open it in *Keychain Access* → *System* keychain → double-click it → *Trust* → **Always Trust**.
   - Many at once: IT can push it with Group Policy / MDM.
6. **Open** `https://192.168.1.50` on that computer.

Clicking through a browser's "not secure" warning is not enough: the page opens, but course pages
can't be shown, and the editor says to install the certificate. Only trust this root on computers that
use the editor; anyone holding Caddy's data volume could make certificates those computers accept.

If your organisation already has certificates or an HTTPS proxy, use those instead of Caddy: point
them at port 8080 of the `scorm-editor` container.

- It works at the site root or under a path
- **HTTPS is required** anywhere but `localhost`. Course pages are shown through a service worker,
  and browsers only allow those over HTTPS. Put the container behind your usual HTTPS reverse proxy
  or load balancer (nginx, Caddy, Traefik, IIS, a cloud load balancer). Opened over plain HTTP from
  another machine, the editor says so instead of showing pages.
- It works at the site root or under a path (`https://tools.example.com/scorm-editor/`) with no rebuild;
  have the proxy strip the path prefix (e.g. nginx `location /scorm-editor/ { proxy_pass http://scorm-editor:8080/; }`).
- The image is nginx serving the built files, running as a non-root user on port 8080, with a
  `/healthz` endpoint and a Docker health check. `docker-compose.yml` also runs it read-only.
- Each user's projects live in their own browser on their own machine. Clearing browser data deletes
  them, and they don't move between computers, so publish a `.zip` as the backup and the way to hand
  a course to someone else.
- `index.html` and `sw.js` are served uncached and the other files have content-hashed names, so after
  an update people get the new version on their next page load.

### Getting updates

On a computer that runs the editor from a `git clone` of this repository, run the update script in
that folder. It pulls the latest code from GitHub, rebuilds the image and restarts the container.
Saved projects are kept, since they live in the browser, not the container.

- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\update.ps1`
- macOS / Linux: `./update.sh`

The first time, if the folder doesn't have the script yet, run `git pull` once and then the script.

That's the same as running `git pull` and then `docker compose up -d --build --remove-orphans` by hand.
The scripts also remove the container from before the app was renamed (`lectora-clone`), which
would otherwise keep port 8080 busy.

If you use the HTTPS setup, put its settings in a `.env` file next to `docker-compose.yml` so updates
keep them:

```
COMPOSE_PROFILES=https
SITE_ADDRESS=192.168.1.50
```

Without git, get the new image from whoever builds it: they run `docker compose build` and
`docker save scorm-editor:latest -o scorm-editor.tar`; you run `docker load -i scorm-editor.tar` and
then `docker compose up -d --no-build --remove-orphans` (or restart your `docker run` container).

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
src/lib/syncRead.ts       Answers course pages' synchronous file requests (with public/vfs-sync.js)
src/lib/lectoraDecl.ts    Reading Lectora object declarations (id, name, image, position)
src/lib/moveObjects.ts    Reading and rewriting Lectora objects' declared positions
src/lib/objectTwins.ts    The same object on other pages (same id, or a per-chapter copy)
src/lib/courseRules.ts    Course rules report: triggers → conditions → effects, merged across pages
src/components/       React UI (ribbon, explorer, stage, properties)
```
