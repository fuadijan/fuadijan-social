import { useId, useState } from 'react';
import { Button } from './fj';
import type { InviteDetails, StyleKey, Wording, WordingLibrary } from '../types';

/**
 * The step-by-step builder: a post (or a reel) is a handful of named parts, each shown on a labelled sketch of the
 * design. Every part is one step: pick its words from a list of the ones that belong to the product, change them if
 * you like, and see where they land before anything is made. Used by the Create page and by each day's page.
 */

export type BuildKind = 'post' | 'reel';
export type PartKey = 'label' | 'title' | 'line' | 'cover' | 'onscreen' | 'caption' | 'cta' | 'hashtags';

/** One of the words offered for a part; `from` names where it came from and groups the list. */
export interface PartChoice { id: string; text: string; from: string }
/** What the owner chose for a part: a choice's id, `own` (typed) or `agent` (the writer writes it); `text` is what is used. */
export interface PartValue { pick: string; text: string }
export type PartValues = Partial<Record<PartKey, PartValue>>;

export interface PartDef {
  key: PartKey;
  name: string;
  /** On the design itself, or posted with it. */
  on: 'design' | 'post';
  help: string;
  choices: PartChoice[];
  /** The writer may write this part. */
  agent?: boolean;
  /** Typed words allowed; false for a part a choice decides (the series label in Create). */
  editable?: boolean;
  rows: number;
  max: number;
  required?: boolean;
}

export const PARTS: Record<BuildKind, PartKey[]> = {
  post: ['label', 'title', 'line', 'caption', 'cta', 'hashtags'],
  reel: ['label', 'cover', 'onscreen', 'caption', 'cta', 'hashtags'],
};

const NAMES: Record<PartKey, { name: string; on: 'design' | 'post'; help: string; rows: number; max: number; required?: boolean }> = {
  label: { name: 'Series label', on: 'design', help: 'The small gold words at the top of the text.', rows: 1, max: 40 },
  title: { name: 'Title', on: 'design', help: 'The big words. The product’s name unless you choose other words; two short lines at most (Enter for the second).', rows: 2, max: 60, required: true },
  line: { name: 'Line under the title', on: 'design', help: 'One short sentence under the title.', rows: 2, max: 140 },
  cover: { name: 'Cover text', on: 'design', help: 'The words on the reel’s cover, the first thing people see.', rows: 2, max: 70, required: true },
  onscreen: { name: 'Text over the video', on: 'design', help: 'The text cards that appear over the clips, in order. One per line.', rows: 4, max: 600 },
  caption: { name: 'Caption', on: 'post', help: 'The words posted under the design.', rows: 6, max: 2200 },
  cta: { name: 'Call to action', on: 'post', help: 'One line asking people to do something: comment, save, visit.', rows: 2, max: 300 },
  hashtags: { name: 'Hashtags', on: 'post', help: 'Posted at the end of the caption.', rows: 3, max: 600 },
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** The server's rule for a link's name: whole words, a plural counts. */
const namedIn = (itemKey: string, about: string) => itemKey.length >= 3 && new RegExp(`(^|[^a-z0-9])${itemKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?($|[^a-z0-9])`).test(about);
const flat = (s: string) => s.replace(/\s*\n\s*/g, ' / ');

/** The reusable captions that belong to a product (by name or its group), then the ones for every post. */
export function wordingsFor(bank: Wording[], product: string, group: string): { mine: Wording[]; house: Wording[] } {
  const about = `${key(product)} | ${group.toLowerCase()}`;
  const once = (list: Wording[]) => list.filter((w, i) => list.findIndex((o) => o.id === w.id) === i);
  const mine = once(bank.filter((w) => w.itemKey !== 'all' && (namedIn(w.itemKey, about) || (product.trim() !== '' && w.itemKey.includes(key(product))))));
  const house = once(bank.filter((w) => w.itemKey === 'all')).filter((w) => !mine.some((m) => m.id === w.id));
  return { mine, house };
}

function libraryRows(libraries: WordingLibrary[], name: string): { cell: (row: string[], col: RegExp) => string; rows: string[][]; groupColumn: number } | null {
  const lib = libraries.find((l) => l.name === name);
  if (!lib) return null;
  const cell = (row: string[], col: RegExp) => row[lib.header.findIndex((h) => col.test(h.trim()))]?.trim() ?? '';
  return { cell, rows: lib.rows, groupColumn: lib.groupColumn };
}

export interface ChoiceSources {
  product: string;
  /** The product's category and series, for the captions linked to a group. */
  group: string;
  /** The series label the post is in (FROM THE TAWA): its hooks and hashtags come first. */
  series: string;
  bank: Wording[];
  libraries: WordingLibrary[];
  /** Words this post already has (the calendar's, the writer's), offered first. */
  extra?: Partial<Record<PartKey, PartChoice[]>>;
}

/** Every part's list of words, the ones belonging to the product and its series first. */
export function choicesFor(src: ChoiceSources): Record<PartKey, PartChoice[]> {
  const { mine, house } = wordingsFor(src.bank, src.product, src.group);
  const forProduct = `For ${src.product.trim() || 'this product'}`;
  const out: Record<PartKey, PartChoice[]> = { label: [], title: [], line: [], cover: [], onscreen: [], caption: [], cta: [], hashtags: [] };
  const add = (k: PartKey, c: PartChoice) => {
    const text = c.text.trim();
    if (text && !out[k].some((o) => key(o.text) === key(text))) out[k].push({ ...c, text });
  };
  for (const [k, list] of Object.entries(src.extra ?? {}) as [PartKey, PartChoice[]][]) for (const c of list) add(k, c);
  if (src.product.trim()) {
    add('title', { id: 'product', text: src.product.trim(), from: 'The product’s name' });
    add('cover', { id: 'product', text: src.product.trim(), from: 'The product’s name' });
  }
  for (const [list, from] of [[mine, forProduct], [house, 'For every post']] as const) {
    for (const w of list) {
      add('title', { id: `w${w.id}`, text: w.headline, from });
      add('line', { id: `w${w.id}`, text: w.line?.trim() || flat(w.headline), from });
      add('cover', { id: `w${w.id}`, text: flat(w.headline), from });
      if (w.caption?.trim()) add('caption', { id: `w${w.id}`, text: w.caption, from });
    }
  }
  const series = key(src.series);
  const hooks = libraryRows(src.libraries, 'Hooks Library');
  if (hooks) {
    const rows = [...hooks.rows].sort((a, b) => Number(key(b[hooks.groupColumn] ?? '') === series) - Number(key(a[hooks.groupColumn] ?? '') === series));
    rows.forEach((r) => {
      const text = hooks.cell(r, /^hook$/i);
      const group = r[hooks.groupColumn]?.trim() || 'Other';
      if (key(group) !== series) return;
      add('line', { id: `hook:${text}`, text, from: `Hooks · ${group}` });
      add('cover', { id: `hook:${text}`, text, from: `Hooks · ${group}` });
      add('onscreen', { id: `hook:${text}`, text, from: `Hooks · ${group}` });
    });
  }
  const benefits = libraryRows(src.libraries, 'Benefit Caption Templates');
  benefits?.rows.forEach((r) => {
    const text = benefits.cell(r, /caption/i);
    add('caption', { id: `ben:${text.slice(0, 40)}`, text, from: `Benefit captions · ${r[benefits.groupColumn] ?? ''}` });
  });
  const ctas = libraryRows(src.libraries, 'CTA Library');
  ctas?.rows.forEach((r) => {
    const text = ctas.cell(r, /^cta$/i);
    add('cta', { id: `cta:${text}`, text, from: `Calls to action · ${r[ctas.groupColumn]?.trim() || 'Other'}` });
  });
  const tags = libraryRows(src.libraries, 'Hashtag Library');
  if (tags) {
    const rows = [...tags.rows].sort((a, b) => Number(key(b[tags.groupColumn] ?? '') === series) - Number(key(a[tags.groupColumn] ?? '') === series));
    rows.forEach((r) => {
      const text = tags.cell(r, /^hashtags$/i);
      const platform = tags.cell(r, /^platform$/i);
      add('hashtags', { id: `tags:${text.slice(0, 40)}`, text, from: `Hashtags · ${r[tags.groupColumn]?.trim() || 'Other'}${platform ? ` · ${platform}` : ''}` });
    });
  }
  return out;
}

export function partDef(k: PartKey, choices: PartChoice[], opts: { agent?: boolean; editable?: boolean; help?: string } = {}): PartDef {
  const n = NAMES[k];
  return { key: k, ...n, help: opts.help ?? n.help, choices, agent: opts.agent, editable: opts.editable ?? true };
}

/** The first choice, or the writer when there is nothing to choose and it may write; a required part starts typed. */
export function startValue(def: PartDef, current?: string | null): PartValue {
  const now = current?.trim();
  if (now) return { pick: def.choices.find((c) => key(c.text) === key(now))?.id ?? 'own', text: now };
  const first = def.choices[0];
  if (first) return { pick: first.id, text: first.text };
  return def.agent && !def.required ? { pick: 'agent', text: '' } : { pick: 'own', text: '' };
}

/** One part: the list of words that belong to it, and the chosen words, which can be changed. */
export function PartStep({ n, def, value, onChange }: { n: number; def: PartDef; value: PartValue; onChange: (v: PartValue) => void }) {
  const [editing, setEditing] = useState(value.pick === 'own' && !value.text);
  const ids = { pick: useId(), text: useId() };
  const groups = def.choices.reduce<Record<string, PartChoice[]>>((acc, c) => ((acc[c.from] ??= []).push(c), acc), {});
  const chosen = def.choices.find((c) => c.id === value.pick);
  const changed = chosen && key(chosen.text) !== key(value.text);
  function pick(id: string) {
    if (id === 'agent') return onChange({ pick: 'agent', text: '' }), setEditing(false);
    if (id === 'own') return onChange({ pick: 'own', text: value.text }), setEditing(true);
    const c = def.choices.find((x) => x.id === id);
    if (c) onChange({ pick: c.id, text: c.text });
    setEditing(false);
  }
  return (
    <div className="sa-part">
      <div className="sa-part-head">
        <span className="sa-pin" aria-hidden="true">{n}</span>
        <div>
          <div className="sa-part-name">{def.name} <span className="sa-part-on">{def.on === 'design' ? 'on the design' : 'posted with it'}</span></div>
          <div className="sa-note">{def.help}</div>
        </div>
      </div>
      <label className="sa-eyebrow" htmlFor={ids.pick}>Choose the words</label>
      <select id={ids.pick} className="sa-input sa-select" value={value.pick} onChange={(e) => pick(e.target.value)}>
        {Object.entries(groups).map(([from, list]) => (
          <optgroup key={from} label={from}>
            {list.map((c) => <option key={c.id} value={c.id}>{flat(c.text).slice(0, 110)}{flat(c.text).length > 110 ? '…' : ''}</option>)}
          </optgroup>
        ))}
        <optgroup label="Or">
          {def.editable !== false ? <option value="own">Write my own</option> : null}
          {def.agent ? <option value="agent">Let the agent write it</option> : null}
        </optgroup>
      </select>
      {def.choices.length === 0 && def.editable !== false ? <div className="sa-note" style={{ marginTop: 6 }}>Nothing saved for this yet: write your own{def.agent ? ', or let the agent write it' : ''}.</div> : null}
      {value.pick === 'agent' ? (
        <div className="sa-part-text sa-part-text--muted">The agent writes this when the design is made. You can still change it on the day’s page.</div>
      ) : editing && def.editable !== false ? (
        <div style={{ marginTop: 10 }}>
          <label className="sa-eyebrow" htmlFor={ids.text}>Your words</label>
          <textarea id={ids.text} className="sa-textarea" rows={def.rows} maxLength={def.max} value={value.text} autoFocus
            onChange={(e) => onChange({ pick: value.pick === 'agent' ? 'own' : value.pick, text: def.key === 'title' ? e.target.value.split('\n').slice(0, 2).join('\n') : e.target.value })} />
          <div className="sa-actions sa-editor-actions">
            <Button variant="secondary" size="sm" disabled={def.required && !value.text.trim()} onClick={() => setEditing(false)}>Done</Button>
            {chosen && changed ? <Button variant="ghost" size="sm" onClick={() => onChange({ pick: chosen.id, text: chosen.text })}>Undo my changes</Button> : null}
          </div>
        </div>
      ) : (
        <div className="sa-part-text">
          <div className="sa-part-words">{value.text.trim() ? value.text : <span className="sa-muted">Empty</span>}</div>
          {changed ? <div className="sa-note">Changed by you.</div> : null}
          {def.editable !== false ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit these words</Button> : null}
        </div>
      )}
    </div>
  );
}

export interface Look { style: StyleKey | 'auto'; invite: InviteDetails }
export interface StyleOption { key: StyleKey; name: string; blurb: string }

/** "SATURDAY 14 NOV" from YYYY-MM-DD, as the Invite style prints it. */
export function inviteDay(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('en-AU', { weekday: 'long' })} ${d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }).replace('.', '')}`.toUpperCase();
}

/** The look of the design: a style from the list, and for Invite the date, the time and the message over the time. */
export function LookStep({ n, styles, value, onChange }: { n: number | string; styles: StyleOption[]; value: Look; onChange: (v: Look) => void }) {
  const ids = { s: useId(), d: useId(), t: useId(), m: useId() };
  const inv = value.invite;
  const setInvite = (patch: Partial<InviteDetails>) => onChange({ ...value, invite: { ...inv, ...patch } });
  const chosen = styles.find((s) => s.key === value.style);
  return (
    <div className="sa-part">
      <div className="sa-part-head">
        <span className="sa-pin" aria-hidden="true">{n}</span>
        <div>
          <div className="sa-part-name">Look <span className="sa-part-on">the style of the design</span></div>
          <div className="sa-note">How the words and the photo sit together. The art director can choose, or you can.</div>
        </div>
      </div>
      <label className="sa-eyebrow" htmlFor={ids.s}>Choose the style</label>
      <select id={ids.s} className="sa-input sa-select" value={value.style} onChange={(e) => onChange({ ...value, style: e.target.value as StyleKey | 'auto' })}>
        <option value="auto">Let the art director choose</option>
        {styles.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
      <div className="sa-part-text sa-part-text--muted">{chosen ? chosen.blurb : 'It reads the photo and picks the style that suits it.'}</div>
      {value.style === 'invite' ? (
        <div className="sa-invite">
          <div className="sa-eyebrow" style={{ marginTop: 12 }}>What the invite prints</div>
          <div>
            <label className="sa-eyebrow" htmlFor={ids.d}>Date</label>
            <input id={ids.d} className="sa-input" type="date" value={inv.date ?? ''} onChange={(e) => setInvite({ date: e.target.value || null })} />
            <div className="sa-note">{inv.date ? `Shows as ${inviteDay(inv.date)}.` : 'Empty: the day the post goes up.'}</div>
          </div>
          <div className="sa-invite-time">
            <div>
              <label className="sa-eyebrow" htmlFor={ids.m}>Message over the time</label>
              <input id={ids.m} className="sa-input" maxLength={24} value={inv.message} placeholder="FROM" onChange={(e) => setInvite({ message: e.target.value })} />
            </div>
            <div>
              <label className="sa-eyebrow" htmlFor={ids.t}>Time</label>
              <input id={ids.t} className="sa-input" maxLength={24} value={inv.time} placeholder="7AM – 10PM" onChange={(e) => setInvite({ time: e.target.value })} />
            </div>
          </div>
          <div className="sa-note">For example ALL DAY over 7AM – 10PM, or LAUNCH DAY over FROM 7AM. Empty: FROM over the opening hours.</div>
        </div>
      ) : null}
    </div>
  );
}

const shown = (v: PartValue | undefined, agentText: string) => (v?.pick === 'agent' ? agentText : v?.text.trim() ?? '');

/**
 * A drawing of the design with every part numbered where it goes, and what is posted with it underneath. It is a
 * sketch: the real preview, drawn on the photo, is a button away.
 */
export function Sketch({ kind, parts, values, active, photoUrl, footer, look, lookName }: { kind: BuildKind; parts: PartKey[]; values: PartValues; active: PartKey | null; photoUrl: string | null; footer: string; look?: Look | null; lookName?: string }) {
  const num = (k: PartKey) => parts.indexOf(k) + 1;
  const pin = (k: PartKey) => <span className="sa-pin sa-pin--on-photo" aria-hidden="true">{num(k)}</span>;
  const cls = (k: PartKey) => `sa-sketch-part${active === k ? ' sa-sketch-part--active' : ''}`;
  const cards = shown(values.onscreen, 'Text cards by the agent').split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <figure className="sa-sketch-wrap" aria-label="Sketch of the design, with each part numbered">
      <div className={`sa-sketch sa-sketch--${kind}`} style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}>
        {!photoUrl ? <span className="sa-sketch-photo">Your photo</span> : null}
        <span className="sa-sketch-logo">FUADIJAN</span>
        {lookName ? <span className="sa-sketch-look">Look: {lookName}</span> : null}
        {kind === 'reel' && parts.includes('onscreen') ? (
          <div className={`${cls('onscreen')} sa-sketch-cards`}>
            {pin('onscreen')}
            <span className="sa-sketch-hint">Over the video, one after another</span>
            {(cards.length ? cards.slice(0, 3) : ['Text over the video']).map((c, i) => <span key={i} className="sa-sketch-card">{c}</span>)}
            {cards.length > 3 ? <span className="sa-sketch-hint">+ {cards.length - 3} more</span> : null}
          </div>
        ) : null}
        <div className="sa-sketch-text">
          <div className={`${cls('label')} sa-sketch-label`}>{pin('label')}{shown(values.label, 'SERIES LABEL') || 'SERIES LABEL'}</div>
          {kind === 'post' ? (
            <>
              <div className={`${cls('title')} sa-sketch-title`}>{pin('title')}{(shown(values.title, 'Title') || 'Title').split('\n').map((l, i) => <span key={i}>{l}</span>)}</div>
              <div className={`${cls('line')} sa-sketch-line`}>{pin('line')}{shown(values.line, 'A line by the agent') || 'Line under the title'}</div>
            </>
          ) : (
            <div className={`${cls('cover')} sa-sketch-title`}>{pin('cover')}{shown(values.cover, 'Cover text') || 'Cover text'}</div>
          )}
          {look?.style === 'invite' ? (
            <div className="sa-sketch-invite">
              <span><b>{inviteDay(look.invite.date) || 'THE DAY IT GOES UP'}</b></span>
              <span><b>{look.invite.message.trim().toUpperCase() || 'FROM'}</b> {look.invite.time.trim() || 'opening hours'}</span>
            </div>
          ) : null}
          <div className="sa-sketch-footer" title="Set by the series">{footer || 'Footer'}</div>
        </div>
      </div>
      <figcaption className="sa-sketch-post">
        <div className="sa-eyebrow">Posted with it</div>
        <div className={cls('caption')}>{pin('caption')}<span className="sa-sketch-caption">{shown(values.caption, 'The agent writes the caption.') || 'Caption'}</span></div>
        <div className={cls('cta')}>{pin('cta')}<span>{shown(values.cta, 'A call to action by the agent.') || 'Call to action'}</span></div>
        <div className={cls('hashtags')}>{pin('hashtags')}<span className="sa-hashtags">{shown(values.hashtags, 'Hashtags by the agent.') || 'Hashtags'}</span></div>
      </figcaption>
    </figure>
  );
}

/** Every part and its words, numbered as on the sketch: the last look before the design is made. */
export function PartsSummary({ defs, values, onEdit }: { defs: PartDef[]; values: PartValues; onEdit?: (k: PartKey) => void }) {
  return (
    <ol className="sa-parts-summary">
      {defs.map((d, i) => {
        const v = values[d.key];
        return (
          <li key={d.key}>
            <span className="sa-pin" aria-hidden="true">{i + 1}</span>
            <div>
              <div className="sa-part-name">{d.name}</div>
              <div className="sa-part-words">{v?.pick === 'agent' ? <span className="sa-muted">The agent writes it</span> : v?.text.trim() ? v.text : <span className="sa-muted">Empty</span>}</div>
            </div>
            {onEdit ? <Button variant="ghost" size="sm" onClick={() => onEdit(d.key)}>Change</Button> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A photo the owner has only just chosen, made small enough to send for the preview (a HEIC goes as it is). */
export async function photoForPreview(file: File, maxEdge = 2000): Promise<string> {
  const asDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That photo could not be read.'));
    r.readAsDataURL(blob);
  });
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob) return asDataUrl(blob);
  } catch {
    // Not drawable here (a HEIC in most browsers): the server decodes it.
  }
  return asDataUrl(file);
}

/** The real preview's images, or why there are none. */
export function PreviewImages({ images, note }: { images: { format: string; dataUrl: string }[]; note: string | null }) {
  const label: Record<string, string> = { feed: 'Feed 4:5', story: 'Story 9:16', 'reel-cover': 'Reel cover 9:16' };
  return (
    <div>
      <div className="sa-images">
        {images.map((im) => (
          <div key={im.format} className="sa-image">
            <a className="sa-image-preview" href={im.dataUrl} target="_blank" rel="noreferrer"><img src={im.dataUrl} alt={`Preview: ${label[im.format] ?? im.format}`} /></a>
            <div className="sa-image-label">{label[im.format] ?? im.format}</div>
          </div>
        ))}
      </div>
      {note ? <div className="sa-note" style={{ marginTop: 8 }}>{note}</div> : null}
    </div>
  );
}
