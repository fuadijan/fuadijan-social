import { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createCustom, fileUrl, getCreateOptions, getWordings, uploadToDay } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { ErrorCard, Loading } from '../components/States';
import { fmtDate } from '../format';
import type { CreateOptions, CustomFormat, StyleKey, Wording, WordingInput } from '../types';
import { useApi } from '../useApi';

const STEPS = ['Product', 'Series', 'Wording', 'Style', 'Output', 'Photo'] as const;
const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

type WordingChoice = { kind: 'bank'; w: Wording } | { kind: 'own'; w: WordingInput } | { kind: 'agent' };
type PhotoChoice = { kind: 'asset'; assetId: number; thumb: string | null; label: string } | { kind: 'files'; files: File[] };

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A selectable card; a button so it works from the keyboard and reads as a radio to a screen reader. */
function Option({ on, onPick, title, sub, children }: { on: boolean; onPick: () => void; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <li>
      <button type="button" className={`sa-option${on ? ' sa-option--on' : ''}`} onClick={onPick} role="radio" aria-checked={on}>
        <span className="sa-option-title">{title}</span>
        {sub ? <span className="sa-option-sub">{sub}</span> : null}
        {children}
      </button>
    </li>
  );
}

function ProductStep({ opts, value, onChange }: { opts: CreateOptions; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const id = useId();
  const shown = useMemo(() => {
    const k = key(q);
    const list = k ? opts.products.filter((p) => key(p.name).includes(k)) : opts.products;
    return list.slice(0, 40);
  }, [opts.products, q]);
  const exact = shown.some((p) => key(p.name) === key(q));
  return (
    <Card title="1 · Which product?">
      <label className="sa-eyebrow" htmlFor={id}>Search the menu, or type a name</label>
      <input id={id} className="sa-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chicken Karahi" autoComplete="off" />
      <div className="sa-chips" style={{ marginTop: 10 }} role="radiogroup" aria-label="Products">
        {shown.map((p) => (
          <button key={p.name} type="button" className={`sa-chip${key(value) === key(p.name) ? ' sa-chip--on' : ''}`} onClick={() => { onChange(p.name); setQ(p.name); }} role="radio" aria-checked={key(value) === key(p.name)}>
            {p.name}{p.wordings ? <span className="sa-chip-n">{p.wordings}</span> : null}
          </button>
        ))}
        {q.trim() && !exact ? (
          <button type="button" className={`sa-chip${key(value) === key(q) ? ' sa-chip--on' : ''}`} onClick={() => onChange(q.trim())}>Use “{q.trim()}”</button>
        ) : null}
      </div>
      <div className="sa-note" style={{ marginTop: 8 }}>The number is how many wordings the bank has for it. Not on the menu? Type the name; the agent still checks the menu before claiming anything.</div>
    </Card>
  );
}

function SeriesStep({ opts, value, suggested, onChange }: { opts: CreateOptions; value: string; suggested?: string; onChange: (v: string) => void }) {
  const styleName = (k: StyleKey | null) => opts.styles.find((s) => s.key === k)?.name;
  return (
    <Card title="2 · Which series?">
      <div className="sa-note" style={{ marginBottom: 10 }}>The series sets the small label over the headline and the footer. Some prefer a style; you choose the style next anyway.</div>
      <ul className="sa-options" role="radiogroup" aria-label="Series">
        {opts.templates.map((t) => (
          <Option key={t.template} on={value === t.template} onPick={() => onChange(t.template)} title={t.label}
            sub={[t.template, t.footer === 'address' ? 'address in the footer' : 'brand line in the footer', t.style ? `prefers ${styleName(t.style)}` : null, t.template === suggested ? 'suggested for this product' : null].filter(Boolean).join(' · ')} />
        ))}
      </ul>
    </Card>
  );
}

function WordingStep({ product, bank, value, onChange }: { product: string; bank: Wording[]; value: WordingChoice | null; onChange: (v: WordingChoice) => void }) {
  const mine = bank.filter((w) => w.itemKey !== 'all' && (key(w.item) === key(product) || key(product).includes(w.itemKey) || w.itemKey.includes(key(product))));
  const house = bank.filter((w) => w.itemKey === 'all');
  // The title starts as the product's name; the owner's words are the line under it (the title can still be changed).
  const own: WordingInput = value?.kind === 'own' ? value.w : { headline: product.trim(), line: '', caption: '' };
  const setOwn = (patch: Partial<WordingInput>) => onChange({ kind: 'own', w: { ...own, ...patch } });
  const ids = { h: useId(), l: useId(), c: useId() };
  const card = (w: Wording) => (
    <Option key={w.id} on={value?.kind === 'bank' && value.w.id === w.id} onPick={() => onChange({ kind: 'bank', w })} title={w.headline.replace('\n', ' / ')} sub={w.line ?? undefined}>
      {w.caption ? <span className="sa-option-caption">{w.caption}</span> : null}
    </Option>
  );
  return (
    <Card title="3 · Title and writing">
      {mine.length === 0 && house.length === 0 ? <div className="sa-note" style={{ marginBottom: 10 }}>No wordings in the bank for {product} yet. Write one below, or <Link to="/wordings">keep some in Wordings</Link> for next time.</div> : null}
      {mine.length > 0 ? (
        <>
          <div className="sa-eyebrow">For {product}</div>
          <ul className="sa-options" style={{ margin: '6px 0 12px' }}>{mine.map(card)}</ul>
        </>
      ) : null}
      {house.length > 0 ? (
        <>
          <div className="sa-eyebrow">For every post</div>
          <ul className="sa-options" style={{ margin: '6px 0 12px' }}>{house.map(card)}</ul>
        </>
      ) : null}
      <ul className="sa-options">
        <Option on={value?.kind === 'own'} onPick={() => onChange({ kind: 'own', w: own })} title="Write my own" sub="The title is the product's name unless you change it; your line goes under it as typed." />
        <Option on={value?.kind === 'agent'} onPick={() => onChange({ kind: 'agent' })} title="Let the agent write it" sub="It drafts the headline, line and caption from the menu; you pick a wording before the design, as usual." />
      </ul>
      {value?.kind === 'own' ? (
        <div className="sa-form" style={{ marginTop: 12 }}>
          <div>
            <label className="sa-eyebrow" htmlFor={ids.h}>Headline · two short lines</label>
            <textarea id={ids.h} className="sa-textarea" rows={2} value={own.headline} onChange={(e) => setOwn({ headline: e.target.value })} placeholder={'Time to\nSavour the Karahi'} maxLength={60} />
            <div className="sa-note">Enter once for the second line. A short first line (“Time to”, “Fresh from”) becomes the italic lead-in.</div>
          </div>
          <div>
            <label className="sa-eyebrow" htmlFor={ids.l}>Supporting line</label>
            <input id={ids.l} className="sa-input" value={own.line} onChange={(e) => setOwn({ line: e.target.value })} placeholder="Cooked to order, every evening." maxLength={140} />
          </div>
          <div>
            <label className="sa-eyebrow" htmlFor={ids.c}>Caption</label>
            <textarea id={ids.c} className="sa-textarea" rows={3} value={own.caption} onChange={(e) => setOwn({ caption: e.target.value })} placeholder="Optional. Empty means the agent writes the caption around your headline." maxLength={2200} />
          </div>
        </div>
      ) : null}
      {mine.length > 0 || house.length > 0 ? <p className="sa-note" style={{ marginTop: 10 }}><Link to="/wordings">Manage the wordings</Link></p> : null}
    </Card>
  );
}

function StyleStep({ opts, template, value, onChange }: { opts: CreateOptions; template: string; value: StyleKey | 'auto'; onChange: (v: StyleKey | 'auto') => void }) {
  const preferred = opts.templates.find((t) => t.template === template)?.style ?? null;
  const preferredName = opts.styles.find((s) => s.key === preferred)?.name;
  return (
    <Card title="4 · Which style?">
      <ul className="sa-options" role="radiogroup" aria-label="Style">
        <Option on={value === 'auto'} onPick={() => onChange('auto')} title="Let the art director choose"
          sub={preferredName ? `It reads the photo; this series leans to ${preferredName}.` : 'It reads the photo and picks the style that suits it.'} />
        {opts.styles.map((s) => (
          <Option key={s.key} on={value === s.key} onPick={() => onChange(s.key)} title={s.name} sub={s.blurb} />
        ))}
      </ul>
      <div className="sa-note" style={{ marginTop: 8 }}>A chosen style is locked, like a /redo note. Poster and Flat need a clean cut-out of the plate; when the photo cannot give one, the design falls back to Band.</div>
    </Card>
  );
}

function OutputStep({ opts, formats, date, time, onFormats, onDate, onTime }: { opts: CreateOptions; formats: CustomFormat[]; date: string; time: string; onFormats: (f: CustomFormat[]) => void; onDate: (d: string) => void; onTime: (t: string) => void }) {
  const toggle = (f: CustomFormat) => onFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);
  const ids = { d: useId(), t: useId() };
  return (
    <Card title="5 · Feed, story, and when">
      <div className="sa-eyebrow">Make</div>
      <div className="sa-row" style={{ margin: '6px 0 12px' }}>
        <label className="sa-check"><input type="checkbox" checked={formats.includes('feed')} onChange={() => toggle('feed')} /> Feed post · 4:5</label>
        <label className="sa-check"><input type="checkbox" checked={formats.includes('story')} onChange={() => toggle('story')} /> Story · 9:16</label>
      </div>
      <div className="sa-two">
        <div>
          <label className="sa-eyebrow" htmlFor={ids.d}>Post on</label>
          <input id={ids.d} className="sa-input" type="date" value={date} min={opts.today} onChange={(e) => onDate(e.target.value)} />
          <div className="sa-note">It joins the calendar on that day, so the reminders and the pack arrive like any other post.</div>
        </div>
        <div>
          <label className="sa-eyebrow" htmlFor={ids.t}>Post at</label>
          <input id={ids.t} className="sa-input" type="time" value={time} onChange={(e) => onTime(e.target.value)} />
          <div className="sa-note">Sydney time. Empty means the default, {opts.postTimeDefault}.</div>
        </div>
      </div>
      <div className="sa-note" style={{ marginTop: 10 }}>Split, Poster and Flat make a story in their own style; Band and Invite use the house story. Carousels and reels still come from the monthly plan.</div>
    </Card>
  );
}

function fmtSize(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PhotoStep({ opts, product, value, onChange }: { opts: CreateOptions; product: string; value: PhotoChoice | null; onChange: (v: PhotoChoice | null) => void }) {
  const id = useId();
  const files = value?.kind === 'files' ? value.files : [];
  const k = key(product);
  // The product's own photos first, then the rest, newest first within each.
  const photos = [...opts.photos].sort((a, b) => Number(key(b.dish ?? b.caption ?? '').includes(k)) - Number(key(a.dish ?? a.caption ?? '').includes(k)));
  const tooBig = files.filter((f) => f.size > MAX_BYTES);
  return (
    <Card title="6 · The photo">
      <div className="sa-upload-row">
        <label className={`${buttonClass('secondary', 'sm')} sa-upload-pick`} htmlFor={id}>{files.length ? 'Change photos' : 'Choose a photo'}</label>
        <input id={id} className="sa-visually-hidden" type="file" accept="image/*" multiple onChange={(e) => onChange(e.target.files?.length ? { kind: 'files', files: Array.from(e.target.files) } : null)} />
        {files.length > 0 ? <span className="sa-muted">{files.length === 1 ? files[0]!.name : `${files.length} photos · the first is the hero`}</span> : null}
      </div>
      {files.length > MAX_FILES ? <div className="sa-result sa-result--error">Up to {MAX_FILES} photos.</div> : null}
      {tooBig.length > 0 ? <div className="sa-result sa-result--error">Each photo must be under 25 MB ({tooBig.map((f) => `${f.name} ${fmtSize(f.size)}`).join(', ')}).</div> : null}
      {photos.length > 0 ? (
        <>
          <div className="sa-eyebrow" style={{ margin: '14px 0 6px' }}>Or one already received</div>
          <div className="sa-photos" role="radiogroup" aria-label="Photos already received">
            {photos.map((p) => {
              const label = p.dish ?? p.caption ?? `photo ${p.assetId}`;
              const on = value?.kind === 'asset' && value.assetId === p.assetId;
              return (
                <button key={p.assetId} type="button" className={`sa-photo${on ? ' sa-photo--on' : ''}`} role="radio" aria-checked={on} aria-label={`${label}${p.dayNo ? `, Day ${p.dayNo}` : ''}`}
                  onClick={() => onChange(on ? null : { kind: 'asset', assetId: p.assetId, thumb: p.thumb, label })}>
                  {p.thumb ? <img src={fileUrl(p.thumb)} alt="" loading="lazy" /> : <span className="sa-thumb-kind">{label}</span>}
                  <span className="sa-photo-cap">{p.dayNo ? `Day ${p.dayNo} · ` : ''}{label}</span>
                </button>
              );
            })}
          </div>
          <div className="sa-note" style={{ marginTop: 8 }}>A photo used again keeps its crops and plate cut-out, so the design is quicker.</div>
        </>
      ) : null}
    </Card>
  );
}

/**
 * The Create flow: product → series → wording → style → output → photo → generate. The result is a custom post on
 * the calendar (numbered from 101), made by the same pipeline as the monthly plan, so it lands on the Day page
 * and in Telegram like any other.
 */
export function Create() {
  const navigate = useNavigate();
  const options = useApi(getCreateOptions, 'create-options');
  const bank = useApi(getWordings, 'create-wordings');
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState('');
  const [template, setTemplate] = useState('');
  const [wording, setWording] = useState<WordingChoice | null>(null);
  const [style, setStyle] = useState<StyleKey | 'auto'>('auto');
  const [formats, setFormats] = useState<CustomFormat[]>(['feed', 'story']);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const opts = options.data;
  if (options.error && !opts) return <><PageHeader title="New design" /><ErrorCard message={options.error} onRetry={() => void options.reload()} /></>;
  if (!opts) return <><PageHeader title="New design" /><Loading what="Getting the menu and the wordings" /></>;
  const wordings = bank.data?.groups.flatMap((g) => g.wordings) ?? [];
  const theDate = date || opts.today;

  const ownOk = wording?.kind !== 'own' || wording.w.headline.trim().length > 0;
  const filesOk = photo?.kind !== 'files' || (photo.files.length > 0 && photo.files.length <= MAX_FILES && photo.files.every((f) => f.size <= MAX_BYTES));
  const ready: boolean[] = [product.trim().length > 0, template.length > 0, wording !== null && ownOk, true, formats.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(theDate), photo !== null && filesOk];
  const canGenerate = ready.every(Boolean);
  const styleName = style === 'auto' ? 'art director’s choice' : opts.styles.find((s) => s.key === style)?.name ?? style;
  const seriesLabel = opts.templates.find((t) => t.template === template)?.label ?? '';
  const suggestionFor = (name: string) => opts.products.find((p) => key(p.name) === key(name))?.template ?? '';
  // Picking a product suggests its series (a drink pours, a sweet saves room); a series you chose yourself stays.
  function pickProduct(name: string) {
    const previous = suggestionFor(product);
    setProduct(name);
    const next = suggestionFor(name);
    if (next && (!template || template === previous)) setTemplate(next);
  }

  async function generate() {
    if (!canGenerate || !photo) return;
    setError(null);
    setBusy('Making the post…');
    try {
      // A bank wording goes on the line under the product's name (its own line follows); own words go as typed.
      const bankLine = (w: Wording) => { const flat = w.headline.replace(/\s*\n\s*/g, ' ').trim(); const extra = (w.line ?? '').trim(); return extra && !flat.toLowerCase().includes(extra.toLowerCase()) ? `${flat} ${extra}`.slice(0, 140) : flat; };
      const w: WordingInput | null = wording?.kind === 'bank' ? { headline: product.trim(), line: bankLine(wording.w), caption: wording.w.caption ?? '' } : wording?.kind === 'own' ? wording.w : null;
      const r = await createCustom({
        product: product.trim(), template, style, formats, wording: w, sloganId: wording?.kind === 'bank' ? wording.w.id : null,
        date: theDate, postTime: time || null, assetId: photo.kind === 'asset' ? photo.assetId : null,
      });
      if (photo.kind === 'files') {
        setBusy(photo.files.length > 1 ? `Uploading ${photo.files.length} photos…` : 'Uploading the photo…');
        await uploadToDay(r.dayNo, photo.files, `${product.trim().toLowerCase()} #day${r.dayNo}`);
      }
      navigate(`/day/${r.dayNo}`, { state: { generating: true } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const last = step === STEPS.length - 1;
  return (
    <>
      <PageHeader title="New design" subtitle="A one-off post: pick the product, the words, the style and the photo; the agent makes the design and the pack" />
      <div className="sa-wizard-steps" role="list" aria-label="Steps">
        {STEPS.map((name, i) => {
          const done = i < step && ready[i];
          return (
            <button key={name} type="button" role="listitem" className={`sa-wizard-step${i === step ? ' sa-wizard-step--on' : ''}${done ? ' sa-wizard-step--done' : ''}`} disabled={i > step && !ready.slice(0, i).every(Boolean)} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
              <b className="fj-numeric">{i + 1}</b> {name}
            </button>
          );
        })}
      </div>
      <div className="sa-stack">
        {step === 0 ? <ProductStep opts={opts} value={product} onChange={(v) => { pickProduct(v); if (wording?.kind === 'bank') setWording(null); }} /> : null}
        {step === 1 ? <SeriesStep opts={opts} value={template} suggested={suggestionFor(product)} onChange={setTemplate} /> : null}
        {step === 2 ? <WordingStep product={product} bank={wordings} value={wording} onChange={setWording} /> : null}
        {step === 3 ? <StyleStep opts={opts} template={template} value={style} onChange={setStyle} /> : null}
        {step === 4 ? <OutputStep opts={opts} formats={formats} date={theDate} time={time} onFormats={setFormats} onDate={setDate} onTime={setTime} /> : null}
        {step === 5 ? (
          <>
            <PhotoStep opts={opts} product={product} value={photo} onChange={setPhoto} />
            <Card title="Ready?">
              <dl className="sa-summary">
                <dt>Product</dt><dd>{product}</dd>
                <dt>Series</dt><dd>{seriesLabel}</dd>
                <dt>Wording</dt><dd>{wording?.kind === 'agent' ? 'the agent writes it; you pick before the design' : wording?.kind === 'bank' ? `${product.trim()} — ${wording.w.headline.replace('\n', ' ')}` : wording ? `${wording.w.headline.replace('\n', ' / ')}${wording.w.line ? ` — ${wording.w.line}` : ''}` : '—'}</dd>
                <dt>Style</dt><dd>{styleName}</dd>
                <dt>Make</dt><dd>{formats.map((f) => (f === 'feed' ? 'Feed 4:5' : 'Story 9:16')).join(' + ')} · {fmtDate(theDate)}{time ? ` at ${time}` : ''}</dd>
                <dt>Photo</dt><dd>{photo?.kind === 'files' ? photo.files.map((f) => f.name).join(', ') : photo?.kind === 'asset' ? `already received · ${photo.label}` : '—'}</dd>
              </dl>
              {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
              <div className="sa-note" style={{ marginTop: 10 }}>About a minute: the photo is read, the design directed and checked, the caption and hashtags written. The result lands on the day's page here and in Telegram.</div>
            </Card>
          </>
        ) : null}
        <div className="sa-wizard-actions">
          <Button variant="ghost" disabled={step === 0 || busy !== null} onClick={() => setStep(step - 1)}>‹ Back</Button>
          {last ? (
            <Button variant="primary" disabled={!canGenerate || busy !== null} onClick={() => void generate()}>{busy ?? 'Generate the design'}</Button>
          ) : (
            <Button variant="primary" disabled={!ready[step]} onClick={() => setStep(step + 1)}>Next ›</Button>
          )}
        </div>
      </div>
    </>
  );
}
