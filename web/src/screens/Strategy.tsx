import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { getCampaigns, getPlanning, getStrategy, importCalendar, seedStrategyPlan } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { ErrorCard, Loading } from '../components/States';
import type { CampaignProgress, ImportCalendarResponse, SeedPlanResponse, Strategy as StrategyData } from '../types';
import { useApi } from '../useApi';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })}`;
};
const FORMATS: Record<string, string> = { R: 'Reel', C: 'Carousel', P: 'Photo', S: 'Stories', G: 'Google post' };
const formatWords = (f: string) => f.split('+').map((x) => FORMATS[x.trim()] ?? x.trim()).join(' + ');

function Lines({ items }: { items: string[] }) {
  return <ul className="sa-bullets">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Plan({ s, today }: { s: StrategyData; today: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function seed() {
    if (!window.confirm(`Make this the month's plan?\n\nDays that already have a photo, or are past "planned", stay as they are; the other days take the strategy's dish, template, caption and dates. Fields you edited are never overwritten.`)) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await seedStrategyPlan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Content plan · ${fmtDay(s.plan.from)} – ${fmtDay(s.plan.to)}`}>
      <div className="sa-note" style={{ marginBottom: 10 }}>
        Four themed weeks, one post a day, Stories every day. Making it the month's plan writes these days into the calendar; the designs are then made from them as photos arrive.
      </div>
      <div className="sa-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" disabled={busy} onClick={() => void seed()}>{busy ? 'Writing the plan…' : "Make this the month's plan"}</Button>
        <Link to="/month" className="sa-chip">See the month</Link>
      </div>
      {result ? (
        <div className="sa-result" role="status" style={{ marginBottom: 12 }}>
          Plan {result.plan}: {result.inserted} day{result.inserted === 1 ? '' : 's'} added, {result.updated} updated
          {result.kept.length ? `, ${result.kept.length} left as they were (started): Day ${result.kept.join(', ')}` : ''}
          {result.protectedFields.length ? `; ${result.protectedFields.length} edited field${result.protectedFields.length === 1 ? '' : 's'} kept` : ''}.
        </div>
      ) : null}
      {error ? <div className="sa-result sa-result--error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      <Table head={['Week', 'Theme', 'Goal']} rows={s.plan.weeks.map((w) => [`${w.week} · ${w.dates}`, w.theme, w.goal])} />
      <ul className="sa-plan">
        {s.plan.days.map((d) => (
          <li key={d.date} className={`sa-plan-day${d.date === today ? ' sa-plan-day--today' : ''}${d.event ? ' sa-plan-day--event' : ''}`}>
            <div className="sa-plan-when">
              <span className="sa-plan-date">{fmtDay(d.date)}</span>
              <span className="sa-chip-meta">{formatWords(d.format)}</span>
            </div>
            <div className="sa-plan-body">
              <div>{d.event ? <strong>{d.event} — </strong> : null}{d.idea}</div>
              <div className="sa-note">{d.booster}{d.dish ? ` · ${d.dish}` : ''}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STATUS_WORD: Record<string, string> = { planned: 'Planned', active: 'Running', done: 'Done' };

/** Every campaign with its dates and how far its posts have got; several run at once. */
function Campaigns({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi(getCampaigns, `campaigns-${refreshKey}`);
  if (error) return <Card title="Campaigns"><ErrorCard message={error} onRetry={() => void reload()} /></Card>;
  if (loading || !data) return <Card title="Campaigns"><Loading what="Reading the campaigns" /></Card>;
  const list = data.campaigns;
  return (
    <Card title="Campaigns">
      {list.length ? (
        <Table
          head={['Campaign', 'Dates', 'Series', 'Status', 'Posts']}
          rows={list.map((c: CampaignProgress) => [
            <span key={c.key}><strong>{c.name}</strong>{c.category || c.objective || c.priority ? <><br /><span className="sa-note">{[c.category, c.objective, c.success_metric ? `measured by ${c.success_metric}` : null, c.priority ? `${c.priority} priority` : null].filter(Boolean).join(' · ')}</span></> : null}</span>,
            c.start_date ? `${fmtDay(c.start_date)}${c.end_date && c.end_date !== c.start_date ? ` – ${fmtDay(c.end_date)}` : ''}` : '—',
            c.series ?? '—',
            STATUS_WORD[c.status] ?? c.status,
            <span key={`${c.key}-p`}>{c.posts ? `${c.made} of ${c.posts} made, ${c.posted} posted` : 'no posts yet'}{c.next ? <><br /><span className="sa-note">next {fmtDay(c.next)}</span></> : null}</span>,
          ])}
        />
      ) : (
        <div className="sa-note">No campaigns yet. A Campaigns sheet in the month's workbook adds them, and a row's campaign column puts a post under one.</div>
      )}
    </Card>
  );
}

/** The planning documents that are not posts, each sheet folded until opened. */
function PlanningDocs({ refreshKey }: { refreshKey: number }) {
  const { data } = useApi(getPlanning, `planning-${refreshKey}`);
  if (!data?.sheets.length) return null;
  return (
    <Card title="Planning documents">
      <div className="sa-note" style={{ marginBottom: 8 }}>What the agent reads with every post: the positioning, the series' purpose, the working rules and the hooks. Loading a workbook again replaces its sheets.</div>
      {data.sheets.map((s) => (
        <details key={s.name} style={{ marginBottom: 8 }}>
          <summary><strong>{s.name}</strong> <span className="sa-note">{s.rows.length} row{s.rows.length === 1 ? '' : 's'}{s.source ? ` · ${s.source}` : ''}</span></summary>
          <Table head={s.header} rows={s.rows} />
        </details>
      ))}
    </Card>
  );
}

const fmtMonth = (plan: string) => new Date(`${plan}-01T00:00:00Z`).toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * A month's workbook, loaded from the browser the way `npm run seed-calendar -- --file` loads it: the monthly
 * template filled in (sheet Calendar, 18 columns, 30 rows; Slogans optional).
 */
function LoadWorkbook({ onLoaded }: { onLoaded: () => void }) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState('');
  const startId = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportCalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await importCalendar(file, start || null));
      onLoaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Load a month's workbook">
      <div className="sa-note" style={{ marginBottom: 10 }}>
        A workbook with any of the sheets the app reads: <strong>Calendar</strong> (the 18-column month, or the Day · CampaignID · ProductID · BenefitID · Series · Format · Hook · Caption · CTA · Hashtags · Status layout), <strong>Campaigns</strong>, <strong>Products</strong>, <strong>Benefits</strong> and <strong>Slogans</strong>. Each may come in its own workbook.
        The month of the first date names the plan, and a new month lands beside the running one. Loading a month again updates what changed; a day that has started, and any field you edited, is left alone.
      </div>
      <div className="sa-upload-row" style={{ marginBottom: 12 }}>
        <label className={`${buttonClass('secondary', 'sm')} sa-upload-pick`} htmlFor={inputId}>{file ? 'Change workbook' : 'Choose workbook (.xlsx)'}</label>
        <input id={inputId} className="sa-visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }} />
        {file ? <span className="sa-muted">{file.name}</span> : null}
        <Button variant="primary" disabled={busy || !file} onClick={() => void load()}>{busy ? 'Loading…' : 'Load it'}</Button>
      </div>
      <div className="sa-upload-row" style={{ marginBottom: 12 }}>
        <label className="sa-eyebrow" htmlFor={startId}>First day</label>
        <input id={startId} className="sa-input" type="date" value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} style={{ width: 'auto' }} />
        <span className="sa-note">Only for a Calendar laid out by Day number without dates: the date Day 1 posts on.</span>
      </div>
      {result ? (
        <div className="sa-result" role="status" style={{ marginBottom: 12 }}>
          <div>
            {result.plan ? (
              <>
                <strong>{fmtMonth(result.plan)}</strong>: {result.rows} row{result.rows === 1 ? '' : 's'} read ({result.from} – {result.to}); {result.inserted} day{result.inserted === 1 ? '' : 's'} added, {result.updated} updated
                {result.kept.length ? `, ${result.kept.length} left as they were (started): Day ${result.kept.join(', ')}` : ''}
                {result.protectedFields.length ? `; ${result.protectedFields.length} edited field${result.protectedFields.length === 1 ? '' : 's'} kept` : ''}.{' '}
              </>
            ) : <>No Calendar sheet in this workbook, so no days changed. </>}
            {[result.campaigns ? `${result.campaigns} campaign${result.campaigns === 1 ? '' : 's'}` : null, result.products ? `${result.products} product${result.products === 1 ? '' : 's'}` : null, result.benefits ? `${result.benefits} benefit${result.benefits === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}{result.campaigns || result.products || result.benefits ? ' loaded. ' : ''}
            {result.slogans.loaded ? `${result.slogans.loaded} slogan${result.slogans.loaded === 1 ? '' : 's'} for ${result.slogans.items} item${result.slogans.items === 1 ? '' : 's'} joined the wording bank.` : 'No Slogans sheet.'}
            {result.plan ? <>{' '}<Link to={`/month?plan=${encodeURIComponent(result.plan)}`}>See {fmtMonth(result.plan)}</Link></> : null}
          </div>
          {result.reference.length ? <div className="sa-note" style={{ marginTop: 8 }}>Planning documents kept: {result.reference.join(', ')}.</div> : null}
          {result.unread.length ? <div className="sa-result sa-result--error" style={{ marginTop: 8 }}>These columns were not read: {result.unread.join(', ')}. Check the spelling if they should have been.</div> : null}
          {result.unreadSheets.length ? <div className="sa-note" style={{ marginTop: 8 }}>The app has no place yet for these sheets, so they were left out: {result.unreadSheets.join(', ')}.</div> : null}
          {result.placeholders.length ? (
            <div style={{ marginTop: 8 }}>
              <div className="sa-eyebrow">You will be asked about</div>
              <ul className="sa-bullets">{result.placeholders.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </Card>
  );
}

export function Strategy() {
  const { data, error, loading, reload } = useApi(getStrategy, 'strategy');
  const [loads, setLoads] = useState(0);
  if (error) return <ErrorCard message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <Loading what="Reading the strategy" />;
  const s = data.strategy;

  return (
    <>
      <PageHeader
        title="Strategy"
        subtitle={<>{s.name}. What the agent is told when it writes and designs; the taglines, poster concepts and ready captions sit in the <Link to="/wordings">wording bank</Link> ({data.wordingsInBank}). Edit <code>brand/strategy.json</code> to change any of it.</>}
      />

      {data.todayRituals.length || data.runningEvents.length ? (
        <div className="sa-generating" style={{ marginBottom: 12 }}>
          <span>📅</span>
          <div>
            {data.todayRituals.length ? <div><strong>Today:</strong> {data.todayRituals.join(' · ')}</div> : null}
            {data.runningEvents.length ? <div><strong>Running:</strong> {data.runningEvents.join(' · ')}</div> : null}
          </div>
        </div>
      ) : null}

      <Card title="One idea">
        <p className="sa-strategy-lead">{s.oneIdea}</p>
        <p>{s.positioning}</p>
        <dl className="sa-kv">
          <dt>Descriptor</dt><dd>{s.descriptor}</dd>
          <dt>Primary</dt><dd>{s.knownFor.primary}</dd>
          <dt>Secondary</dt><dd>{s.knownFor.secondary}</dd>
          <dt>Trust</dt><dd>{s.knownFor.trust}</dd>
        </dl>
      </Card>

      <Card title="Taglines">
        <Table head={['Tagline', 'Best use']} rows={s.taglines.map((t) => [<strong key={t.text}>{t.text}</strong>, t.use])} />
      </Card>

      <Card title="Voice">
        <div className="sa-two-col">
          <div><div className="sa-eyebrow">Do</div><Lines items={s.voice.do} /></div>
          <div><div className="sa-eyebrow">Never</div><Lines items={s.voice.dont} /></div>
        </div>
      </Card>

      <Card title="Signature dishes">
        <Table head={['Role', 'Dish', 'Why']} rows={s.signatureDishes.map((d) => [d.role, <strong key={d.dish}>{d.dish}</strong>, d.why])} />
      </Card>

      <Card title="Rituals">
        <Table head={['Ritual', 'When', 'Offer idea', 'Measure']} rows={s.rituals.map((r) => [<strong key={r.name}>{r.name}</strong>, r.when, r.offer, r.measure])} />
        <div className="sa-note" style={{ marginTop: 8 }}>Each ritual is a product in Create → New design, with its poster wording in the bank.</div>
      </Card>

      <Card title="Event year">
        <Table
          head={['Event', 'Dates', 'Offers', 'Poster']}
          rows={s.events.map((e) => [
            <strong key={e.name}>{e.name}</strong>,
            `${fmtDay(e.from)}${e.to !== e.from ? ` – ${fmtDay(e.to)}` : ''}${e.approximate ? ' (approx.)' : ''}${e.quarterly ? ', quarterly' : ''}`,
            e.offers,
            <span key={`${e.name}-p`}><strong>{e.poster.headline.replace('\n', ' ')}</strong> — {e.poster.line}<br /><span className="sa-note">{e.poster.visual}</span></span>,
          ])}
        />
      </Card>

      <Plan s={s} today={data.today} />

      <Campaigns refreshKey={loads} />

      <PlanningDocs refreshKey={loads} />

      <LoadWorkbook onLoaded={() => setLoads((n) => n + 1)} />

      <Card title="Poster concepts">
        <Table head={['Poster', 'Headline', 'Supporting line', 'Visual']} rows={s.posters.map((p) => [p.name, <strong key={p.name}>{p.headline.replace('\n', ' / ')}</strong>, p.line, p.visual])} />
      </Card>

      <Card title="Hashtag sets">
        <div className="sa-note" style={{ marginBottom: 8 }}>Core always; one more set by topic. 5–8 per post on Instagram, 3–5 on TikTok; the agent picks 3–5 for the pack.</div>
        <Table head={['Set', 'When', 'Hashtags']} rows={Object.entries(s.hashtagSets).map(([k, v]) => [<strong key={k}>{k}</strong>, v.when, <span key={`${k}-t`} className="sa-hashtags">{v.tags.join(' ')}</span>])} />
      </Card>

      <Card title="Caption patterns">
        <Table head={['Kind', 'Pattern']} rows={Object.entries(s.captionTemplates).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), v])} />
      </Card>

      <Card title="Platforms">
        <Table head={['Platform', 'Job', 'Cadence', 'Effort']} rows={s.platforms.map((p) => [<strong key={p.platform}>{p.platform}</strong>, p.job, p.cadence, p.share])} />
      </Card>

      <Card title="Audiences">
        <Table head={['Segment', 'What they want', 'Message', 'Channels']} rows={s.segments.map((x) => [<strong key={x.segment}>{x.segment}</strong>, x.want, x.message, x.channels])} />
      </Card>

      <Card title="Photos and reels">
        <div className="sa-two-col">
          <div><div className="sa-eyebrow">Shot list</div><ol className="sa-bullets">{s.photoPrompts.map((p, i) => <li key={i}>{p}</li>)}</ol></div>
          <div><div className="sa-eyebrow">Rules</div><Lines items={s.photoRules} /></div>
        </div>
        <div className="sa-eyebrow" style={{ marginTop: 12 }}>Reel ideas</div>
        <Table head={['Concept', 'Hook', 'Shots', 'Length']} rows={s.reelIdeas.map((r) => [<strong key={r.concept}>{r.concept}</strong>, r.hook, r.shots, r.length])} />
        <div className="sa-eyebrow" style={{ marginTop: 12 }}>Look</div>
        <p className="sa-muted">{s.visual.palette}</p>
        <Lines items={s.visual.rules} />
      </Card>

      <Card title="Monthly numbers">
        <Table head={['Layer', 'Metric', 'Where', 'Starting target']} rows={s.kpis.map((k) => [k.layer, k.metric, k.where, k.target])} />
        <div className="sa-eyebrow" style={{ marginTop: 12 }}>First Monday of the month, 60 minutes</div>
        <ol className="sa-bullets">{s.monthlyLoop.map((x, i) => <li key={i}>{x}</li>)}</ol>
      </Card>
    </>
  );
}
