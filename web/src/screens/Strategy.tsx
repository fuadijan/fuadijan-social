import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { getStrategy, seedStrategyPlan } from '../api';
import { Button, Card, PageHeader } from '../components/fj';
import { ErrorCard, Loading } from '../components/States';
import type { SeedPlanResponse, Strategy as StrategyData } from '../types';
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

export function Strategy() {
  const { data, error, loading, reload } = useApi(getStrategy, 'strategy');
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
