import { useState } from 'react';
import { addPostWording, chooseWording, editPostWording, type RebuildResult } from '../api';
import { Button } from './fj';
import type { WordingOption, WordingSet } from '../types';

/** The words of one wording: the title, the line under it and the caption. */
function WordingForm({ start, busy, submitLabels, onSubmit, onCancel }: { start: Pick<WordingOption, 'headline' | 'line' | 'caption'>; busy: boolean; submitLabels: { label: string; use: boolean }[]; onSubmit: (w: { headline: string; line: string; caption: string }, use: boolean) => void; onCancel: () => void }) {
  const [headline, setHeadline] = useState(start.headline);
  const [line, setLine] = useState(start.line);
  const [caption, setCaption] = useState(start.caption);
  const words = { headline: headline.trim(), line: line.trim(), caption: caption.trim() };
  return (
    <div className="sa-editor">
      <label className="sa-eyebrow">Title (the product by default; two lines at most)
        <textarea className="sa-textarea" rows={2} maxLength={60} value={headline} onChange={(e) => setHeadline(e.target.value)} disabled={busy} />
      </label>
      <label className="sa-eyebrow">Line under the title
        <input className="sa-input" maxLength={140} value={line} onChange={(e) => setLine(e.target.value)} disabled={busy} />
      </label>
      <label className="sa-eyebrow">Caption
        <textarea className="sa-textarea" rows={5} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={busy} />
      </label>
      <div className="sa-actions sa-editor-actions">
        {submitLabels.map((s, i) => (
          <Button key={s.label} variant={i === 0 ? 'primary' : 'secondary'} size="sm" disabled={busy || !words.headline} onClick={() => onSubmit(words, s.use)}>{busy ? 'Saving…' : s.label}</Button>
        ))}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Every wording the agent has written for this day, newest set first: the calendar's own wording, Claude's
 * alternatives and anything the owner typed. "Use this" picks one; if the pipeline is waiting on the choice the
 * design renders with it, otherwise the designs and the pack are rebuilt with it. The latest set's wordings can be
 * changed, and the owner can add their own at any time.
 */
export function WordingOptions({ dayNo, sets, waiting, onChosen, onRebuild }: { dayNo: number; sets: WordingSet[]; waiting: boolean; onChosen: () => void | Promise<void>; onRebuild: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function run(key: string, fn: () => Promise<RebuildResult>, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      const r = await fn();
      setNote(r.message);
      after?.();
      if (r.rebuilding) onRebuild();
      await onChosen();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const pick = (set: WordingSet, index: number) => run(`${set.id}:${index}`, () => chooseWording(dayNo, set.id, index));

  return (
    <div className="sa-wording">
      {waiting ? <div className="sa-draft">The design is waiting for your pick.</div> : null}
      {adding ? (
        <WordingForm
          start={{ headline: sets[0]?.options[sets[0].chosen ?? 0]?.headline ?? '', line: '', caption: sets[0]?.options[sets[0].chosen ?? 0]?.caption ?? '' }}
          busy={busy !== null}
          submitLabels={[{ label: 'Add and use it', use: true }, { label: 'Just add it', use: false }]}
          onSubmit={(w, use) => void run('add', () => addPostWording(dayNo, w, use), () => setAdding(false))}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="sa-wording-actions"><Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setAdding(true)}>+ Add your own caption</Button></div>
      )}
      {sets.map((set, si) => (
        <div key={set.id} className="sa-wording-set">
          {sets.length > 1 ? <div className="sa-eyebrow">{si === 0 ? 'Latest' : `Earlier (${new Date(set.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })})`}</div> : null}
          <ul className="sa-wording-list">
            {set.options.map((o, i) => {
              const chosen = set.chosen === i;
              const key = `${set.id}:${i}`;
              if (editing === key) {
                return (
                  <li key={i} className="sa-wording-option">
                    <WordingForm
                      start={o}
                      busy={busy !== null}
                      submitLabels={[{ label: chosen ? 'Save and update the post' : 'Save', use: false }]}
                      onSubmit={(w) => void run(key, () => editPostWording(dayNo, set.id, i, w), () => setEditing(null))}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                );
              }
              return (
                <li key={i} className={`sa-wording-option${chosen ? ' sa-wording-option--chosen' : ''}`}>
                  <div className="sa-wording-head">
                    <span className="sa-wording-name">{i + 1} · {o.name.replace(/wording/i, 'caption').replace(/^Slogan/, 'Reusable')}</span>
                    {chosen ? <span className="sa-wording-chosen">in use</span> : null}
                  </div>
                  <div className="sa-wording-headline">{o.headline.split('\n').map((l, k) => <span key={k}>{l}</span>)}</div>
                  <div className="sa-wording-line">{o.line}</div>
                  <div className="sa-wording-caption">{o.caption}</div>
                  <div className="sa-wording-actions">
                    <Button variant={chosen ? 'ghost' : 'secondary'} size="sm" disabled={busy !== null || chosen} onClick={() => void pick(set, i)}>
                      {busy === `${set.id}:${i}` ? 'Applying…' : chosen ? 'Chosen' : 'Use this'}
                    </Button>
                    {si === 0 ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing(key)}>Edit</Button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {note ? <div className="sa-result" role="status">{note}</div> : null}
    </div>
  );
}
