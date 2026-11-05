import { useId, useState } from 'react';
import { Link } from 'react-router';
import { addWording, deleteWording, editLibraryRow, getWordings, linkWording, unlinkWording, updateWording } from '../api';
import { Button, Card, PageHeader } from '../components/fj';
import { PlatformTexts, PostText, type PostEdit } from '../components/PostTexts';
import { Empty, ErrorCard, Loading } from '../components/States';
import { WordingOptions } from '../components/WordingOptions';
import { fmtDate } from '../format';
import type { PostWording, Wording, WordingGroup, WordingInput, WordingLibrary } from '../types';
import { useApi } from '../useApi';

const EMPTY: WordingInput = { headline: '', line: '', caption: '' };

/**
 * One wording's fields: two short headline lines, a supporting line and a caption (the last two may stay empty:
 * a post then borrows the calendar's or the agent's). Used to add and to edit.
 */
function WordingForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial: WordingInput; submitLabel: string; busy: boolean; onSubmit: (w: WordingInput) => void; onCancel?: () => void }) {
  const [w, setW] = useState<WordingInput>(initial);
  const ids = { headline: useId(), line: useId(), caption: useId() };
  const lines = w.headline.split('\n').filter((l) => l.trim()).length;
  const ok = w.headline.trim().length > 0 && lines <= 2;
  return (
    <form
      className="sa-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onSubmit({ headline: w.headline.trim(), line: w.line.trim(), caption: w.caption.trim() });
      }}
    >
      <div>
        <label className="sa-eyebrow" htmlFor={ids.headline}>Headline · two short lines</label>
        <textarea id={ids.headline} className="sa-textarea" rows={2} value={w.headline} onChange={(e) => setW({ ...w, headline: e.target.value })} placeholder={'Time to\nSavour the Karahi'} maxLength={60} disabled={busy} />
        {lines > 2 ? <div className="sa-result sa-result--error">Two lines at most; the design has room for two.</div> : <div className="sa-note">Press Enter once for the second line. A short first line reads as a lead-in.</div>}
      </div>
      <div>
        <label className="sa-eyebrow" htmlFor={ids.line}>Supporting line</label>
        <input id={ids.line} className="sa-input" value={w.line} onChange={(e) => setW({ ...w, line: e.target.value })} placeholder="Cooked to order, every evening." maxLength={140} disabled={busy} />
      </div>
      <div>
        <label className="sa-eyebrow" htmlFor={ids.caption}>Caption</label>
        <textarea id={ids.caption} className="sa-textarea" rows={3} value={w.caption} onChange={(e) => setW({ ...w, caption: e.target.value })} placeholder="Optional. Without one the post keeps the agent's caption." maxLength={2200} disabled={busy} />
      </div>
      <div className="sa-actions">
        <Button type="submit" variant="primary" disabled={!ok || busy}>{busy ? 'Saving…' : submitLabel}</Button>
        {onCancel ? <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  );
}

/** What a wording is linked to: tap × to take it off an item, or add another. One wording, so a change reaches them all. */
function WordingLinks({ w, listId, onChanged }: { w: Wording; listId: string; onChanged: () => Promise<void> }) {
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setItem('');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-word-links">
      <div className="sa-eyebrow">{w.items.length ? 'Used for' : 'Not used for anything yet'}</div>
      <div className="sa-chips">
        {w.items.map((i) => (
          <span key={i.itemKey} className="sa-word-link">
            {i.item}
            <button type="button" aria-label={`Take this wording off ${i.item}`} disabled={busy} onClick={() => void run(() => unlinkWording(w.id, i.itemKey))}>×</button>
          </span>
        ))}
      </div>
      <form className="sa-word-link-add" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void run(() => linkWording(w.id, item.trim())); }}>
        <input className="sa-input" list={listId} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a product" aria-label="Add this wording to another item" disabled={busy} autoComplete="off" />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !item.trim()}>Add</Button>
      </form>
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </div>
  );
}

function WordingCard({ w, listId, onChanged }: { w: Wording; listId: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(input: WordingInput) {
    setBusy(true);
    setError(null);
    try {
      await updateWording(w.id, input);
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Forget this wording${w.items.length > 1 ? ` on all ${w.items.length} items` : ''}?\n\n${w.headline.replace('\n', ' / ')}`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWording(w.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="sa-wording-option sa-wording-option--chosen">
        <WordingForm initial={{ headline: w.headline, line: w.line ?? '', caption: w.caption ?? '' }} submitLabel="Save" busy={busy} onSubmit={(input) => void save(input)} onCancel={() => setEditing(false)} />
        {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
      </li>
    );
  }
  return (
    <li className="sa-wording-option">
      <div className="sa-wording-headline">{w.headline.split('\n').map((l, k) => <span key={k}>{l}</span>)}</div>
      {w.line ? <div className="sa-wording-line">{w.line}</div> : null}
      {w.caption ? <div className="sa-wording-caption">{w.caption}</div> : <div className="sa-note">No caption of its own.</div>}
      <WordingLinks w={w} listId={listId} onChanged={onChanged} />
      <div className="sa-wording-actions sa-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>Forget</Button>
        <span className="sa-note">{w.source === 'sheet' ? 'from the Slogans sheet' : w.source === 'strategy' ? 'from the strategy' : w.source === 'owner-web' ? 'added here' : 'added in Telegram'}</span>
      </div>
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </li>
  );
}

/** One post's wording, under each item the post is about. Every text is editable here, as on the Day page. */
function PostCard({ p, onChanged }: { p: PostWording; onChanged: () => Promise<void> }) {
  const [rebuilding, setRebuilding] = useState(false);
  const edit: PostEdit = { dayNo: p.dayNo, reload: onChanged, onRebuild: () => setRebuilding(true) };
  const options = p.set ? [p.set] : [];
  return (
    <div className="sa-word-post">
      <div className="sa-word-post-head">
        <Link to={`/day/${p.dayNo}`}><strong>Day {p.dayNo}</strong></Link>
        <span className="sa-muted">{fmtDate(p.date)} · {p.series} · {STATUS_WORD[p.status] ?? p.status}</span>
      </div>
      {rebuilding ? <div className="sa-note" role="status">The designs for Day {p.dayNo} are being made again. About a minute.</div> : null}
      <PostText {...edit} field="canva_headline" label="Title" value={p.headline} copy={false} hint="On the design, so saving makes the designs again." />
      <PostText {...edit} field="hook" label="Line" value={p.line} copy={false} hint="Under the title. A feed design shows it, so saving makes that design again." />
      <PostText {...edit} field="caption" label="Caption" value={p.caption} />
      <PostText {...edit} field="cta" label="CTA" value={p.cta} />
      <PostText {...edit} field="hashtags" label="Hashtags" value={p.hashtags} className="sa-hashtags" />
      <details className="sa-word-more">
        <summary>Other wordings{p.platforms ? ', Facebook, TikTok and stories' : ''}</summary>
        <WordingOptions dayNo={p.dayNo} sets={options} waiting={p.waiting} onChosen={onChanged} onRebuild={() => setRebuilding(true)} />
        {p.platforms ? <PlatformTexts p={p.platforms} edit={edit} /> : null}
      </details>
    </div>
  );
}

const STATUS_WORD: Record<string, string> = { planned: 'planned', 'photo-needed': 'needs a photo', ready: 'ready', posted: 'posted' };

function Group({ g, listId, open, onChanged }: { g: WordingGroup; listId: string; open: boolean; onChanged: () => Promise<void> }) {
  const n = g.wordings.length + g.posts.length;
  return (
    <details className="sa-word-group" open={open || undefined} id={`item-${g.itemKey.replace(/\s+/g, '-')}`}>
      <summary>
        <strong>{g.item}</strong>
        <span className="sa-note"> {g.category ? `${g.category} · ` : ''}{n} wording{n === 1 ? '' : 's'}</span>
      </summary>
      {g.itemKey === 'all' ? <div className="sa-note" style={{ marginTop: 8 }}>Offered on every post, whatever the product.</div> : null}
      {g.usedOn.length && g.itemKey !== 'all' ? (
        <div className="sa-word-used"><span className="sa-eyebrow">Posts</span> {g.usedOn.map((d) => <Link key={d.dayNo} className="sa-chip" to={`/day/${d.dayNo}`}>Day {d.dayNo}</Link>)}</div>
      ) : null}
      {g.wordings.length ? (
        <>
          <div className="sa-eyebrow" style={{ marginTop: 12 }}>Reusable wordings</div>
          <ul className="sa-wording-list">
            {g.wordings.map((w) => <WordingCard key={w.id} w={w} listId={listId} onChanged={onChanged} />)}
          </ul>
        </>
      ) : null}
      {g.posts.map((p) => <PostCard key={p.dayNo} p={p} onChanged={onChanged} />)}
    </details>
  );
}

/** One library row. Its belonging (series, goal, tag group) is a field like the rest, so moving a row is an edit. */
function LibraryRow({ lib, index, row, groups, onChanged }: { lib: WordingLibrary; index: number; row: string[]; groups: string[]; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const fixed = (col: number) => /id$/i.test(lib.header[col] ?? '') && col !== lib.groupColumn;
  const shown = lib.header.map((h, i) => ({ h, i, v: row[i] ?? '' })).filter((c) => c.i !== lib.groupColumn && !fixed(c.i) && c.v);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await editLibraryRow(lib.name, index, row, draft!);
      setDraft(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <li className="sa-wording-option sa-wording-option--chosen">
        <div className="sa-editor">
          {lib.header.map((h, i) => (fixed(i) ? null : (
            <label key={h} className="sa-eyebrow">{h}
              {(draft[i] ?? '').length > 60
                ? <textarea className="sa-textarea" rows={4} value={draft[i] ?? ''} disabled={busy} onChange={(e) => setDraft(draft.map((c, k) => (k === i ? e.target.value : c)))} />
                : <input className="sa-input" list={i === lib.groupColumn ? listId : undefined} value={draft[i] ?? ''} disabled={busy} onChange={(e) => setDraft(draft.map((c, k) => (k === i ? e.target.value : c)))} />}
            </label>
          )))}
          <datalist id={listId}>{groups.map((g) => <option key={g} value={g} />)}</datalist>
          <div className="sa-actions sa-editor-actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Cancel</Button>
          </div>
          {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
        </div>
      </li>
    );
  }
  return (
    <li className="sa-wording-option">
      {shown.map((c) => <div key={c.i}><span className="sa-eyebrow">{c.h}</span><div className="sa-wording-caption">{c.v}</div></div>)}
      <div className="sa-wording-actions"><Button variant="secondary" size="sm" onClick={() => setDraft(lib.header.map((_, i) => row[i] ?? ''))}>Edit</Button></div>
    </li>
  );
}

function Library({ lib, query, onChanged }: { lib: WordingLibrary; query: string; onChanged: () => Promise<void> }) {
  const rows = lib.rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.join(' ').toLowerCase().includes(query));
  if (!rows.length) return null;
  const groups = [...new Set(lib.rows.map((r) => r[lib.groupColumn] ?? '').filter(Boolean))];
  const shown = [...new Set(rows.map(({ row }) => row[lib.groupColumn] ?? ''))];
  return (
    <Card title={lib.title}>
      {shown.map((g) => {
        const inGroup = rows.filter(({ row }) => (row[lib.groupColumn] ?? '') === g);
        const belongs = lib.belongsTo[g.trim().toUpperCase()];
        return (
          <details key={g} className="sa-word-group" open={Boolean(query) || undefined}>
            <summary><strong>{g || 'Not grouped'}</strong><span className="sa-note"> {inGroup.length}{belongs ? ` · ${belongs}` : ''}</span></summary>
            <ul className="sa-wording-list" style={{ marginTop: 8 }}>
              {inGroup.map(({ row, index }) => <LibraryRow key={index} lib={lib} index={index} row={row} groups={groups} onChanged={onChanged} />)}
            </ul>
          </details>
        );
      })}
    </Card>
  );
}

/**
 * Every wording in one place, each with what it belongs to, and all of it editable: the wording bank (one wording, linked
 * to any number of items, offered whenever a post is about one of them and in the Create flow; the same bank the Slogans
 * sheet and /slogan feed), the wording of every post in the plan, and the libraries from the planning documents.
 */
export function Wordings() {
  const { data, error, loading, reload } = useApi(getWordings, 'wordings');
  const [item, setItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const itemId = useId();
  const listId = useId();
  const query = search.trim().toLowerCase();
  const groups = (data?.groups ?? []).filter((g) => !query || JSON.stringify([g.item, g.wordings, g.posts.map((p) => [p.title, p.headline, p.line, p.caption, p.cta, p.hashtags])]).toLowerCase().includes(query));

  async function add(w: WordingInput) {
    const name = item.trim();
    if (!name) {
      setAddError('Which product is this wording for?');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await addWording(name, w);
      setFormKey((k) => k + 1);
      await reload();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <PageHeader title="Wordings" subtitle="Every wording and what it belongs to. Tap an item to see and change its wordings." />
      <div className="sa-stack">
        <Card>
          <details>
          <summary className="sa-word-add"><strong>+ Add a reusable wording</strong></summary>
          <div className="sa-form">
            <div>
              <label className="sa-eyebrow" htmlFor={itemId}>Product</label>
              <input id={itemId} className="sa-input" list={listId} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Chicken Karahi — or “all” for every post" autoComplete="off" disabled={adding} />
              <datalist id={listId}>
                <option value="all" />
                {(data?.products ?? []).map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="sa-note">After adding it you can link it to more products.</div>
            <WordingForm key={formKey} initial={EMPTY} submitLabel="Add wording" busy={adding} onSubmit={(w) => void add(w)} />
            {addError ? <div className="sa-result sa-result--error" role="alert">{addError}</div> : null}
          </div>
          </details>
        </Card>
        {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
        {loading && !data ? <Loading what="Loading the wordings" /> : null}
        {data && data.groups.length === 0 && data.libraries.length === 0 ? <Empty>No wordings yet. Add one above, or load the planning documents on the Strategy tab.</Empty> : null}
        {data ? <input className="sa-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a product, a post or any words" aria-label="Search the wordings" /> : null}
        {data && groups.length ? (
          <Card title="By product and post">
            {groups.map((g) => <Group key={g.itemKey} g={g} listId={listId} open={Boolean(query)} onChanged={reload} />)}
          </Card>
        ) : null}
        {data?.libraries.map((lib) => <Library key={lib.name} lib={lib} query={query} onChanged={reload} />)}
        {data ? <p className="sa-note">Ready to use one? <Link to="/create">Create a design</Link>.</p> : null}
      </div>
    </>
  );
}
