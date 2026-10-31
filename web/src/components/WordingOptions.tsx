import { useState } from 'react';
import { chooseWording } from '../api';
import { Button } from './fj';
import type { WordingSet } from '../types';

/**
 * Every wording the agent has written for this day, newest set first: the calendar's own wording, Claude's
 * alternatives and anything the owner typed. "Use this" picks one; if the pipeline is waiting on the choice the
 * design renders with it, otherwise the designs and the pack are rebuilt with it.
 */
export function WordingOptions({ dayNo, sets, waiting, onChosen }: { dayNo: number; sets: WordingSet[]; waiting: boolean; onChosen: () => void | Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (sets.length === 0) return null;

  async function pick(set: WordingSet, index: number) {
    const key = `${set.id}:${index}`;
    setBusy(key);
    setNote(null);
    try {
      const r = await chooseWording(dayNo, set.id, index);
      setNote(r.message);
      await onChosen();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sa-wording">
      {waiting ? <div className="sa-draft">The design is waiting for your pick.</div> : null}
      {sets.map((set, si) => (
        <div key={set.id} className="sa-wording-set">
          {sets.length > 1 ? <div className="sa-eyebrow">{si === 0 ? 'Latest' : `Earlier (${new Date(set.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })})`}</div> : null}
          <ul className="sa-wording-list">
            {set.options.map((o, i) => {
              const chosen = set.chosen === i;
              return (
                <li key={i} className={`sa-wording-option${chosen ? ' sa-wording-option--chosen' : ''}`}>
                  <div className="sa-wording-head">
                    <span className="sa-wording-name">{i + 1} · {o.name}</span>
                    {chosen ? <span className="sa-wording-chosen">in use</span> : null}
                  </div>
                  <div className="sa-wording-headline">{o.headline.split('\n').map((l, k) => <span key={k}>{l}</span>)}</div>
                  <div className="sa-wording-line">{o.line}</div>
                  <div className="sa-wording-caption">{o.caption}</div>
                  <div className="sa-wording-actions">
                    <Button variant={chosen ? 'ghost' : 'secondary'} size="sm" disabled={busy !== null || chosen} onClick={() => void pick(set, i)}>
                      {busy === `${set.id}:${i}` ? 'Applying…' : chosen ? 'Chosen' : 'Use this'}
                    </Button>
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
