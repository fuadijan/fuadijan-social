import { useId, useMemo, useState } from 'react';
import { fileUrl, getCreateOptions, getWordings, previewDesign, remakeDesign, savePostParts, switchPostKind } from '../api';
import { Button, Card } from './fj';
import { EMPTY_DETAILS, LookStep, PARTS, PartStep, PartsSummary, PreviewImages, Sketch, choicesFor, detailsOut, lookSummary, partDef, startValue, type BuildKind, type Look, type PartChoice, type PartKey, type PartValue, type PartValues } from './PostBuilder';
import type { DayResponse, PostPartField, PreviewResponse } from '../types';
import { useApi } from '../useApi';

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const FIELD: Record<PartKey, PostPartField> = {
  label: 'canva_subheading', title: 'canva_headline', line: 'hook', cover: 'reel_cover_text', onscreen: 'on_screen_text', caption: 'caption', cta: 'cta', hashtags: 'hashtags',
};

/** Only a photo post or a reel is built part by part; a carousel and a review keep the full page. */
export function canBuild(d: DayResponse): boolean {
  return d.slot !== 'carousel' && !/review/.test(d.template);
}

/** The look a day starts from: its custom style (or the art director's choice) and the look details it has. */
function startLook(d: DayResponse): Look {
  return { style: d.row.invite?.style ?? d.row.custom?.style ?? 'auto', invite: d.row.invite ?? EMPTY_DETAILS };
}

const sameLook = (a: Look, b: Look) => a.style === b.style && JSON.stringify(detailsOut(a)) === JSON.stringify(detailsOut(b));

/** A note for the art director when the design is made again: anything to change. */
function NoteField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div>
      <label className="sa-eyebrow" htmlFor={id}>Anything to change in the design? (optional)</label>
      <input id={id} className="sa-input" placeholder="e.g. words at the top, bigger title" maxLength={300} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * Make the design again from the words it has now: a fresh art director and critic, a look to ask for (with the
 * invite's date, time and message), and a note about anything to change.
 */
export function RemakeDesign({ d, reload, onRebuild }: { d: DayResponse; reload: () => Promise<void>; onRebuild: () => void }) {
  const options = useApi(getCreateOptions, 'create-options');
  const [look, setLook] = useState<Look>(() => startLook(d));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
  if (!d.pack) return null;
  async function remake() {
    setBusy(true);
    setResult(null);
    try {
      const r = await remakeDesign(d.dayNo, look.style, note, detailsOut(look));
      setResult({ text: r.message });
      setNote('');
      onRebuild();
      await reload();
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sa-field">
      <div className="sa-eyebrow">Make the design again</div>
      <div className="sa-note" style={{ marginBottom: 8 }}>Same words and photo, designed afresh. Pick a look, and say what to change if you like.</div>
      <LookStep n="✦" styles={options.data?.styles ?? []} value={look} onChange={setLook} postDate={d.date} title={d.row.content?.canva_headline ?? undefined} />
      <div style={{ marginTop: 10 }}><NoteField value={note} onChange={setNote} disabled={busy} /></div>
      <div className="sa-actions sa-editor-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void remake()}>{busy ? 'Starting…' : 'Make the design again'}</Button>
      </div>
      {result ? <div className={`sa-result${result.error ? ' sa-result--error' : ''}`} role="status">{result.text}</div> : null}
    </div>
  );
}

/**
 * A reel with no video made a post, or a post made a reel: same day, date, campaign and words. When the design was
 * already made, it is made again in the new shape.
 */
function KindSwitch({ d, reload, onRebuild }: { d: DayResponse; reload: () => Promise<void>; onRebuild: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
  if (d.status === 'posted') return null;
  const toPost = d.slot === 'reel';
  async function flip() {
    const ask = toPost
      ? `Make Day ${d.dayNo} a post instead of a reel? It keeps its date, campaign and words, and needs a photo instead of clips.`
      : `Make Day ${d.dayNo} a reel instead of a post? It keeps its date, campaign and words, and needs clips and a cover photo.`;
    if (!window.confirm(ask)) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await switchPostKind(d.dayNo, toPost ? 'feed' : 'reel');
      setResult({ text: r.message });
      if (r.rebuilding) onRebuild();
      await reload();
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
      setBusy(false);
    }
  }
  return (
    <div className="sa-kind-switch">
      <span className="sa-muted">{toPost ? 'No video for this reel?' : 'Got video for this one?'}</span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void flip()}>{busy ? 'Switching…' : toPost ? 'Make it a post instead' : 'Make it a reel instead'}</Button>
      {result ? <div className={`sa-result${result.error ? ' sa-result--error' : ''}`} role="status">{result.text}</div> : null}
    </div>
  );
}

/** What the post says now, part by part. */
function currentWords(d: DayResponse): Record<PartKey, string> {
  const content = d.row.content ?? {};
  const set = d.wording[0];
  const opt = set ? set.options[set.chosen ?? 0] : undefined;
  return {
    label: content.canva_subheading?.trim() || d.series,
    title: opt?.headline || content.canva_headline?.trim() || d.dish || '',
    line: opt?.line || content.hook?.trim() || '',
    cover: content.reel_cover_text?.trim() || d.row.custom?.hook || d.platforms?.reel_cover || '',
    onscreen: (d.row.on_screen_text ?? '').split(/\s*→\s*|\n/).map((l) => l.trim()).filter(Boolean).join('\n'),
    caption: d.pack?.caption || opt?.caption || d.row.caption || '',
    cta: d.pack?.cta || d.row.cta || '',
    hashtags: d.pack?.hashtags.join(' ') || d.row.hashtags || '',
  };
}

/**
 * A day's post, built the same way as a new design: each part numbered on the sketch, its words picked from the
 * post's own (the calendar's, the writer's) and the ones that belong to its product and series, and changed if
 * needed; then the look. Saving changes only what changed, and the design is made again once. With nothing
 * changed, the last step can still make the design again, with a note for the art director.
 */
export function DayBuilder({ d, reload, onRebuild }: { d: DayResponse; reload: () => Promise<void>; onRebuild: () => void }) {
  const bank = useApi(getWordings, 'day-wordings');
  const options = useApi(getCreateOptions, 'create-options');
  const kind: BuildKind = d.slot === 'reel' ? 'reel' : 'post';
  const parts = PARTS[kind];
  const now = useMemo(() => currentWords(d), [d]);
  const lookNow = useMemo(() => startLook(d), [d]);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<PartValues>({});
  const [look, setLook] = useState<Look>(lookNow);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);

  const defs = useMemo(() => {
    const product = (d.dish ?? '').split(',')[0]!.trim();
    const p = options.data?.products.find((x) => key(x.name) === key(product));
    const group = [p?.category, p?.series].filter(Boolean).join(' | ');
    const extra: Partial<Record<PartKey, PartChoice[]>> = {};
    const add = (k: PartKey, text: string | null | undefined, from: string, id: string) => { if (text?.trim()) (extra[k] ??= []).push({ id, text, from }); };
    for (const k of parts) add(k, now[k], 'Now on this post', `now:${k}`);
    add('label', d.series, 'The series', 'series');
    const content = d.row.content ?? {};
    add('title', content.canva_headline, 'From the calendar', 'cal:title');
    add('line', content.hook, 'From the calendar', 'cal:line');
    add('cover', content.reel_cover_text, 'From the calendar', 'cal:cover');
    add('caption', d.row.caption, 'From the calendar', 'cal:caption');
    d.wording.forEach((set, si) => set.options.forEach((o, i) => {
      const from = si === 0 ? 'Written for this post' : 'Written earlier for this post';
      add('title', o.headline, from, `opt:${set.id}:${i}:t`);
      add('line', o.line, from, `opt:${set.id}:${i}:l`);
      add('caption', o.caption, from, `opt:${set.id}:${i}:c`);
    }));
    const wordings = bank.data?.reusable.flatMap((w) => w.items.map((i) => ({ ...w, item: i.item, itemKey: i.itemKey }))) ?? [];
    const c = choicesFor({ product, group, series: d.series, bank: wordings, libraries: bank.data?.libraries ?? [], extra, posts: bank.data?.posts ?? [], dayNo: d.dayNo });
    return Object.fromEntries(parts.map((k) => [k, partDef(k, c[k])])) as Record<PartKey, ReturnType<typeof partDef>>;
  }, [d, now, bank.data, options.data, parts]);

  const styles = options.data?.styles ?? [];
  // A part this kind of post does not have (a feed post's cover text) keeps what the post says.
  const valueOf = (k: PartKey): PartValue => values[k] ?? (defs[k] ? startValue(defs[k], now[k]) : { pick: 'own', text: now[k] });
  const allValues = Object.fromEntries(parts.map((k) => [k, valueOf(k)])) as PartValues;
  // Only what the owner touched counts: an empty part shows its first choice on the sketch without being saved.
  const changedParts = parts.filter((k) => values[k] !== undefined && key(values[k]!.text) !== key(now[k]));
  const lookChanged = !sameLook(look, lookNow);
  const changes = [...changedParts.map((k) => defs[k].name.toLowerCase()), ...(lookChanged ? ['the look'] : [])];
  const series = options.data?.templates.find((t) => t.label === d.series);
  const footer = series?.footer === 'address' ? d.settings.storeAddress ?? '' : d.settings.brandLine ?? '';
  const photo = d.assets.find((a) => a.kind !== 'video' && a.kind !== 'text' && a.crops?.['4x5']);
  const pickedId = d.row.design_photos?.[0]?.assetId;
  const shownPhoto = d.assets.find((a) => a.id === pickedId) ?? photo;
  const photoUrl = shownPhoto?.thumb ? fileUrl(shownPhoto.thumb) : null;
  const lookStep = parts.length;
  const STEPS = [...parts.map((k) => defs[k].name), 'Look', 'Check and save'];
  const last = step === STEPS.length - 1;
  const active = step < parts.length ? parts[step]! : null;
  const missing = parts.filter((k) => defs[k].required && !valueOf(k).text.trim());
  const styleName = look.style === 'auto' ? undefined : styles.find((s) => s.key === look.style)?.name;

  function setPart(k: PartKey, v: PartValue) {
    setValues((all) => ({ ...all, [k]: v }));
    setPreview(null);
    setResult(null);
  }

  /** The real preview, on the post's photo or on a blank one (to see where the words sit). */
  async function showPreview(blank = false) {
    setBusy('preview');
    setResult(null);
    try {
      setPreview(await previewDesign({
        template: d.template, kind, label: valueOf('label').text, headline: valueOf('title').text.trim() || d.dish || d.series, line: valueOf('line').text,
        hook: valueOf('cover').text, style: look.style, dish: d.dish, date: d.date, photo: blank ? { blank: true } : { dayNo: d.dayNo }, invite: detailsOut(look),
      }));
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Saves what changed and, when the design changes, makes it again once; with nothing changed, just makes it again. */
  async function save() {
    setBusy('save');
    setResult(null);
    try {
      let r;
      if (!changes.length) {
        r = await remakeDesign(d.dayNo, look.style, note);
      } else {
        const out: Partial<Record<PostPartField, string | null>> = {};
        for (const k of changedParts) {
          const text = valueOf(k).text.trim();
          out[FIELD[k]] = k === 'onscreen' ? text.split('\n').map((l) => l.trim()).filter(Boolean).join(' → ') : text;
        }
        const withLook = lookChanged || note.trim() ? { style: look.style, invite: detailsOut(look), ...(note.trim() ? { note: note.trim() } : {}) } : undefined;
        r = await savePostParts(d.dayNo, out, withLook);
      }
      setResult({ text: r.message });
      setValues({});
      setNote('');
      if (r.rebuilding) onRebuild();
      await reload();
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  const saveLabel = busy === 'save' ? 'Saving…' : !changes.length ? 'Make the design again' : d.pack ? 'Save and make the design again' : 'Save';
  const sketch = <Sketch kind={kind} parts={parts} values={allValues} active={active} photoUrl={photoUrl} footer={footer} look={look} lookName={styleName} postDate={d.date} />;
  return (
    <Card title={kind === 'reel' ? 'The reel, part by part' : 'The post, part by part'} id="build">
      {d.slot === 'reel' || d.slot === 'feed' ? <KindSwitch key={d.slot} d={d} reload={reload} onRebuild={onRebuild} /> : null}
      <div className="sa-note" style={{ marginBottom: 10 }}>Each number on the sketch is one step. Pick the words from the list, change them if you like, choose the look, then save. Only what you change is saved, and the design is made again with it.</div>
      <div className="sa-wizard-steps" role="list" aria-label="Parts">
        {STEPS.map((name, i) => {
          const k = parts[i];
          const edited = k ? changedParts.includes(k) : i === lookStep && lookChanged;
          return (
            <button key={name} type="button" role="listitem" className={`sa-wizard-step${i === step ? ' sa-wizard-step--on' : ''}${edited ? ' sa-wizard-step--done' : ''}`} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
              <b className="fj-numeric">{i <= lookStep ? i + 1 : '✓'}</b> {name}{edited ? ' ·' : ''}
            </button>
          );
        })}
      </div>
      <div className="sa-builder">
        <div>
          {active ? (
            <PartStep key={`${d.dayNo}-${active}`} n={step + 1} def={defs[active]} value={valueOf(active)} onChange={(v) => setPart(active, v)} />
          ) : step === lookStep ? (
            <LookStep n={lookStep + 1} styles={styles} value={look} onChange={(v) => { setLook(v); setPreview(null); setResult(null); }} postDate={d.date} title={valueOf('title').text} />
          ) : (
            <>
              <PartsSummary defs={parts.map((k) => defs[k])} values={allValues} onEdit={(k) => setStep(parts.indexOf(k))} />
              <div className="sa-field" style={{ marginTop: 10 }}>
                <div className="sa-eyebrow">Look</div>
                <div className="sa-part-words">{lookSummary(look, styleName, d.date)}</div>
                <Button variant="ghost" size="sm" onClick={() => setStep(lookStep)}>Change</Button>
              </div>
              <div className="sa-note" style={{ marginTop: 10 }}>{changes.length ? `You changed ${changes.join(', ')}.` : d.pack ? 'Nothing changed. You can still make the design again, with a note for the art director.' : 'Nothing changed yet.'}</div>
              {missing.length ? <div className="sa-result sa-result--error">{missing.map((k) => defs[k].name).join(' and ')} cannot be empty.</div> : null}
              {d.pack ? <div style={{ marginTop: 10 }}><NoteField value={note} onChange={setNote} disabled={busy !== null} /></div> : null}
              <div className="sa-field" style={{ marginTop: 12 }}>
                <div className="sa-eyebrow">See it before it is made</div>
                <div className="sa-actions">
                  <Button variant="secondary" size="sm" disabled={busy !== null || !photo} onClick={() => void showPreview()}>{busy === 'preview' ? 'Drawing…' : 'Preview on the photo'}</Button>
                  <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void showPreview(true)}>Preview on a blank photo</Button>
                </div>
                {photo ? null : <div className="sa-note" style={{ marginTop: 6 }}>No photo yet: the blank preview shows where the words will sit.</div>}
                {preview ? <div style={{ marginTop: 10 }}><PreviewImages images={preview.images} note={preview.note} /></div> : null}
              </div>
            </>
          )}
          <div className="sa-wizard-actions" style={{ marginTop: 12 }}>
            <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>‹ Back</Button>
            {last ? (
              <Button variant="primary" size="sm" disabled={busy !== null || missing.length > 0 || (!changes.length && !d.pack)} onClick={() => void save()}>{saveLabel}</Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setStep(step + 1)}>Next ›</Button>
            )}
          </div>
          {result ? <div className={`sa-result${result.error ? ' sa-result--error' : ''}`} role="status">{result.text}</div> : null}
        </div>
        <div className="sa-builder-sketch">{sketch}</div>
      </div>
    </Card>
  );
}
