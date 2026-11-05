import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { patchRow } from '../api';
import { Button } from './fj';
import { CopyButton } from './CopyButton';
import type { EditableField } from '../types';

/** Editing one of these changes the copy, so the editor offers to rebuild the pack (PATCH `redo: true`). */
export const REBUILD_FIELDS: ReadonlySet<EditableField> = new Set<EditableField>(['caption', 'cta', 'hashtags', 'story_ideas', 'on_screen_text']);

/** Field names as the owner reads them (the History card uses them too). */
export const FIELD_LABEL: Record<string, string> = {
  dish: 'Dish', theme: 'Theme', objective: 'Objective', creative_instructions: 'Creative instructions', on_screen_text: 'On-screen text',
  caption: 'Caption', cta: 'CTA', hashtags: 'Hashtags', story_ideas: 'Story ideas', confirmation_notes: 'Confirmation notes',
  post_time: 'Post time', status: 'Status', date: 'Date', design_photos: 'Photos in the design',
  'content.alt_text': 'Alt text', 'content.story_text': 'Story text', 'content.facebook_caption': 'Facebook caption', 'content.facebook_cta': 'Facebook CTA', 'content.facebook_hashtags': 'Facebook hashtags',
  'content.tiktok_opening': 'TikTok opening text', 'content.tiktok_hook': 'TikTok hook', 'content.tiktok_script': 'TikTok script', 'content.tiktok_caption': 'TikTok caption', 'content.tiktok_cta': 'TikTok CTA', 'content.tiktok_hashtags': 'TikTok hashtags',
  'content.story_sequence': 'Story sequence', 'content.reel_cover_text': 'Reel cover', 'content.canva_headline': 'Headline on the design', 'content.canva_subheading': 'Label on the design', 'content.hook': 'Line on the design',
};

interface Props {
  dayNo: number;
  /** A row column, saved through PATCH /api/rows/:dayNo; leave it out when `save` does the saving. */
  field?: EditableField;
  /** Saves the text its own way, instead of PATCHing the row column. */
  save?: (value: string) => Promise<unknown>;
  label: string;
  /** The row's stored text, which is what the editor starts from and what Save replaces. */
  value: string | null | undefined;
  /** What to show when not editing; defaults to the stored text. */
  children?: ReactNode;
  /** Shows a Copy button for this text next to Edit. */
  copyText?: string | null;
  kind?: 'textarea' | 'input' | 'time';
  /** A line under the editor: the field's convention. */
  hint?: string;
  placeholder?: string;
  bodyClassName?: string;
  /** Called after a successful save; the caller refetches the day so the new text and the History card update. */
  onSaved: () => void | Promise<void>;
}

/**
 * A row field with its Edit affordance. Editing swaps the text for an input with Save / Cancel; a save goes through
 * PATCH /api/rows/:dayNo, which also records the edit in the history. Errors from the server show inline.
 */
export function EditableText({ dayNo, field, save: saveWith, label, value, children, copyText, kind = 'textarea', hint, placeholder, bodyClassName, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [rebuild, setRebuild] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const inputId = useId();

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A different day: drop any half-finished edit.
  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [dayNo]);

  const stored = value?.trim() ?? '';
  const offersRebuild = Boolean(field && REBUILD_FIELDS.has(field));

  function start() {
    setDraft(kind === 'time' ? stored.slice(0, 5) : stored);
    setRebuild(true);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (saveWith) await saveWith(draft.trim());
      else await patchRow(dayNo, field!, draft.trim(), offersRebuild && rebuild);
      setEditing(false);
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), 2200);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = Math.min(12, Math.max(3, draft.split('\n').length + 1));

  return (
    <div className="sa-field">
      <div className="sa-field-head">
        <label className="sa-eyebrow" htmlFor={editing ? inputId : undefined}>{label}</label>
        <span className="sa-field-tools">
          {saved ? <span className="sa-saved" role="status">Saved</span> : null}
          {copyText && !editing ? <CopyButton text={copyText} /> : null}
          {!editing ? <Button variant="secondary" size="sm" onClick={start} aria-label={`Edit ${label}`}>Edit</Button> : null}
        </span>
      </div>
      {editing ? (
        <form
          className="sa-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {kind === 'textarea' ? (
            <textarea id={inputId} className="sa-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={rows} autoFocus disabled={busy} placeholder={placeholder} />
          ) : (
            <input id={inputId} className="sa-input" type={kind === 'time' ? 'time' : 'text'} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus disabled={busy} placeholder={placeholder} />
          )}
          {hint ? <div className="sa-note">{hint}</div> : null}
          {offersRebuild ? (
            <label className="sa-check">
              <input type="checkbox" checked={rebuild} onChange={(e) => setRebuild(e.target.checked)} disabled={busy} />
              <span>Rebuild the pack after saving</span>
            </label>
          ) : null}
          <div className="sa-actions sa-editor-actions">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>Cancel</Button>
            <span className="sa-note">Empty clears the field.</span>
          </div>
          {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
        </form>
      ) : (
        children ?? (
          <div className={`sa-field-body${stored ? '' : ' sa-field-body--muted'}${bodyClassName ? ` ${bodyClassName}` : ''}`}>{stored || '—'}</div>
        )
      )}
    </div>
  );
}
