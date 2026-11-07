import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createCustom, fileUrl, getCreateOptions, getWordings, previewDesign, uploadToDay } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { LookStep, PARTS, PartStep, PartsSummary, PreviewImages, Sketch, choicesFor, inviteDay, partDef, photoForPreview, startValue, type BuildKind, type PartDef, type PartKey, type PartValue, type PartValues } from '../components/PostBuilder';
import { ErrorCard, Loading } from '../components/States';
import { fmtDate } from '../format';
import type { CreateOptions, CustomFormat, InviteDetails, PreviewResponse, StyleKey, WordingInput } from '../types';
import { useApi } from '../useApi';

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

type PhotoChoice = { kind: 'asset'; assetId: number; thumb: string | null; label: string } | { kind: 'files'; files: File[] };

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function ProductStep({ opts, value, kind, onChange, onKind }: { opts: CreateOptions; value: string; kind: BuildKind; onChange: (v: string) => void; onKind: (k: BuildKind) => void }) {
  const [q, setQ] = useState(value);
  const id = useId();
  const shown = useMemo(() => {
    const k = key(q);
    const list = k ? opts.products.filter((p) => key(p.name).includes(k)) : opts.products;
    return list.slice(0, 40);
  }, [opts.products, q]);
  const exact = shown.some((p) => key(p.name) === key(q));
  return (
    <Card title="What are you making?">
      <div className="sa-kinds" role="radiogroup" aria-label="Post or reel">
        {(['post', 'reel'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`sa-option${kind === k ? ' sa-option--on' : ''}`} onClick={() => onKind(k)}>
            <span className="sa-option-title">{k === 'post' ? 'A post' : 'A reel'}</span>
            <span className="sa-option-sub">{k === 'post' ? 'A photo with your words on it, for the feed and the story.' : 'A cover for your video, the text over it, and the caption. You film and cut the video.'}</span>
          </button>
        ))}
      </div>
      <label className="sa-eyebrow" htmlFor={id} style={{ marginTop: 14, display: 'block' }}>Which product? Search the menu, or type a name</label>
      <input id={id} className="sa-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chicken Karahi" autoComplete="off" />
      <div className="sa-chips" style={{ marginTop: 10 }} role="radiogroup" aria-label="Products">
        {shown.map((p) => (
          <button key={p.name} type="button" className={`sa-chip${key(value) === key(p.name) ? ' sa-chip--on' : ''}`} onClick={() => { onChange(p.name); setQ(p.name); }} role="radio" aria-checked={key(value) === key(p.name)}>
            {p.name}{p.status !== 'active' ? <span className="sa-chip-meta"> · {p.status === 'coming-soon' ? 'coming soon' : p.status}</span> : null}{p.wordings ? <span className="sa-chip-n">{p.wordings}</span> : null}
          </button>
        ))}
        {q.trim() && !exact ? (
          <button type="button" className={`sa-chip${key(value) === key(q) ? ' sa-chip--on' : ''}`} onClick={() => onChange(q.trim())}>Use “{q.trim()}”</button>
        ) : null}
      </div>
      <div className="sa-note" style={{ marginTop: 8 }}>The number is how many saved captions it has. Not listed? Type the name; the agent still checks the menu before claiming anything.</div>
    </Card>
  );
}

function fmtSize(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PhotoStep({ opts, product, kind, value, onChange }: { opts: CreateOptions; product: string; kind: BuildKind; value: PhotoChoice | null; onChange: (v: PhotoChoice | null) => void }) {
  const id = useId();
  const files = value?.kind === 'files' ? value.files : [];
  const k = key(product);
  // The product's own photos first, then the rest, newest first within each.
  const photos = [...opts.photos].sort((a, b) => Number(key(b.dish ?? b.caption ?? '').includes(k)) - Number(key(a.dish ?? a.caption ?? '').includes(k)));
  const tooBig = files.filter((f) => f.size > MAX_BYTES);
  return (
    <Card title={kind === 'reel' ? 'The photo for the cover' : 'The photo'}>
      {kind === 'reel' ? <div className="sa-note" style={{ marginBottom: 10 }}>A still for the reel’s cover. Send the video clips to the bot as usual; they are not edited here.</div> : null}
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
        </>
      ) : null}
    </Card>
  );
}

/**
 * The Create flow, one step at a time: what it is (a post or a reel) and the product, the photo, then each part of
 * the design and of the post, chosen from the words that belong to the product and shown on a numbered sketch, then
 * a real preview on the photo before anything is made. The result is a custom post on the calendar (numbered from
 * 101), made by the same pipeline as the monthly plan, so it lands on the Day page and in Telegram like any other.
 */
export function Create() {
  const navigate = useNavigate();
  const options = useApi(getCreateOptions, 'create-options');
  const bank = useApi(getWordings, 'create-wordings');
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<BuildKind>('post');
  const [product, setProduct] = useState('');
  const [template, setTemplate] = useState('');
  const [values, setValues] = useState<PartValues>({});
  const [photo, setPhoto] = useState<PhotoChoice | null>(null);
  const [style, setStyle] = useState<StyleKey | 'auto'>('auto');
  const [invite, setInvite] = useState<InviteDetails>({ date: null, time: '', message: '' });
  const [formats, setFormats] = useState<CustomFormat[]>(['feed', 'story']);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The sketch shows the chosen photo: one already received by its thumbnail, a new one from the device.
  const newFile = photo?.kind === 'files' ? photo.files[0] ?? null : null;
  const [fileUrlNow, setFileUrlNow] = useState<string | null>(null);
  useEffect(() => {
    if (!newFile) return setFileUrlNow(null);
    const url = URL.createObjectURL(newFile);
    setFileUrlNow(url);
    return () => URL.revokeObjectURL(url);
  }, [newFile]);
  const photoUrl = photo?.kind === 'asset' ? (photo.thumb ? fileUrl(photo.thumb) : null) : fileUrlNow;

  const opts = options.data;
  const chosenProduct = opts?.products.find((p) => key(p.name) === key(product));
  const series = opts?.templates.find((t) => t.template === template);
  const parts = PARTS[kind];
  const defs = useMemo((): Record<PartKey, PartDef> | null => {
    if (!opts) return null;
    const group = [chosenProduct?.category, chosenProduct?.series].filter(Boolean).join(' | ');
    const wordings = bank.data?.reusable.flatMap((w) => w.items.map((i) => ({ ...w, item: i.item, itemKey: i.itemKey }))) ?? [];
    const c = choicesFor({ product, group, series: series?.label ?? '', bank: wordings, libraries: bank.data?.libraries ?? [] });
    // The label is the series' own: picking it picks the series, which also sets the footer and the colours of the words.
    const suggested = chosenProduct?.template ?? '';
    const seriesChoices = [...opts.templates].sort((a, b) => Number(b.template === suggested) - Number(a.template === suggested))
      .map((t) => ({ id: `tpl:${t.template}`, text: t.label, from: t.template === suggested ? 'Suggested for this product' : 'Other series' }));
    const all = {} as Record<PartKey, PartDef>;
    for (const k of Object.keys(c) as PartKey[]) all[k] = partDef(k, k === 'label' ? seriesChoices : c[k], { agent: !['label', 'title', 'cover'].includes(k), editable: k !== 'label', help: k === 'label' ? 'The small gold words at the top. Choosing it chooses the series, which also sets the footer.' : undefined });
    return all;
  }, [opts, bank.data, product, chosenProduct, series?.label]);

  if (options.error && !opts) return <><PageHeader title="New design" /><ErrorCard message={options.error} onRetry={() => void options.reload()} /></>;
  if (!opts || !defs) return <><PageHeader title="New design" /><Loading what="Getting the menu and the captions" /></>;

  const valueOf = (k: PartKey): PartValue => values[k] ?? startValue(defs[k], k === 'label' ? series?.label : null);
  const allValues = Object.fromEntries(parts.map((k) => [k, valueOf(k)])) as PartValues;
  const text = (k: PartKey) => (valueOf(k).pick === 'agent' ? '' : valueOf(k).text.trim());
  const footer = series?.footer === 'address' ? opts.footers.address : opts.footers.brand;
  const theDate = date || opts.today;

  const STEPS = ['What', 'Photo', ...parts.map((k) => defs[k].name), 'Look', 'Check and make'];
  const lookStep = 2 + parts.length;
  const inviteOut = style === 'invite' && (invite.date || invite.time.trim() || invite.message.trim()) ? { ...invite, time: invite.time.trim(), message: invite.message.trim() } : null;
  const styleName = style === 'auto' ? 'art director’s choice' : opts.styles.find((s) => s.key === style)?.name ?? style;
  const partAt = (i: number): PartKey | null => (i >= 2 && i < 2 + parts.length ? parts[i - 2]! : null);
  const active = partAt(step);
  const filesOk = photo?.kind !== 'files' || (photo.files.length > 0 && photo.files.length <= MAX_FILES && photo.files.every((f) => f.size <= MAX_BYTES));
  const partOk = (k: PartKey) => !defs[k].required || text(k).length > 0;
  const ready: boolean[] = [product.trim().length > 0 && template.length > 0, photo !== null && filesOk, ...parts.map(partOk), true, (kind === 'reel' || formats.length > 0) && /^\d{4}-\d{2}-\d{2}$/.test(theDate)];
  const canGenerate = ready.every(Boolean);

  function pickProduct(name: string) {
    const previous = opts!.products.find((p) => key(p.name) === key(product))?.template ?? '';
    const next = opts!.products.find((p) => key(p.name) === key(name))?.template ?? opts!.templates[0]?.template ?? '';
    setProduct(name);
    // Picking a product suggests its series; a series you chose yourself stays. Words picked for another product go.
    if (next && (!template || template === previous)) setTemplate(next);
    setValues((v) => (v.label ? { label: v.label } : {}));
    setPreview(null);
  }
  function setPart(k: PartKey, v: PartValue) {
    if (k === 'label' && v.pick.startsWith('tpl:')) setTemplate(v.pick.slice(4));
    setValues((now) => ({ ...now, [k]: v }));
    setPreview(null);
  }

  /** The words the design will carry, as the server takes them. */
  function request() {
    const sloganOf = (k: PartKey) => { const p = valueOf(k).pick; return /^w\d+$/.test(p) && valueOf(k).text.trim() === defs![k].choices.find((c) => c.id === p)?.text.trim() ? Number(p.slice(1)) : null; };
    const wording: WordingInput = kind === 'reel'
      ? { headline: product.trim(), line: '', caption: text('caption') }
      : { headline: text('title') || product.trim(), line: text('line'), caption: text('caption') };
    const sloganId = kind === 'post' ? sloganOf('title') ?? sloganOf('line') ?? sloganOf('caption') : sloganOf('caption');
    return {
      product: product.trim(), template, style, formats: kind === 'reel' ? ['reel'] as CustomFormat[] : formats, wording, sloganId,
      date: theDate, postTime: time || null, assetId: photo?.kind === 'asset' ? photo.assetId : null,
      cta: text('cta') || null, hashtags: text('hashtags') || null,
      invite: inviteOut,
      hook: kind === 'reel' ? text('cover') : null, onScreen: kind === 'reel' ? text('onscreen').split('\n').map((l) => l.trim()).filter(Boolean) : null,
    };
  }

  async function showPreview() {
    if (!photo) return;
    setError(null);
    setBusy('Drawing the preview…');
    try {
      const p = photo.kind === 'asset' ? { assetId: photo.assetId } : { dataUrl: await photoForPreview(photo.files[0]!) };
      setPreview(await previewDesign({ template, kind, label: '', headline: text('title') || product.trim(), line: text('line'), hook: text('cover'), style, dish: product.trim(), date: theDate, photo: p, invite: inviteOut }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!canGenerate || !photo) return;
    setError(null);
    setBusy(kind === 'reel' ? 'Making the reel’s cover and pack…' : 'Making the post…');
    try {
      const r = await createCustom(request());
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
  const toggle = (f: CustomFormat) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);
  const sketch = <Sketch kind={kind} parts={parts} values={allValues} active={active} photoUrl={photoUrl} footer={footer} look={{ style, invite }} lookName={style === 'auto' ? undefined : styleName} />;
  return (
    <>
      <PageHeader title="New design" subtitle="Step by step: each part of the post is numbered on the sketch, so you see what you will get before it is made" />
      <div className="sa-wizard-steps" role="list" aria-label="Steps">
        {STEPS.map((name, i) => {
          const done = i < step && ready[i];
          return (
            <button key={`${i}-${name}`} type="button" role="listitem" className={`sa-wizard-step${i === step ? ' sa-wizard-step--on' : ''}${done ? ' sa-wizard-step--done' : ''}`} disabled={i > step && !ready.slice(0, i).every(Boolean)} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
              {/* A part's badge is its number on the sketch; the steps around the parts are lettered. */}
              <b className="fj-numeric">{partAt(i) ? parts.indexOf(partAt(i)!) + 1 : i === 0 ? 'a' : i === 1 ? 'b' : i === lookStep ? parts.length + 1 : '✓'}</b> {name}
            </button>
          );
        })}
      </div>
      <div className="sa-stack">
        {step === 0 ? <ProductStep opts={opts} value={product} kind={kind} onChange={pickProduct} onKind={(k) => { setKind(k); setPreview(null); }} /> : null}
        {step === 1 ? <PhotoStep opts={opts} product={product} kind={kind} value={photo} onChange={(p) => { setPhoto(p); setPreview(null); }} /> : null}
        {active ? (
          <div className="sa-builder">
            <Card>
              <PartStep key={`${kind}-${active}-${product}`} n={parts.indexOf(active) + 1} def={defs[active]} value={valueOf(active)} onChange={(v) => setPart(active, v)} />
              {defs[active].choices.length > 0 && active !== 'label' ? <p className="sa-note" style={{ marginTop: 10 }}><Link to="/captions">Manage the saved captions</Link></p> : null}
            </Card>
            <div className="sa-builder-sketch">{sketch}</div>
          </div>
        ) : null}
        {step === lookStep ? (
          <div className="sa-builder">
            <Card>
              <LookStep n={parts.length + 1} styles={opts.styles} value={{ style, invite }} onChange={(v) => { setStyle(v.style); setInvite(v.invite); setPreview(null); }} />
              {style !== 'auto' && opts.styles.find((s) => s.key === style)?.needsCutout ? <div className="sa-note" style={{ marginTop: 10 }}>This style needs the plate cut out of the photo; when the photo cannot give one, the design falls back to Band.</div> : null}
            </Card>
            <div className="sa-builder-sketch">{sketch}</div>
          </div>
        ) : null}
        {last ? (
          <div className="sa-builder">
            <Card title="Check and make">
              <PartsSummary defs={parts.map((k) => defs[k])} values={allValues} onEdit={(k) => setStep(2 + parts.indexOf(k))} />
              <div className="sa-two-col" style={{ marginTop: 14 }}>
                <div>
                  <div className="sa-eyebrow">Look</div>
                  <div className="sa-part-words">{styleName}{style === 'invite' ? ` · ${inviteDay(invite.date) || 'the day it goes up'} · ${invite.message.trim() || 'FROM'} ${invite.time.trim() || 'opening hours'}` : ''}</div>
                  <Button variant="ghost" size="sm" onClick={() => setStep(lookStep)}>Change</Button>
                </div>
                {kind === 'post' ? (
                  <div>
                    <div className="sa-eyebrow">Make</div>
                    <div className="sa-row" style={{ marginTop: 6 }}>
                      <label className="sa-check"><input type="checkbox" checked={formats.includes('feed')} onChange={() => toggle('feed')} /> Feed post · 4:5</label>
                      <label className="sa-check"><input type="checkbox" checked={formats.includes('story')} onChange={() => toggle('story')} /> Story · 9:16</label>
                    </div>
                  </div>
                ) : <div className="sa-note">A reel makes its cover (9:16) and the reel pack: the text over the video, the caption and the shot list.</div>}
                <div>
                  <label className="sa-eyebrow" htmlFor="sa-date">Post on</label>
                  <input id="sa-date" className="sa-input" type="date" value={theDate} min={opts.today} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="sa-eyebrow" htmlFor="sa-time">Post at</label>
                  <input id="sa-time" className="sa-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  <div className="sa-note">Sydney time. Empty means {opts.postTimeDefault}.</div>
                </div>
              </div>
              <div className="sa-field" style={{ marginTop: 14 }}>
                <div className="sa-eyebrow">See it on your photo</div>
                <div className="sa-note" style={{ marginBottom: 8 }}>A real drawing of the design with these words, in about fifteen seconds. Nothing is made or saved.</div>
                <Button variant="secondary" disabled={busy !== null || !photo} onClick={() => void showPreview()}>{busy === 'Drawing the preview…' ? busy : preview ? 'Draw it again' : 'Preview on my photo'}</Button>
                {preview ? <div style={{ marginTop: 10 }}><PreviewImages images={preview.images} note={preview.note} /></div> : null}
              </div>
              {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
              <div className="sa-note" style={{ marginTop: 10 }}>Then about a minute: the design is directed and checked, and anything you left to the agent is written. It lands on the day’s page here and in Telegram, for {fmtDate(theDate)}{time ? ` at ${time}` : ''}.</div>
            </Card>
            <div className="sa-builder-sketch">{sketch}</div>
          </div>
        ) : null}
        <div className="sa-wizard-actions">
          <Button variant="ghost" disabled={step === 0 || busy !== null} onClick={() => setStep(step - 1)}>‹ Back</Button>
          {last ? (
            <Button variant="primary" disabled={!canGenerate || busy !== null} onClick={() => void generate()}>{busy && busy !== 'Drawing the preview…' ? busy : kind === 'reel' ? 'Make the reel cover' : 'Make the design'}</Button>
          ) : (
            <Button variant="primary" disabled={!ready[step]} onClick={() => setStep(step + 1)}>Next ›</Button>
          )}
        </div>
      </div>
    </>
  );
}
