import { useId, useState } from 'react';
import { Link } from 'react-router';
import { addWording, deleteWording, getWordings, updateWording } from '../api';
import { Button, Card, PageHeader } from '../components/fj';
import { Empty, ErrorCard, Loading } from '../components/States';
import type { Wording, WordingGroup, WordingInput } from '../types';
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

function WordingCard({ w, onChanged }: { w: Wording; onChanged: () => Promise<void> }) {
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
    if (!window.confirm(`Forget this wording?\n\n${w.headline.replace('\n', ' / ')}`)) return;
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
      <div className="sa-wording-actions sa-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>Forget</Button>
        <span className="sa-note">{w.source === 'sheet' ? 'from the Slogans sheet' : w.source === 'owner-web' ? 'added here' : 'added in Telegram'}</span>
      </div>
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </li>
  );
}

function Group({ g, onChanged }: { g: WordingGroup; onChanged: () => Promise<void> }) {
  return (
    <Card title={g.item} id={`item-${g.itemKey.replace(/\s+/g, '-')}`}>
      {g.itemKey === 'all' ? <div className="sa-note" style={{ marginBottom: 10 }}>Offered on every post, whatever the product.</div> : null}
      <ul className="sa-wording-list">
        {g.wordings.map((w) => <WordingCard key={w.id} w={w} onChanged={onChanged} />)}
      </ul>
    </Card>
  );
}

/**
 * The wording bank: for each product (one to many) the headlines, lines and captions the owner keeps, offered
 * as wording options whenever a post is about that product and as the choices in the Create flow. The same
 * bank the Slogans sheet and /slogan feed.
 */
export function Wordings() {
  const { data, error, loading, reload } = useApi(getWordings, 'wordings');
  const [item, setItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const itemId = useId();
  const listId = useId();

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
      <PageHeader title="Wordings" subtitle="Titles and lines per product, offered whenever a post is about it" />
      <div className="sa-stack">
        <Card title="Add a wording">
          <div className="sa-form">
            <div>
              <label className="sa-eyebrow" htmlFor={itemId}>Product</label>
              <input id={itemId} className="sa-input" list={listId} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Chicken Karahi — or “all” for every post" autoComplete="off" disabled={adding} />
              <datalist id={listId}>
                <option value="all" />
                {(data?.products ?? []).map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <WordingForm key={formKey} initial={EMPTY} submitLabel="Add wording" busy={adding} onSubmit={(w) => void add(w)} />
            {addError ? <div className="sa-result sa-result--error" role="alert">{addError}</div> : null}
          </div>
        </Card>
        {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
        {loading && !data ? <Loading what="Loading the wordings" /> : null}
        {data && data.groups.length === 0 ? <Empty>No wordings yet. Add one above, or fill the Slogans sheet next to the monthly plan and run the seed.</Empty> : null}
        {data?.groups.map((g) => <Group key={g.itemKey} g={g} onChanged={reload} />)}
        {data ? <p className="sa-note">Ready to use one? <Link to="/create">Create a design</Link>.</p> : null}
      </div>
    </>
  );
}
