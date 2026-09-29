import { useRef, type ReactNode } from 'react';
import * as actions from '../lib/actions';
import { editor, NON_TEXT_TAGS, useEditor } from '../lib/editor';
import { isImageFile, isMediaFile, relative, resolveFrom } from '../lib/paths';
import { useStore } from '../lib/store';
import { describe } from './EditStage';
import { LivePanel } from './LivePanel';

type El = HTMLElement;

function change(label: string, fn: () => void) {
  fn();
  void editor.commit(label);
}

/** Text input that applies on Enter/blur so each edit is one undo step. */
function Field(props: { label: string; value: string; placeholder?: string; onApply: (v: string) => void; wide?: boolean; list?: string }) {
  return (
    <label className={'field' + (props.wide ? ' wide' : '')}>
      <span>{props.label}</span>
      <input
        key={props.value}
        defaultValue={props.value}
        placeholder={props.placeholder}
        list={props.list}
        onBlur={(e) => e.target.value !== props.value && props.onApply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="section" open>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function toHex(color: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
  return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

function ColorField({ el, prop, label }: { el: El; prop: 'color' | 'backgroundColor' | 'borderColor'; label: string }) {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const inline = el.style[prop];
  const transparent = !inline && /rgba\(\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(cs[prop]);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="color-row">
        <input
          type="color"
          value={toHex(inline || cs[prop])}
          onChange={(e) => {
            el.style[prop] = e.target.value;
          }}
          onBlur={() => void editor.commit(`Change ${label.toLowerCase()}`)}
        />
        {transparent && <span className="none-note">none</span>}
        {inline && (
          <button title="Clear" onClick={() => change(`Clear ${label.toLowerCase()}`, () => (el.style[prop] = ''))}>
            ✕
          </button>
        )}
      </span>
    </label>
  );
}

function StyleField({ el, prop, label, placeholder }: { el: El; prop: string; label: string; placeholder?: string }) {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  return (
    <Field
      label={label}
      value={el.style.getPropertyValue(prop)}
      placeholder={placeholder ?? cs.getPropertyValue(prop)}
      onApply={(v) => change(`Change ${label.toLowerCase()}`, () => el.style.setProperty(prop, /^-?\d+(\.\d+)?$/.test(v) && prop !== 'z-index' && prop !== 'opacity' && prop !== 'line-height' && prop !== 'font-weight' ? v + 'px' : v))}
    />
  );
}

function Toggle({ el, prop, on, label, title }: { el: El; prop: string; on: string; label: string; title: string }) {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const active = cs.getPropertyValue(prop).includes(on) || (prop === 'font-weight' && Number(cs.fontWeight) >= 600);
  return (
    <button
      className={'toggle' + (active ? ' active' : '')}
      title={title}
      onClick={() => change(title, () => el.style.setProperty(prop, active ? (prop === 'font-weight' ? 'normal' : 'none') : on))}
    >
      {label}
    </button>
  );
}

const FONTS = ['Arial, Helvetica, sans-serif', 'Georgia, serif', '"Times New Roman", serif', 'Verdana, sans-serif', 'Tahoma, sans-serif', '"Trebuchet MS", sans-serif', '"Courier New", monospace', 'system-ui, sans-serif'];

function AssetPicker({ el, attr, pagePath, accept, filter }: { el: El; attr: string; pagePath: string; accept: string; filter: (p: string) => boolean }) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const current = resolveFrom(pagePath, el.getAttribute(attr) ?? '');
  const options = Object.keys(s.project!.files).filter(filter).sort();
  const setPath = (path: string) => change(`Change ${attr}`, () => el.setAttribute(attr, relative(pagePath, path)));
  return (
    <>
      <label className="field wide">
        <span>File</span>
        <select value={current ?? ''} onChange={(e) => e.target.value && setPath(e.target.value)}>
          <option value="">{current ? '(external) ' + el.getAttribute(attr) : '— choose —'}</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
      <button onClick={() => input.current?.click()}>Upload new file…</button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setPath(await actions.addAsset(f, 'assets'));
        }}
      />
    </>
  );
}

function ElementProps({ el, pagePath }: { el: El; pagePath: string }) {
  const tag = el.tagName.toUpperCase();
  const leafText = el.children.length === 0 && !NON_TEXT_TAGS.has(tag);
  const pages = actions.htmlPages().filter((p) => !p.includes('__lc_edit__'));

  return (
    <>
      <div className="props-head">
        <b className="mono">{describe(el)}</b>
        <div className="btn-grid">
          <button onClick={() => el.parentElement && el.parentElement !== el.ownerDocument.documentElement && editor.select(el.parentElement)} title="Select the containing element (Alt+click)">Parent</button>
          {!NON_TEXT_TAGS.has(tag) && <button onClick={() => editor.startTextEdit(el)} title="Edit text in place (double-click)">Edit text</button>}
          <button onClick={() => void editor.duplicateSelected()} title="Ctrl+D">Duplicate</button>
          <button onClick={() => void editor.deleteSelected()} title="Delete">Delete</button>
          <button onClick={() => void editor.restack('front')}>To front</button>
          <button onClick={() => void editor.restack('back')}>To back</button>
        </div>
      </div>

      {leafText && (
        <Section title="Text">
          <textarea
            key={el.textContent ?? ''}
            className="text-edit"
            defaultValue={el.textContent ?? ''}
            onBlur={(e) => e.target.value !== el.textContent && change('Edit text', () => (el.textContent = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </Section>
      )}

      {tag === 'IMG' && (
        <Section title="Image">
          <AssetPicker el={el} attr="src" pagePath={pagePath} accept="image/*" filter={isImageFile} />
          <Field label="Alt text" wide value={el.getAttribute('alt') ?? ''} placeholder="Describe the image for screen readers" onApply={(v) => change('Change alt text', () => el.setAttribute('alt', v))} />
        </Section>
      )}

      {(tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE') && (
        <Section title="Media">
          <AssetPicker el={el} attr="src" pagePath={pagePath} accept="audio/*,video/*" filter={isMediaFile} />
          {(['controls', 'autoplay', 'loop', 'muted'] as const).map((a) => (
            <label key={a} className="check">
              <input type="checkbox" checked={el.hasAttribute(a)} onChange={(e) => change(`Toggle ${a}`, () => el.toggleAttribute(a, e.target.checked))} /> {a}
            </label>
          ))}
        </Section>
      )}

      {tag === 'A' && (
        <Section title="Link / Action">
          <label className="field wide">
            <span>Go to page</span>
            <select
              value={resolveFrom(pagePath, el.getAttribute('href') ?? '') ?? ''}
              onChange={(e) => e.target.value && change('Change link', () => el.setAttribute('href', relative(pagePath, e.target.value)))}
            >
              <option value="">— other / URL —</option>
              {pages.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <Field label="URL" wide value={el.getAttribute('href') ?? ''} onApply={(v) => change('Change link', () => el.setAttribute('href', v))} />
          <label className="check">
            <input type="checkbox" checked={el.getAttribute('target') === '_blank'} onChange={(e) => change('Change link target', () => (e.target.checked ? el.setAttribute('target', '_blank') : el.removeAttribute('target')))} /> Open in new window
          </label>
        </Section>
      )}

      <Section title="Position & size">
        <label className="field">
          <span>Position</span>
          <select value={el.style.position || ''} onChange={(e) => change('Change positioning', () => (el.style.position = e.target.value))}>
            <option value="">(stylesheet)</option>
            <option value="static">flow</option>
            <option value="relative">relative</option>
            <option value="absolute">absolute</option>
          </select>
        </label>
        <StyleField el={el} prop="z-index" label="Layer (z)" />
        <StyleField el={el} prop="left" label="X" />
        <StyleField el={el} prop="top" label="Y" />
        <StyleField el={el} prop="width" label="Width" />
        <StyleField el={el} prop="height" label="Height" />
        <StyleField el={el} prop="opacity" label="Opacity" placeholder="0–1" />
        <StyleField el={el} prop="transform" label="Transform" placeholder="rotate(5deg)" />
      </Section>

      {!NON_TEXT_TAGS.has(tag) && (
        <Section title="Text style">
          <label className="field wide">
            <span>Font</span>
            <select value={el.style.fontFamily} onChange={(e) => change('Change font', () => (el.style.fontFamily = e.target.value))}>
              <option value="">(inherited)</option>
              {FONTS.map((f) => (
                <option key={f} value={f}>{f.split(',')[0].replace(/"/g, '')}</option>
              ))}
              {el.style.fontFamily && !FONTS.includes(el.style.fontFamily) && <option value={el.style.fontFamily}>{el.style.fontFamily}</option>}
            </select>
          </label>
          <StyleField el={el} prop="font-size" label="Size" />
          <StyleField el={el} prop="line-height" label="Line height" />
          <ColorField el={el} prop="color" label="Text color" />
          <div className="toggles">
            <Toggle el={el} prop="font-weight" on="bold" label="B" title="Bold" />
            <Toggle el={el} prop="font-style" on="italic" label="I" title="Italic" />
            <Toggle el={el} prop="text-decoration-line" on="underline" label="U" title="Underline" />
            {(['left', 'center', 'right', 'justify'] as const).map((a) => (
              <button key={a} className={'toggle' + (el.style.textAlign === a ? ' active' : '')} title={`Align ${a}`} onClick={() => change('Align text', () => (el.style.textAlign = a))}>
                {{ left: '⯇', center: '≡', right: '⯈', justify: '☰' }[a]}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Fill & border">
        <ColorField el={el} prop="backgroundColor" label="Background" />
        <ColorField el={el} prop="borderColor" label="Border color" />
        <StyleField el={el} prop="border-width" label="Border width" />
        <StyleField el={el} prop="border-style" label="Border style" placeholder="solid" />
        <StyleField el={el} prop="border-radius" label="Corner radius" />
        <StyleField el={el} prop="padding" label="Padding" />
        <StyleField el={el} prop="box-shadow" label="Shadow" placeholder="0 2px 6px #0003" />
      </Section>

      <Section title="Attributes">
        <Field label="ID" value={el.id} onApply={(v) => change('Change id', () => (v ? (el.id = v) : el.removeAttribute('id')))} />
        <Field label="Class" value={el.getAttribute('class') ?? ''} onApply={(v) => change('Change class', () => (v ? el.setAttribute('class', v) : el.removeAttribute('class')))} />
        <Field label="Tooltip" wide value={el.getAttribute('title') ?? ''} onApply={(v) => change('Change tooltip', () => (v ? el.setAttribute('title', v) : el.removeAttribute('title')))} />
        <Field label="Inline style" wide value={el.getAttribute('style') ?? ''} onApply={(v) => change('Change style', () => el.setAttribute('style', v))} />
      </Section>

      {!NON_TEXT_TAGS.has(tag) && (
        <details className="section">
          <summary>Inner HTML</summary>
          <div className="section-body">
            <textarea
              key={el.innerHTML}
              className="text-edit mono"
              defaultValue={el.innerHTML}
              onBlur={(e) => e.target.value !== el.innerHTML && change('Edit HTML', () => (el.innerHTML = e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </details>
      )}
    </>
  );
}

function PageProps({ doc }: { doc: Document }) {
  const s = useStore();
  const body = doc.body;
  return (
    <>
      <div className="props-head">
        <b>Page</b>
        <div className="mono muted small">{s.currentPath}</div>
      </div>
      <Section title="Page">
        <Field label="Browser title" wide value={doc.title} onApply={(v) => change('Change page title', () => (doc.title = v))} />
        <ColorField el={body} prop="backgroundColor" label="Background" />
      </Section>
      <p className="hint">
        Click an object on the page to select it. Drag to move, use the handles to resize, double-click to edit
        text. Alt+click selects the parent. Arrow keys nudge (Shift = 10px).
      </p>
      <p className="hint">
        Scripts are paused while editing so you see the page as authored. Content that a script draws at runtime
        (common in Storyline and Captivate exports) only shows in Preview; edit it through the Code view.
      </p>
    </>
  );
}

export function PropertiesPanel() {
  const ed = useEditor();
  const s = useStore();
  let body: ReactNode;
  if (s.view === 'live') body = <LivePanel />;
  else if (s.view !== 'edit') body = <p className="hint">Switch to Edit view to change page objects.</p>;
  else if (!ed.doc || !ed.path) body = <p className="hint">Open an HTML page to see its properties.</p>;
  else if (ed.selected && ed.selected.isConnected) body = <ElementProps key={ed.getVersion()} el={ed.selected} pagePath={ed.path} />;
  else body = <PageProps key={ed.getVersion()} doc={ed.doc} />;
  return (
    <aside className="props">
      <div className="tabs">
        <button className="active">Properties</button>
      </div>
      <div className="panel-body">{body}</div>
    </aside>
  );
}
