import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { getCampaigns, getPlanning, importCalendar } from '../api';
import { Button, buttonClass, Card, PageHeader } from '../components/fj';
import { ErrorCard, Loading } from '../components/States';
import type { CampaignProgress, ImportCalendarResponse, PlanningResponse, PlanningSheet } from '../types';
import { useApi } from '../useApi';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })}`;
};

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

/** One planning sheet as its own card; the first column reads as the row's name. */
function SheetCard({ sheet, title }: { sheet: PlanningSheet | undefined; title?: string }) {
  if (!sheet) return null;
  return (
    <Card title={title ?? sheet.name}>
      <Table head={sheet.header} rows={sheet.rows.map((r) => r.map((c, i) => (i === 0 ? <strong key={i}>{c}</strong> : c)))} />
    </Card>
  );
}

const STATUS_WORD: Record<string, string> = { planned: 'Planned', active: 'Running', done: 'Done' };
const PRODUCT_WORD: Record<string, string> = { active: 'On the menu', 'coming-soon': 'Coming soon', planned: 'Planned', retired: 'Retired' };

/** Every campaign with its dates and how far its posts have got; several run at once. */
function Campaigns({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi(getCampaigns, `campaigns-${refreshKey}`);
  if (error) return <Card title="Campaigns"><ErrorCard message={error} onRetry={() => void reload()} /></Card>;
  if (loading || !data) return <Card title="Campaigns"><Loading what="Reading the campaigns" /></Card>;
  if (!data.campaigns.length) return null;
  return (
    <Card title="Campaigns">
      <Table
        head={['Campaign', 'Dates', 'Status', 'Posts']}
        rows={data.campaigns.map((c: CampaignProgress) => [
          <span key={c.key}><strong>{c.name}</strong>{c.category || c.objective || c.success_metric || c.priority ? <><br /><span className="sa-note">{[c.category, c.objective, c.success_metric ? `measured by ${c.success_metric}` : null, c.priority ? `${c.priority} priority` : null].filter(Boolean).join(' · ')}</span></> : null}</span>,
          c.start_date ? `${fmtDay(c.start_date)}${c.end_date && c.end_date !== c.start_date ? ` – ${fmtDay(c.end_date)}` : ''}` : '—',
          STATUS_WORD[c.status] ?? c.status,
          <span key={`${c.key}-p`}>{c.posts ? `${c.made} of ${c.posts} made, ${c.posted} posted` : 'no posts yet'}{c.next ? <><br /><span className="sa-note">next {fmtDay(c.next)}</span></> : null}</span>,
        ])}
      />
    </Card>
  );
}

/** The sheets people look things up in, folded until opened. */
function Libraries({ data }: { data: PlanningResponse }) {
  const names = ['Hooks Library', 'CTA Library', 'Hashtag Library', 'Benefit Caption Templates', 'Mocktail Candidates', 'Field Guide'];
  const sheets = names.map((n) => data.sheets.find((s) => s.name === n)).filter((s): s is PlanningSheet => Boolean(s));
  if (!sheets.length) return null;
  return (
    <Card title="Libraries">
      {sheets.map((s) => (
        <details key={s.name} style={{ marginBottom: 8 }}>
          <summary><strong>{s.name}</strong> <span className="sa-note">{s.rows.length} row{s.rows.length === 1 ? '' : 's'}</span></summary>
          <Table head={s.header} rows={s.rows} />
        </details>
      ))}
    </Card>
  );
}

const fmtMonth = (plan: string) => new Date(`${plan}-01T00:00:00Z`).toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** What one workbook did. */
function LoadedWorkbook({ name, result }: { name: string; result: ImportCalendarResponse }) {
  return (
    <div className="sa-result" role="status" style={{ marginBottom: 12 }}>
      <div className="sa-eyebrow">{name}</div>
      <div>
        {result.plan ? (
          <>
            <strong>{fmtMonth(result.plan)}</strong>: {result.rows} row{result.rows === 1 ? '' : 's'} read ({result.from} – {result.to}); {result.inserted} day{result.inserted === 1 ? '' : 's'} added, {result.updated} updated
            {result.kept.length ? `, ${result.kept.length} left as they were (started): Day ${result.kept.join(', ')}` : ''}
            {result.protectedFields.length ? `; ${result.protectedFields.length} edited field${result.protectedFields.length === 1 ? '' : 's'} kept` : ''}.{' '}
          </>
        ) : null}
        {[result.campaigns ? `${result.campaigns} campaign${result.campaigns === 1 ? '' : 's'}` : null, result.products ? `${result.products} product${result.products === 1 ? '' : 's'}` : null, result.benefits ? `${result.benefits} benefit${result.benefits === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}{result.campaigns || result.products || result.benefits ? ' loaded. ' : ''}
        {result.slogans.loaded ? `${result.slogans.loaded} slogan${result.slogans.loaded === 1 ? '' : 's'} for ${result.slogans.items} item${result.slogans.items === 1 ? '' : 's'} joined the wording bank. ` : ''}
        {result.plan ? <Link to={`/month?plan=${encodeURIComponent(result.plan)}`}>See {fmtMonth(result.plan)}</Link> : null}
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
  );
}

/** A calendar names campaigns, products and benefits, so it loads after the workbooks that define them. */
const calendarLast = (files: File[]) => [...files].sort((a, b) => Number(/calendar|content.?records/i.test(a.name)) - Number(/calendar|content.?records/i.test(b.name)));

function LoadWorkbook({ onLoaded }: { onLoaded: () => void }) {
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [start, setStart] = useState('');
  const startId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<{ name: string; result: ImportCalendarResponse }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setResults([]);
    // One at a time and in order; a workbook that is refused stops the rest, so a calendar never loads without what it names.
    for (const file of calendarLast(files)) {
      setBusy(file.name);
      try {
        const result = await importCalendar(file, start || null);
        setResults((done) => [...done, { name: file.name, result }]);
        onLoaded();
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    setBusy(null);
  }

  return (
    <Card title="Load workbooks">
      <div className="sa-note" style={{ marginBottom: 10 }}>
        Choose one workbook or several at once; they load in the right order, the calendar last. The app reads <strong>Calendar</strong> or <strong>Content Records</strong> (one row per post), <strong>Campaigns</strong>, <strong>Products</strong>, <strong>Customer Benefits</strong> and <strong>Slogans</strong>, and keeps the strategy, roadmap and library sheets shown on this page.
        The month of the first date names the plan. Loading again updates what changed; a day that has started, and any field you edited, is left alone.
      </div>
      <div className="sa-upload-row" style={{ marginBottom: 12 }}>
        <label className={`${buttonClass('secondary', 'sm')} sa-upload-pick`} htmlFor={inputId}>{files.length ? 'Change workbooks' : 'Choose workbooks (.xlsx)'}</label>
        <input id={inputId} className="sa-visually-hidden" type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy !== null} onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResults([]); setError(null); }} />
        {files.length ? <span className="sa-muted">{files.length === 1 ? files[0]!.name : `${files.length} workbooks`}</span> : null}
        <Button variant="primary" disabled={busy !== null || !files.length} onClick={() => void load()}>{busy ? `Loading ${busy}…` : 'Load'}</Button>
      </div>
      <div className="sa-upload-row" style={{ marginBottom: 12 }}>
        <label className="sa-eyebrow" htmlFor={startId}>First day</label>
        <input id={startId} className="sa-input" type="date" value={start} disabled={busy !== null} onChange={(e) => setStart(e.target.value)} style={{ width: 'auto' }} />
        <span className="sa-note">Only for a Calendar laid out by Day number without dates: the date Day 1 posts on.</span>
      </div>
      {results.map((r) => <LoadedWorkbook key={r.name} name={r.name} result={r.result} />)}
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
    </Card>
  );
}

export function Strategy() {
  const [loads, setLoads] = useState(0);
  const { data, error, loading, reload } = useApi(getPlanning, `planning-${loads}`);
  if (error) return <ErrorCard message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <Loading what="Reading the strategy" />;
  const sheet = (name: string) => data?.sheets.find((s) => s.name === name);
  const hasStrategy = Boolean(sheet('Business Vision') || sheet('Brand Positioning') || sheet('Content Pillars'));

  return (
    <>
      <PageHeader
        title="Strategy"
        subtitle={<>From your planning documents. The positioning, each series' purpose, the working rules and the hooks reach the agent with every post; the <Link to="/month">calendar</Link> holds the posts themselves.</>}
      />

      {hasStrategy ? null : (
        <div className="sa-generating" style={{ marginBottom: 12 }}>
          <span>📄</span>
          <div>The strategy shows here once your planning workbooks are loaded, using the card below.</div>
        </div>
      )}

      <SheetCard sheet={sheet('Business Vision')} />
      <SheetCard sheet={sheet('Brand Positioning')} />
      <SheetCard sheet={sheet('Content Pillars')} title="Series" />
      <Campaigns refreshKey={loads} />
      <SheetCard sheet={sheet('12-Week Roadmap')} />
      <SheetCard sheet={sheet('Annual Roadmap')} />

      {data?.products.length ? (
        <Card title="Products">
          <Table
            head={['Product', 'Category', 'Status', 'Launch', 'Series']}
            rows={data.products.map((p) => [
              <span key={p.key}><strong>{p.name}</strong>{p.notes ? <><br /><span className="sa-note">{p.notes}</span></> : null}</span>,
              p.category ?? '—', PRODUCT_WORD[p.status] ?? p.status, p.launch ?? '—', p.series ?? '—',
            ])}
          />
        </Card>
      ) : null}

      {data?.benefits.length ? (
        <Card title="Customer benefits">
          <Table
            head={['Benefit', 'What the customer reads', 'When', 'Series']}
            rows={data.benefits.map((b) => [<strong key={b.key}>{b.benefit}</strong>, b.message ?? '—', b.status ?? '—', b.series ?? '—'])}
          />
        </Card>
      ) : null}

      <SheetCard sheet={sheet('Working Rules')} />
      {data ? <Libraries data={data} /> : null}
      <LoadWorkbook onLoaded={() => setLoads((n) => n + 1)} />
    </>
  );
}
