import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { fileUrl, getDay, markPosted, packTextUrl, pushDay, skipDay } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { CopyButton } from '../components/CopyButton';
import { EditableText, FIELD_LABEL } from '../components/EditableText';
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

const Body = ({ text, className }: { text: string | null | undefined; className?: string }) => {
  const t = text?.trim() ?? '';
  return <div className={`sa-field-body${t ? '' : ' sa-field-body--muted'}${className ? ` ${className}` : ''}`}>{t || '—'}</div>;
};

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

function CopySection({ d, reload }: { d: DayResponse; reload: Reload }) {
  const c = resolvedCopy(d.row, d.pack);
  // With a pack, what shows is the pack's resolved text; the edit changes the sheet's draft the pack is made from.
  const fromSheet = c.draft ? undefined : 'This edits the sheet’s text; the pack is rebuilt from it.';
  return (
    <Card title="Copy">
      {c.draft ? <span className="sa-draft">Draft — the pack isn't made yet</span> : null}
      <EditableText dayNo={d.dayNo} field="caption" label="Caption" value={d.row.caption} copyText={c.caption} hint={fromSheet} onSaved={reload}>
        <Body text={c.caption} />
      </EditableText>
      <EditableText dayNo={d.dayNo} field="cta" label="CTA" value={d.row.cta} copyText={c.cta} hint={fromSheet} onSaved={reload}>
        <Body text={c.cta} />
      </EditableText>
      <EditableText dayNo={d.dayNo} field="hashtags" label="Hashtags" value={d.row.hashtags} copyText={c.hashtags} hint={fromSheet ?? 'Space separated, each with its #.'} onSaved={reload}>
        <Body text={c.hashtags} className="sa-hashtags" />
      </EditableText>
      {!c.draft ? (
        <>
          <Field label="Alt text" value={c.alt} copy />
          <Field label="Facebook caption" value={c.facebook} copy />
          <Field label="Story text" value={c.story} copy />
        </>
      ) : d.row.caption_hint ? (
        <Field label="Caption hint (from the sheet)" value={d.row.caption_hint} />
      ) : null}
    </Card>
  );
}

function WordingSection({ d, reload }: { d: DayResponse; reload: Reload }) {
  if (d.wording.length === 0) return null;
  return (
    <Card title="Wording" id="wording">
      <div className="sa-note" style={{ marginBottom: 10 }}>Every wording written for this day. Pick one and the designs and pack are made with it.</div>
      <WordingOptions dayNo={d.dayNo} sets={d.wording} waiting={d.wordingWaiting} onChosen={reload} />
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

function ImagesSection({ d, reload }: { d: DayResponse; reload: Reload }) {
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

export function Day() {
  const params = useParams<{ dayNo: string }>();
  const dayNo = Number(params.dayNo);
  const valid = Number.isInteger(dayNo) && dayNo >= FIRST_DAY;
  const { data, error, loading, reload } = useApi(() => getDay(dayNo), dayNo);

  const nav = (
    <div className="sa-daynav">
      {dayNo > FIRST_DAY ? <Link className={buttonClass('secondary', 'sm')} to={`/day/${dayNo - 1}`} aria-label="Previous day">‹ Day {dayNo - 1}</Link> : null}
      {dayNo < LAST_DAY ? <Link className={buttonClass('secondary', 'sm')} to={`/day/${dayNo + 1}`} aria-label="Next day">Day {dayNo + 1} ›</Link> : null}
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
        subtitle={data ? `${fmtDate(data.date)} · ${SLOT_LABEL[data.slot]} · ${data.series}` : undefined}
        back={{ href: '/', label: 'This week' }}
        Link={BackLink}
        actions={nav}
      />
      {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading what={`Loading Day ${dayNo}`} /> : null}
      {data ? (
        <div className="sa-stack">
          {error ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
          <HeadSection d={data} reload={reload} />
          <div className="sa-two">
            <ShootSection d={data} reload={reload} />
            <CopySection d={data} reload={reload} />
          </div>
          <WordingSection d={data} reload={reload} />
          <ConfirmSection d={data} reload={reload} />
          <ImagesSection d={data} reload={reload} />
          <StatusSection d={data} onChanged={reload} />
          <HistorySection d={data} />
        </div>
      ) : null}
    </>
  );
}
