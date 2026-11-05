import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { fileUrl, getDay, markPosted, packTextUrl, pushDay, setDesignPhotos, skipDay } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { CopyButton } from '../components/CopyButton';
import { EditableText, FIELD_LABEL } from '../components/EditableText';
import { Body, PlatformTexts, PostText, type PostEdit } from '../components/PostTexts';
import { QuestionButtons } from '../components/QuestionButtons';
import { ShareButton } from '../components/ShareButton';
import { Empty, ErrorCard, Loading } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { UploadPhotos } from '../components/UploadPhotos';
import { WordingOptions } from '../components/WordingOptions';
import { fmtDate, fmtDateTime, fmtTime, paragraphs, SLOT_LABEL, splitArrows } from '../format';
import type { Asset, DayResponse, EditSource, Pack, Row } from '../types';
import { useApi } from '../useApi';

const FIRST_DAY = 1;
const LAST_DAY = 30;

/** The kit's link, typed for the PageHeader back link. */
const BackLink = ({ href, children, className }: { href: string; children?: ReactNode; className?: string }) => (
  <Link to={href} className={className}>{children}</Link>
);

type Reload = () => Promise<void>;


/** A read-only field (the pack's derived text, which has no row column to edit). */
function Field({ label, value, copy, mono = false, className }: { label: string; value: string | null | undefined; copy?: boolean; mono?: boolean; className?: string }) {
  const text = value?.trim() ?? '';
  return (
    <div className="sa-field">
      <div className="sa-field-head">
        <span className="sa-eyebrow">{label}</span>
        {copy && text ? <CopyButton text={text} /> : null}
      </div>
      <div className={`sa-field-body${text ? '' : ' sa-field-body--muted'}${mono ? ' fj-numeric' : ''}${className ? ` ${className}` : ''}`}>
        {text || '—'}
      </div>
    </div>
  );
}

/** The copy the owner posts: the pack's resolved text when a pack exists, else the sheet's draft. */
function resolvedCopy(row: Row, pack: Pack | null) {
  if (pack) {
    return {
      caption: pack.caption, cta: pack.cta, hashtags: pack.hashtags.join(' '), alt: pack.alt_text,
      facebook: pack.facebook_caption, story: pack.story_text, draft: false,
    };
  }
  return { caption: row.caption, cta: row.cta, hashtags: row.hashtags, alt: null, facebook: null, story: null, draft: true };
}

function HeadSection({ d, reload }: { d: DayResponse; reload: Reload }) {
  const row = d.row;
  return (
    <Card>
      <EditableText dayNo={d.dayNo} field="objective" label="Objective" value={row.objective} onSaved={reload}>
        {row.objective?.trim() ? <p className="sa-objective">{row.objective}</p> : <Body text={null} />}
      </EditableText>
      <EditableText dayNo={d.dayNo} field="dish" label="Dish" value={row.dish} kind="input" hint="Several dishes: separate them with commas. The first one names the photos." onSaved={reload}>
        <div className="sa-field-body">
          {d.dish ?? <span className="sa-muted">to choose{d.suggestion ? ` — suggestion: ${d.suggestion}` : ''}</span>}
        </div>
      </EditableText>
      <EditableText dayNo={d.dayNo} field="theme" label="Theme" value={row.theme} kind="input" onSaved={reload} />
      <EditableText dayNo={d.dayNo} field="post_time" label="Post at" value={row.post_time} kind="time" hint="Sydney time. Empty means the default." onSaved={reload}>
        <div className="sa-field-body fj-numeric">
          {fmtTime(row.post_time, d.settings.postTimeDefault ?? '18:00')}
          {!row.post_time ? <span className="sa-muted"> (default)</span> : null}
        </div>
      </EditableText>
      <div className="sa-field">
        <dl className="sa-kv">
          <dt>Type</dt><dd>{d.type}</dd>
          <dt>Template</dt><dd>{d.template}</dd>
          {row.custom ? (
            <>
              <dt>Custom</dt>
              <dd>
                {row.custom.style === 'auto' ? 'style by the art director' : `${row.custom.style} style`} · {row.custom.formats.map((f) => (f === 'feed' ? 'feed' : 'story')).join(' + ')}
                {row.custom.wording ? ' · your wording' : ' · wording by the agent'}
              </dd>
            </>
          ) : null}
        </dl>
      </div>
    </Card>
  );
}

function ShootSection({ d, reload }: { d: DayResponse; reload: Reload }) {
  const row = d.row;
  const screen = splitArrows(row.on_screen_text);
  const stories = paragraphs(row.story_ideas);
  return (
    <Card title="Shoot">
      <EditableText dayNo={d.dayNo} field="creative_instructions" label="Creative instructions" value={row.creative_instructions} onSaved={reload} />
      {d.shotList.length > 0 ? (
        <div className="sa-field">
          <div className="sa-eyebrow">Shot list</div>
          <ol className="sa-steps">{d.shotList.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
        </div>
      ) : null}
      <EditableText
        dayNo={d.dayNo}
        field="on_screen_text"
        label="On-screen text, in order"
        value={row.on_screen_text}
        copyText={screen.length ? screen.join('\n') : null}
        hint="Separate the lines with → (as in the sheet)."
        onSaved={reload}
      >
        {screen.length > 0 ? <ol className="sa-steps">{screen.map((s, i) => <li key={i}><span className="sa-screen-text">{s}</span></li>)}</ol> : <Body text={null} />}
      </EditableText>
      <EditableText dayNo={d.dayNo} field="story_ideas" label="Story ideas" value={row.story_ideas} hint="One idea per line." onSaved={reload}>
        {stories.length > 0 ? <ul className="sa-bullets">{stories.map((s, i) => <li key={i}>{s}</li>)}</ul> : <Body text={null} />}
      </EditableText>
    </Card>
  );
}

function CopySection({ d, reload, onRebuild }: { d: DayResponse; reload: Reload; onRebuild: () => void }) {
  const c = resolvedCopy(d.row, d.pack);
  const direct = c.draft ? undefined : 'Saved straight into the pack.';
  const edit: PostEdit = { dayNo: d.dayNo, reload, onRebuild };
  return (
    <Card title="Copy">
      {c.draft ? <span className="sa-draft">Draft — the pack isn't made yet</span> : null}
      <PostText {...edit} field="caption" label="Caption" value={c.caption} hint={direct} />
      <PostText {...edit} field="cta" label="CTA" value={c.cta} hint={direct} />
      <PostText {...edit} field="hashtags" label="Hashtags" value={c.hashtags} hint={direct ?? 'Space separated; a missing # is added.'} className="sa-hashtags" />
      {!c.draft ? (
        <>
          <PostText {...edit} field="alt_text" label="Alt text" value={c.alt} />
          {d.platforms ? null : <PostText {...edit} field="facebook_caption" label="Facebook caption" value={c.facebook} />}
          <PostText {...edit} field="story_text" label="Story text" value={c.story} />
        </>
      ) : d.row.caption_hint ? (
        <Field label="Caption hint (from the sheet)" value={d.row.caption_hint} />
      ) : null}
    </Card>
  );
}

/** The other platforms' versions of this post. The Copy section above is Instagram. */
function PlatformsSection({ d, reload, onRebuild }: { d: DayResponse; reload: Reload; onRebuild: () => void }) {
  const p = d.platforms;
  if (!p) return null;
  const edit: PostEdit = { dayNo: d.dayNo, reload, onRebuild };
  const n = p.notes;
  const hasNotes = n.goal || n.funnel || n.kpi || n.priority || n.objective || n.platform;
  return (
    <Card title="Every platform">
      {d.pack ? null : <span className="sa-draft">From the record. The writer fills the rest when the photo arrives.</span>}
      <PlatformTexts p={p} edit={edit} />
      {p.canva.headline ? <PostText {...edit} field="canva_headline" label="Headline on the design" value={p.canva.headline} hint="This is on the design, so saving makes the designs again." /> : null}
      {p.photo_edit_prompt ? <Field label="Photo edit prompt (use with a real photo of the food)" value={p.photo_edit_prompt} copy /> : null}
      {p.image_prompt ? <Field label="Image prompt (backgrounds, mock-ups and concepts only, never a dish you sell)" value={p.image_prompt} copy /> : null}
      {p.benefit || p.customer_message ? <Field label="Customer benefit" value={[p.benefit, p.customer_message].filter(Boolean).join('\n')} /> : null}
      {hasNotes ? (
        <Field label="Internal notes (never posted)" value={[n.platform && `Platform: ${n.platform}`, n.goal && `Goal: ${n.goal}`, n.funnel && `Funnel stage: ${n.funnel}`, n.objective && `Objective: ${n.objective}`, n.kpi && `KPI: ${n.kpi.replace(/\s*\n\s*/g, ', ')}`, n.priority && `Priority: ${n.priority}`].filter(Boolean).join('\n')} />
      ) : null}
      {d.pack ? <a className={buttonClass('secondary', 'sm')} href={packTextUrl(d.dayNo, 'platforms.txt')} download>platforms.txt</a> : null}
    </Card>
  );
}

function WordingSection({ d, reload, onRebuild }: { d: DayResponse; reload: Reload; onRebuild: () => void }) {
  return (
    <Card title="Wording" id="wording">
      <div className="sa-note" style={{ marginBottom: 10 }}>{d.wording.length ? 'Every wording for this day. Pick one and the designs and pack are made with it; change any of them, or add your own.' : 'The writer’s wordings appear here when the photo arrives. You can add your own now.'}</div>
      <WordingOptions dayNo={d.dayNo} sets={d.wording} waiting={d.wordingWaiting} onChosen={reload} onRebuild={onRebuild} />
    </Card>
  );
}

function ConfirmSection({ d, reload }: { d: DayResponse; reload: Reload }) {
  return (
    <Card title="Confirm" id="confirm">
      <EditableText dayNo={d.dayNo} field="confirmation_notes" label="Confirmation notes" value={d.row.confirmation_notes} onSaved={reload}>
        <Body text={d.row.confirmation_notes?.trim() ? d.row.confirmation_notes : 'Nothing to confirm.'} className={d.row.confirmation_notes?.trim() ? undefined : 'sa-field-body--muted'} />
      </EditableText>
      {d.placeholders.length > 0 ? (
        <div className="sa-field">
          <div className="sa-eyebrow">Still in brackets</div>
          <ul className="sa-bullets">{d.placeholders.map((p, i) => <li key={i}>{p}</li>)}</ul>
          <div className="sa-note">Nothing renders until every bracket is resolved.</div>
        </div>
      ) : null}
      {d.questions.length > 0 ? (
        <div className="sa-field">
          <div className="sa-eyebrow">Open questions ({d.questions.length})</div>
          <QuestionButtons questions={d.questions} onAnswered={reload} />
        </div>
      ) : null}
    </Card>
  );
}

const FORMAT_LABEL: Record<string, string> = { feed: 'Feed 4:5', story: 'Story 9:16', carousel: 'Carousel', 'reel-cover': 'Reel cover' };
const CROP_LABEL: Record<string, string> = { '4x5': 'Crop 4:5 (feed)', '9x16': 'Crop 9:16 (story / reel)', '1x1': 'Crop 1:1' };
const QUALITY_NOTE: Record<string, string> = { small: 'small — asked to resend', dark: 'dark — asked to resend', blurry: 'blurry — asked to resend' };

function Thumb({ a }: { a: Asset }) {
  const verdict = a.quality?.verdict;
  const flagged = Boolean(verdict && verdict !== 'ok');
  const note = verdict ? QUALITY_NOTE[verdict] : undefined;
  const isVideo = a.kind === 'video';
  const cls = `sa-thumb${isVideo ? ' sa-thumb--video' : ''}${flagged ? ' sa-thumb--flagged' : ''}`;
  const title = [a.caption ?? a.kind, note].filter(Boolean).join(' · ');
  return (
    <figure className={cls} title={title}>
      {isVideo ? (
        <span className="sa-thumb-kind" aria-label="video clip">▶</span>
      ) : a.thumb ? (
        <a href={fileUrl(a.thumb)} target="_blank" rel="noreferrer"><img src={fileUrl(a.thumb)} alt={a.caption ?? `${a.kind} ${a.id}`} loading="lazy" /></a>
      ) : (
        <span className="sa-thumb-kind">{a.kind}</span>
      )}
      {flagged && note ? <span className="sa-thumb-note">{note}</span> : null}
      {a.caption ? <figcaption className="sa-thumb-cap">{a.caption}</figcaption> : null}
    </figure>
  );
}

/** The owner picks the photos the design uses: one, or two different dishes shown together with their names on them. */
function DesignPhotos({ d, reload, onRebuild }: { d: DayResponse; reload: Reload; onRebuild: () => void }) {
  const photos = d.assets.filter((a) => a.kind !== 'video' && a.kind !== 'text' && a.crops);
  const saved = d.row.design_photos ?? [];
  const [picked, setPicked] = useState<{ assetId: number; name: string }[]>(() => saved.map((p) => ({ assetId: p.assetId, name: p.name ?? '' })));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
  if (photos.length < 2) return null;
  const max = d.canPair ? 2 : 1;
  const nameFrom = (a: Asset) => (a.caption ?? '').replace(/#\S+/g, '').split(/\s+--\s+|\s+—\s+/)[0]!.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 28);

  function toggle(a: Asset) {
    setResult(null);
    setPicked((now) => {
      if (now.some((p) => p.assetId === a.id)) return now.filter((p) => p.assetId !== a.id);
      const next = [...now, { assetId: a.id, name: nameFrom(a) }];
      return next.slice(-max);
    });
  }

  async function apply() {
    setBusy(true);
    setResult(null);
    try {
      // In the order they were received: the first goes on the left or the top.
      const order = photos.map((a) => a.id);
      const r = await setDesignPhotos(d.dayNo, [...picked].sort((x, y) => order.indexOf(x.assetId) - order.indexOf(y.assetId)).map((p) => ({ assetId: p.assetId, name: p.name.trim() || null })));
      setResult({ text: r.message });
      if (r.rebuilding) onRebuild();
      await reload();
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-field">
      <div className="sa-eyebrow">Photos in the design</div>
      <div className="sa-note">{d.canPair ? 'Tap one photo, or two for two different dishes shown together. Each of the two carries its dish’s name, so customers can tell them apart.' : 'Tap the photo the design should use.'}{saved.length ? '' : ' Until you pick, the design uses the newest photo.'}</div>
      <div className="sa-photo-pick">
        {photos.map((a) => {
          const p = picked.find((x) => x.assetId === a.id);
          return (
            <div key={a.id} className={`sa-photo-choice${p ? ' sa-photo-choice--on' : ''}`}>
              <button type="button" aria-pressed={Boolean(p)} disabled={busy} onClick={() => toggle(a)}>
                {a.thumb ? <img src={fileUrl(a.thumb)} alt={a.caption ?? `Photo ${a.id}`} loading="lazy" /> : <span>Photo {a.id}</span>}
              </button>
              {p && picked.length === 2 ? (
                <input className="sa-input" aria-label="Dish name on this photo" placeholder="Dish name" maxLength={28} value={p.name} disabled={busy} onChange={(e) => setPicked((now) => now.map((x) => (x.assetId === a.id ? { ...x, name: e.target.value } : x)))} />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="sa-actions sa-editor-actions">
        <Button variant="secondary" size="sm" disabled={busy || picked.length === 0} onClick={() => void apply()}>{busy ? 'Saving…' : picked.length === 2 ? 'Make the design with these two' : 'Make the design with this photo'}</Button>
      </div>
      {result ? <div className={`sa-result${result.error ? ' sa-result--error' : ''}`} role="status">{result.text}</div> : null}
    </div>
  );
}

function ImagesSection({ d, reload, onRebuild }: { d: DayResponse; reload: Reload; onRebuild: () => void }) {
  const caption = resolvedCopy(d.row, d.pack).caption ?? '';
  const slug = `day${d.dayNo}`;
  // Cut 1 has no renders yet, so the pack's plain crops stand in for them.
  const outputs: { key: string; label: string; fileId: string; name: string }[] = d.renders.length > 0
    ? d.renders.map((r) => ({ key: `r${r.id}`, label: `${FORMAT_LABEL[r.format] ?? r.format}${r.page != null ? ` · page ${r.page}` : ''}`, fileId: r.file_id, name: `${slug}-${r.format}${r.page != null ? `-${r.page}` : ''}` }))
    : Object.entries(d.pack?.crops ?? {}).flatMap(([crop, id]) => (id ? [{ key: `c${crop}`, label: CROP_LABEL[crop] ?? `Crop ${crop}`, fileId: id, name: `${slug}-${crop}` }] : []));
  const empty = d.assets.length === 0 && outputs.length === 0 && !d.pack;
  return (
    <Card title="Images">
      <div className="sa-field">
        <div className="sa-eyebrow">Add photos</div>
        {empty ? <div className="sa-muted" style={{ margin: '4px 0 10px' }}>No photos yet. Add them here, or send them to the bot as a File with the dish in the caption.</div> : <div style={{ height: 6 }} />}
        {/* Keyed by day so the caption and file list reset when the owner moves to another day. */}
        <UploadPhotos key={d.dayNo} d={d} onChanged={reload} />
      </div>
      {d.assets.length > 0 ? (
        <div className="sa-field">
          <div className="sa-eyebrow">Received ({d.assets.length})</div>
          <div className="sa-thumbs">
            {d.assets.map((a) => <Thumb key={a.id} a={a} />)}
          </div>
        </div>
      ) : null}
      <DesignPhotos key={`photos-${d.dayNo}`} d={d} reload={reload} onRebuild={onRebuild} />
      {outputs.length > 0 ? (
        <div className="sa-field">
          <div className="sa-eyebrow">{d.renders.length > 0 ? 'Rendered' : 'Crops'}</div>
          <div className="sa-images">
            {outputs.map((o) => (
              <div key={o.key} className="sa-image">
                <a className="sa-image-preview" href={fileUrl(o.fileId)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(o.fileId)} alt={o.label} loading="lazy" />
                </a>
                <div className="sa-image-label">{o.label}</div>
                <div className="sa-image-actions">
                  <a className={buttonClass('secondary', 'sm')} href={fileUrl(o.fileId)} download={o.name}>Download</a>
                  <ShareButton url={fileUrl(o.fileId)} name={o.name} text={caption} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {d.pack ? (
        <div className="sa-field">
          <div className="sa-eyebrow">Files</div>
          <div className="sa-files">
            <a className={buttonClass('secondary', 'sm')} href={packTextUrl(d.dayNo, 'caption.txt')} download>caption.txt</a>
            <a className={buttonClass('secondary', 'sm')} href={packTextUrl(d.dayNo, 'canva-brief.txt')} download>canva-brief.txt</a>
            {d.pack.reel_pack_txt ? <a className={buttonClass('secondary', 'sm')} href={packTextUrl(d.dayNo, 'reel-pack.txt')} download>reel-pack.txt</a> : null}
          </div>
          <div className="sa-note" style={{ marginTop: 8 }}>Pack made {fmtDateTime(d.pack.created_at)}.</div>
        </div>
      ) : null}
    </Card>
  );
}

function StatusSection({ d, onChanged }: { d: DayResponse; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);

  async function act(label: string, fn: () => Promise<{ ok: true; date?: string }>) {
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setResult({ text: r.date ? `${label}. It now sits on ${fmtDate(r.date)}.` : `${label}.` });
      setSkipOpen(false);
      await onChanged();
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const posted = d.status === 'posted';
  return (
    <Card title="Status">
      <div className="sa-status-head">
        <StatusPill status={d.status} />
        <span className="sa-muted">{d.needs}</span>
        {d.row.posted_at ? <span className="sa-muted">Posted {fmtDateTime(d.row.posted_at)}</span> : null}
      </div>
      <div className="sa-actions sa-status-actions">
        <Button
          variant="primary"
          disabled={busy || posted}
          onClick={() => {
            if (window.confirm(`Mark Day ${d.dayNo} as posted?`)) void act('Marked posted', () => markPosted(d.dayNo));
          }}
        >
          {posted ? 'Posted' : 'Mark posted'}
        </Button>
        <Button variant="secondary" disabled={busy || posted} onClick={() => setSkipOpen((v) => !v)} aria-expanded={skipOpen}>Skip</Button>
        <Button variant="secondary" disabled={busy || posted} onClick={() => void act('Pushed a day', () => pushDay(d.dayNo, 1))}>Push +1 day</Button>
      </div>
      {skipOpen ? (
        <div className="sa-choice" role="group" aria-label="Skip this day">
          <div className="sa-choice-text">Skip Day {d.dayNo} — move it to the next free date and…</div>
          <div className="sa-actions">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act('Skipped; everything after it moved a day', () => skipDay(d.dayNo, 'push-all'))}>Push everything after it</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act('Skipped just this one', () => skipDay(d.dayNo, 'just-this'))}>Just this one</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSkipOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {result ? <div className={`sa-result${result.error ? ' sa-result--error' : ''}`} role="status">{result.text}</div> : null}
    </Card>
  );
}

/** Who made an edit, in plain words. */
function sourceLabel(source: EditSource): string {
  switch (source) {
    case 'owner-web': return 'you, web';
    case 'owner-telegram': return 'you, Telegram';
    case 'agent': return 'agent';
    case 'seed': return 'seed';
    default: return source;
  }
}

function HistorySection({ d }: { d: DayResponse }) {
  if (d.edits.length === 0) return null;
  return (
    <Card title="History">
      <ul className="sa-history">
        {d.edits.map((e, i) => (
          <li key={`${e.created_at}-${e.field}-${i}`}>
            <span className="sa-history-meta">{fmtDateTime(e.created_at)} · {FIELD_LABEL[e.field] ?? e.field} · {sourceLabel(e.source)}</span>
            {e.old_value ? <span className="sa-history-old">{e.old_value}</span> : null}
            <span className="sa-history-new">{e.new_value ?? '—'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const GENERATE_POLL_MS = 4_000;
const GENERATE_FOR_MS = 150_000;

/**
 * Arriving from the Create flow (`state.generating`): the page refetches every few seconds until the designs are
 * there, the pipeline has a question, or a couple of minutes have passed.
 */
function useGenerating(data: DayResponse | null, reload: Reload): { phase: 'working' | 'slow' | null; watch: () => void } {
  const { state } = useLocation();
  const [phase, setPhase] = useState<'working' | 'slow' | null>(() => ((state as { generating?: boolean } | null)?.generating ? 'working' : null));
  useEffect(() => {
    if (phase !== 'working') return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > GENERATE_FOR_MS) setPhase('slow');
      else void reload();
    }, GENERATE_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, reload]);
  // A rebuild is over when a new pack replaces the one it started from; the first design when anything has arrived.
  const [fromPack, setFromPack] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'working' || !data) return;
    const done = fromPack !== undefined ? (data.pack?.id ?? null) !== fromPack || data.questions.length > 0 : data.renders.length > 0 || data.questions.length > 0 || data.status === 'ready';
    if (done) {
      setPhase(null);
      setFromPack(undefined);
    }
  }, [data, phase, fromPack]);
  return {
    phase,
    watch: () => {
      setFromPack(data?.pack?.id ?? null);
      setPhase('working');
    },
  };
}

export function Day() {
  const params = useParams<{ dayNo: string }>();
  const dayNo = Number(params.dayNo);
  const valid = Number.isInteger(dayNo) && dayNo >= FIRST_DAY;
  const { data, error, loading, reload } = useApi(() => getDay(dayNo), dayNo);
  const { phase: generating, watch: onRebuild } = useGenerating(data, reload);

  // Custom posts are numbered from 101 and sit outside the month's run, so they get no previous / next links.
  const inPlan = dayNo <= LAST_DAY;
  const nav = inPlan ? (
    <div className="sa-daynav">
      {dayNo > FIRST_DAY ? <Link className={buttonClass('secondary', 'sm')} to={`/day/${dayNo - 1}`} aria-label="Previous day">‹ Day {dayNo - 1}</Link> : null}
      {dayNo < LAST_DAY ? <Link className={buttonClass('secondary', 'sm')} to={`/day/${dayNo + 1}`} aria-label="Next day">Day {dayNo + 1} ›</Link> : null}
    </div>
  ) : (
    <div className="sa-daynav">
      <Link className={buttonClass('secondary', 'sm')} to="/create">✨ Another design</Link>
    </div>
  );

  if (!valid) {
    return (
      <>
        <PageHeader title="Day" back={{ href: '/', label: 'This week' }} Link={BackLink} />
        <Empty>That isn't a day number. <Link to="/month">Pick one from the month.</Link></Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={data?.title ?? `Day ${dayNo}`}
        subtitle={data ? `${fmtDate(data.date)} · ${SLOT_LABEL[data.slot]} · ${data.series}${data.campaign ? ` · ${data.campaign.name}` : ''}` : undefined}
        back={{ href: '/', label: 'This week' }}
        Link={BackLink}
        actions={nav}
      />
      {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading what={`Loading Day ${dayNo}`} /> : null}
      {data ? (
        <div className="sa-stack">
          {error ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
          {generating === 'working' ? (
            <div className="sa-generating" role="status">
              <span className="sa-spinner" aria-hidden="true" />
              <span>Making the design: reading the photo, directing and checking the layout, writing the caption. About a minute. It arrives here and in Telegram.</span>
            </div>
          ) : generating === 'slow' ? (
            <div className="sa-generating" role="status">
              <span>Still working. Pull to refresh in a moment, or watch Telegram. If the pipeline needed something, its question shows under Confirm.</span>
              <Button variant="secondary" size="sm" onClick={() => void reload()}>Refresh</Button>
            </div>
          ) : null}
          <HeadSection d={data} reload={reload} />
          <div className="sa-two">
            <ShootSection d={data} reload={reload} />
            <CopySection d={data} reload={reload} onRebuild={onRebuild} />
          </div>
          <PlatformsSection d={data} reload={reload} onRebuild={onRebuild} />
          <WordingSection d={data} reload={reload} onRebuild={onRebuild} />
          <ConfirmSection d={data} reload={reload} />
          <ImagesSection d={data} reload={reload} onRebuild={onRebuild} />
          <StatusSection d={data} onChanged={reload} />
          <HistorySection d={data} />
        </div>
      ) : null}
    </>
  );
}
