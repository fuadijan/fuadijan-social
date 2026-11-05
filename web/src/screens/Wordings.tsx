import { useId, useState } from 'react';
import { Link } from 'react-router';
import { addWording, deleteWording, editLibraryRow, getWordings, linkWording, unlinkWording, updateWording } from '../api';
import { Button, Card, PageHeader } from '../components/fj';
import { PlatformTexts, PostText, type PostEdit } from '../components/PostTexts';
import { Empty, ErrorCard, Loading } from '../components/States';
import { WordingOptions } from '../components/WordingOptions';
import { fmtDate } from '../format';
import type { PostRef, PostWording, Wording, WordingInput, WordingLibrary } from '../types';
import { useApi } from '../useApi';

const EMPTY: WordingInput = { headline: '', line: '', caption: '' };

const BENEFIT_CAPTIONS = 'Benefit Caption Templates';

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
        <label className="sa-eyebrow" htmlFor={ids.headline}>Words for the design · two lines at most</label>
        <textarea id={ids.headline} className="sa-textarea" rows={2} value={w.headline} onChange={(e) => setW({ ...w, headline: e.target.value })} placeholder={'Time to\nSavour the Karahi'} maxLength={140} disabled={busy} />
        {lines > 2 ? <div className="sa-result sa-result--error">Two lines at most; the design has room for two.</div> : <div className="sa-note">These go under the product’s name on the design.</div>}
      </div>
      <div>
        <label className="sa-eyebrow" htmlFor={ids.line}>More for the design</label>
        <input id={ids.line} className="sa-input" value={w.line} onChange={(e) => setW({ ...w, line: e.target.value })} placeholder="Cooked to order, every evening." maxLength={140} disabled={busy} />
      </div>
      <div>
        <label className="sa-eyebrow" htmlFor={ids.caption}>Caption</label>
        <textarea id={ids.caption} className="sa-textarea" rows={3} value={w.caption} onChange={(e) => setW({ ...w, caption: e.target.value })} placeholder="Optional. Without one the post keeps its own caption." maxLength={2200} disabled={busy} />
      </div>
      <div className="sa-actions">
        <Button type="submit" variant="primary" disabled={!ok || busy}>{busy ? 'Saving…' : submitLabel}</Button>
        {onCancel ? <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  );
}

/** The posts under a wording: one wording, many posts. */
function PostChips({ posts, none }: { posts: PostRef[]; none: string }) {
  return (
    <div className="sa-word-links">
      <div className="sa-eyebrow">Posts</div>
      {posts.length ? (
        <div className="sa-word-days">
          {posts.map((p) => (
            <Link key={p.dayNo} className={`sa-word-day${p.inUse ? ' sa-word-day--use' : ''}`} to={`/day/${p.dayNo}`} title={fmtDate(p.date)}>
              Day {p.dayNo}{p.inUse ? ' · in use' : ''}{p.status === 'posted' ? ' ✓' : ''}
            </Link>
          ))}
        </div>
      ) : <div className="sa-note">{none}</div>}
    </div>
  );
}

/** Words not yet a reusable caption: the items they are on now, kept as links once one is added. */
interface OwnWords { label: string; items: string[]; headline: string; caption: string }

const linkNote = (posts: number, verb: string) => (posts ? `${verb} ${posts} post${posts === 1 ? '' : 's'} not yet posted.` : null);

/**
 * What a caption is linked to, on every caption card: a caption has many products and a product many captions. Tap × to
 * take it off one, or add a product or a group of them. Words not yet reusable become so with the first one added, so one
 * caption then serves them all and a change reaches them all.
 */
function WordingLinks({ w, own, listId, onChanged }: { w: Wording | null; own?: OwnWords; listId: string; onChanged: () => Promise<void> }) {
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function add(name: string) {
    if (w) return linkNote((await linkWording(w.id, name)).posts, 'Now offered on');
    const [first, ...rest] = [...own!.items, name];
    const made = await addWording(first!, { headline: own!.headline, line: '', caption: own!.caption });
    let posts = made.posts;
    for (const other of rest) posts += (await linkWording(made.wording.id, other)).posts;
    return linkNote(posts, 'Now offered on');
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await fn());
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
      <div className="sa-eyebrow">{w ? (w.items.length ? 'Linked to' : 'Not linked to anything yet') : own!.label}</div>
      <div className="sa-chips">
        {w ? w.items.map((i) => (
          <span key={i.itemKey} className="sa-word-link">
            {i.item}{i.products ? ` · ${i.products} product${i.products === 1 ? '' : 's'}` : ''}
            <button type="button" aria-label={`Take this caption off ${i.item}`} disabled={busy} onClick={() => void run(async () => linkNote((await unlinkWording(w.id, i.itemKey)).posts, 'Taken off'))}>×</button>
          </span>
        )) : own!.items.map((i) => <span key={i} className="sa-word-link">{i}</span>)}
      </div>
      <form className="sa-word-link-add" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void run(() => add(item.trim())); }}>
        <input className="sa-input" list={listId} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a product or group" aria-label="Add this caption to a product or a group of products" disabled={busy || (!w && !own!.headline.trim())} autoComplete="off" />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !item.trim()}>Add</Button>
      </form>
      {note ? <div className="sa-note" role="status">{note}</div> : null}
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </div>
  );
}

const spreadNote = (posts: number, rebuilding: number) => {
  if (!posts) return 'Saved. No post waiting to go out uses it yet.';
  const updated = `Saved, and updated on ${posts} post${posts === 1 ? '' : 's'} not yet posted.`;
  return rebuilding ? `${updated} ${rebuilding} design set${rebuilding === 1 ? ' is' : 's are'} being made again, about a minute each, and sent to Telegram.` : updated;
};

function WordingCard({ w, listId, onChanged }: { w: Wording; listId: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(input: WordingInput) {
    setBusy(true);
    setError(null);
    try {
      const r = await updateWording(w.id, input);
      setNote(spreadNote(r.posts, r.rebuilding));
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Forget this caption${w.items.length > 1 ? ` on all ${w.items.length} products` : ''}?\n\n${w.headline.replace('\n', ' / ')}`)) return;
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
        <div className="sa-note">Saving changes this caption for every linked product and on every post not yet posted, unless you changed it on that post.</div>
        {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
      </li>
    );
  }
  const onEvery = w.items.some((i) => i.itemKey === 'all');
  return (
    <li className="sa-wording-option">
      <div className="sa-wording-headline">{w.headline.split('\n').map((l, k) => <span key={k}>{l}</span>)}</div>
      {w.line ? <div className="sa-wording-line">{w.line}</div> : null}
      {w.caption ? <div className="sa-wording-caption">{w.caption}</div> : <div className="sa-note">No caption of its own.</div>}
      {note ? <div className="sa-result" role="status">{note}</div> : null}
      <PostChips posts={w.posts} none={onEvery ? 'Offered on every post; none is using it yet.' : 'No post uses it yet.'} />
      <WordingLinks w={w} listId={listId} onChanged={onChanged} />
      <div className="sa-wording-actions sa-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>Forget</Button>
      </div>
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </li>
  );
}

const STATUS_WORD: Record<string, string> = { planned: 'planned', 'photo-needed': 'needs a photo', ready: 'ready', posted: 'posted' };

/** One post's own words, with its post under them. Edit opens every text, as on the Day page. */
function PostCard({ p, reusable, listId, onChanged }: { p: PostWording; reusable: Map<number, Wording>; listId: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const edit: PostEdit = { dayNo: p.dayNo, reload: onChanged, onRebuild: () => setRebuilding(true) };
  const building = rebuilding ? <div className="sa-note" role="status">The designs for Day {p.dayNo} are being made again. About a minute.</div> : null;
  const post: PostRef = { dayNo: p.dayNo, date: p.date, status: p.status };
  if (open) {
    return (
      <li className="sa-wording-option sa-word-wide">
        <div className="sa-word-post-head">
          <Link to={`/day/${p.dayNo}`}><strong>Day {p.dayNo}</strong></Link>
          <span className="sa-muted">{fmtDate(p.date)} · {p.series} · {STATUS_WORD[p.status] ?? p.status}</span>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
        {building}
        <PostText {...edit} field="canva_headline" label="Title" value={p.headline} copy={false} hint="On the design, so saving makes the designs again." />
        <PostText {...edit} field="hook" label="Line" value={p.line} copy={false} hint="Under the title. A feed design shows it, so saving makes that design again." />
        <PostText {...edit} field="caption" label="Caption" value={p.caption} />
        <PostText {...edit} field="cta" label="CTA" value={p.cta} />
        <PostText {...edit} field="hashtags" label="Hashtags" value={p.hashtags} className="sa-hashtags" />
        <details className="sa-word-more">
          <summary>Other captions{p.platforms ? ', Facebook, TikTok and stories' : ''}</summary>
          <WordingOptions dayNo={p.dayNo} sets={p.set ? [p.set] : []} waiting={p.waiting} onChosen={onChanged} onRebuild={() => setRebuilding(true)} />
          {p.platforms ? <PlatformTexts p={p.platforms} edit={edit} /> : null}
        </details>
      </li>
    );
  }
  return (
    <li className="sa-wording-option">
      <div className="sa-wording-headline">{(p.headline || p.title).split('\n').map((l, k) => <span key={k}>{l}</span>)}</div>
      {p.line ? <div className="sa-wording-line">{p.line}</div> : null}
      {p.caption ? <div className="sa-wording-caption">{p.caption}</div> : <div className="sa-note">No caption yet.</div>}
      {p.hashtags ? <div className="sa-wording-caption sa-hashtags">{p.hashtags}</div> : null}
      {building}
      <PostChips posts={[post]} none="" />
      <div className="sa-note">{STATUS_WORD[p.status] ?? p.status}</div>
      <WordingLinks w={(p.reusableId && reusable.get(p.reusableId)) || null} own={{ label: 'On this post only', items: p.items, headline: p.line || p.headline, caption: p.caption }} listId={listId} onChanged={onChanged} />
      <div className="sa-wording-actions sa-actions">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Edit</Button>
      </div>
    </li>
  );
}

/** One library row: its words, then its posts. What it belongs to (series, goal, tag group) is a field like the rest, so moving a row is an edit. */
function LibraryRow({ lib, index, row, item, groups, reusable, linkList, onChanged }: { lib: WordingLibrary; index: number; row: string[]; item: string; groups: string[]; reusable: Map<number, Wording>; linkList: string; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const fixed = (col: number) => /id$/i.test(lib.header[col] ?? '') && col !== lib.groupColumn;
  const shown = lib.header.map((h, i) => ({ h, i, v: row[i] ?? '' })).filter((c) => c.i !== lib.groupColumn && !fixed(c.i) && c.v);
  const cell = (re: RegExp) => row[lib.header.findIndex((h) => re.test(h))] ?? '';
  const hook = cell(/^hook$/i);

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
          <datalist id={listId}>{groups.map((g) => <option key={g} value={g}>{lib.belongsTo[g.trim().toUpperCase()]}</option>)}</datalist>
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
      <PostChips posts={lib.posts[index] ?? []} none="No post uses it yet." />
      {hook ? <WordingLinks w={reusable.get(lib.reusable[index] ?? 0) ?? null} own={{ label: 'Belongs to', items: item ? [item] : [], headline: hook, caption: cell(/caption/i) }} listId={linkList} onChanged={onChanged} /> : <div className="sa-note">{item}</div>}
      <div className="sa-wording-actions sa-actions">
        <Button variant="secondary" size="sm" onClick={() => setDraft(lib.header.map((_, i) => row[i] ?? ''))}>Edit</Button>
      </div>
    </li>
  );
}

const libraryGroups = (lib: WordingLibrary) => [...new Set(lib.rows.map((r) => r[lib.groupColumn] ?? '').filter(Boolean))];
const benefitName = (lib: WordingLibrary, row: string[]) => {
  const id = (row[lib.groupColumn] ?? '').trim();
  return lib.belongsTo[id.toUpperCase()] ?? id;
};

function Library({ lib, query, reusable, linkList, onChanged }: { lib: WordingLibrary; query: string; reusable: Map<number, Wording>; linkList: string; onChanged: () => Promise<void> }) {
  const rows = lib.rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.join(' ').toLowerCase().includes(query));
  if (!rows.length) return null;
  const groups = libraryGroups(lib);
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
              {inGroup.map(({ row, index }) => <LibraryRow key={index} lib={lib} index={index} row={row} item={g} groups={groups} reusable={reusable} linkList={linkList} onChanged={onChanged} />)}
            </ul>
          </details>
        );
      })}
    </Card>
  );
}

type Show = 'all' | 'reusable' | 'posts' | 'benefit';
const SHOW: { key: Show; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'reusable', label: 'Reusable' }, { key: 'posts', label: 'Posts' }, { key: 'benefit', label: 'Benefits' }];

/**
 * Every caption in one list, each with the posts and the products it is linked to under it, and all of it editable: the
 * reusable captions (the same bank the Slogans sheet and /slogan feed), the words of every post in the plan and the
 * benefit captions, then the hook, CTA and hashtag libraries from the planning documents.
 */
export function Wordings() {
  const { data, error, loading, reload } = useApi(getWordings, 'wordings');
  const [item, setItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  const itemId = useId();
  const listId = useId();
  const query = search.trim().toLowerCase();
  const hit = (v: unknown) => !query || JSON.stringify(v).toLowerCase().includes(query);

  const byId = new Map((data?.reusable ?? []).map((w) => [w.id, w]));
  const benefit = data?.libraries.find((l) => l.name === BENEFIT_CAPTIONS) ?? null;
  const reusable = show === 'all' || show === 'reusable' ? (data?.reusable ?? []).filter((w) => hit([w.headline, w.line, w.caption, w.items])) : [];
  const posts = show === 'all' || show === 'posts' ? (data?.posts ?? []).filter((p) => hit([p.title, p.items, p.headline, p.line, p.caption, p.cta, p.hashtags])) : [];
  const benefitRows = benefit && (show === 'all' || show === 'benefit') ? benefit.rows.map((row, index) => ({ row, index })).filter(({ row }) => hit([row, benefitName(benefit, row)])) : [];
  const nothing = data && !reusable.length && !posts.length && !benefitRows.length;

  async function add(w: WordingInput) {
    const name = item.trim();
    if (!name) {
      setAddError('Which product is this caption for?');
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
      <PageHeader title="Captions" subtitle="Every caption, with its posts and products under it. Link a caption to as many products as it suits, and it is offered only on those." />
      <datalist id={listId}>
        <option value="all">Every post</option>
        {(data?.groups ?? []).map((g) => <option key={g} value={g}>Group</option>)}
        {(data?.products ?? []).map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="sa-stack">
        <Card>
          <details>
            <summary className="sa-word-add"><strong>+ Add a reusable caption</strong></summary>
            <div className="sa-form">
              <div>
                <label className="sa-eyebrow" htmlFor={itemId}>Product or group</label>
                <input id={itemId} className="sa-input" list={listId} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Chicken Karahi, a group, or “all” for every post" autoComplete="off" disabled={adding} />
              </div>
              <div className="sa-note">After adding it you can link it to more products.</div>
              <WordingForm key={formKey} initial={EMPTY} submitLabel="Add caption" busy={adding} onSubmit={(w) => void add(w)} />
              {addError ? <div className="sa-result sa-result--error" role="alert">{addError}</div> : null}
            </div>
          </details>
        </Card>
        {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
        {loading && !data ? <Loading what="Loading the captions" /> : null}
        {data ? (
          <>
            <input className="sa-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a product, a post or any words" aria-label="Search the captions" />
            <div className="sa-plan-switch" role="group" aria-label="Which captions">
              {SHOW.map((s) => <button key={s.key} type="button" className={`sa-plan-chip${show === s.key ? ' sa-plan-chip--on' : ''}`} onClick={() => setShow(s.key)}>{s.label}</button>)}
            </div>
          </>
        ) : null}
        {reusable.length ? (
          <Card title={`Reusable captions (${reusable.length})`}>
            <ul className="sa-wording-list">{reusable.map((w) => <WordingCard key={w.id} w={w} listId={listId} onChanged={reload} />)}</ul>
          </Card>
        ) : null}
        {posts.length ? (
          <Card title={`Post captions (${posts.length})`}>
            <ul className="sa-wording-list">{posts.map((p) => <PostCard key={p.dayNo} p={p} reusable={byId} listId={listId} onChanged={reload} />)}</ul>
          </Card>
        ) : null}
        {benefit && benefitRows.length ? (
          <Card title={`Benefit captions (${benefitRows.length})`}>
            <ul className="sa-wording-list">{benefitRows.map(({ row, index }) => <LibraryRow key={index} lib={benefit} index={index} row={row} item={benefitName(benefit, row)} groups={libraryGroups(benefit)} reusable={byId} linkList={listId} onChanged={reload} />)}</ul>
          </Card>
        ) : null}
        {nothing && (query || show !== 'all') ? <Empty>Nothing matches.</Empty> : null}
        {nothing && !query && show === 'all' ? <Empty>No captions yet. Add one above, or load the planning documents on the Strategy tab.</Empty> : null}
        {show === 'all' ? data?.libraries.filter((l) => l.name !== BENEFIT_CAPTIONS).map((lib) => <Library key={lib.name} lib={lib} query={query} reusable={byId} linkList={listId} onChanged={reload} />) : null}
        {data ? <p className="sa-note">Ready to use one? <Link to="/create">Create a design</Link>.</p> : null}
      </div>
    </>
  );
}
