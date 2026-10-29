import { Link } from 'react-router';
import { getMonth } from '../api';
import { Card, PageHeader } from '../components/fj';
import { Empty, ErrorCard, Loading } from '../components/States';
import { fmtDayMonth, fmtWeekRange, mondayOf, shotType, SLOT_ICON, SLOT_LABEL, subjectOf, weekdayShort } from '../format';
import type { DayView } from '../types';
import { useApi } from '../useApi';

function Tile({ day, today }: { day: DayView; today: string }) {
  const subject = day.dish ?? day.theme;
  const classes = ['sa-tile', `sa-tile--${day.status}`, day.date === today ? 'sa-tile--today' : ''].filter(Boolean).join(' ');
  const label = `Day ${day.dayNo}, ${fmtDayMonth(day.date)}, ${SLOT_LABEL[day.slot]}, ${subject ?? 'dish to choose'}, ${day.status}${day.openQuestions ? `, ${day.openQuestions} open question${day.openQuestions === 1 ? '' : 's'}` : ''}`;
  return (
    <Link to={`/day/${day.dayNo}`} className={classes} aria-label={label}>
      <div className="sa-tile-top">
        <span className="sa-tile-no fj-numeric">{day.dayNo}</span>
        <span className="sa-tile-slot" aria-hidden="true">{SLOT_ICON[day.slot]}</span>
      </div>
      <span className="sa-tile-wd">{weekdayShort(day.date)} {Number(day.date.slice(8))}</span>
      <span className={`sa-tile-text${subject ? '' : ' sa-tile-text--missing'}`}>{subject ?? 'dish to choose'}</span>
      {day.openQuestions > 0 ? <span className="sa-tile-dot" aria-hidden="true" /> : null}
    </Link>
  );
}

interface ShootGroup {
  subject: string;
  days: DayView[];
  types: string[];
}

/** Every dish and scene the month needs, by ISO week, each listed once with its days and shot types. */
function groupShoots(days: DayView[]): { monday: string; groups: ShootGroup[] }[] {
  const weeks = new Map<string, Map<string, ShootGroup>>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date) || a.dayNo - b.dayNo)) {
    const monday = mondayOf(d.date);
    const subject = subjectOf(d);
    const week = weeks.get(monday) ?? new Map<string, ShootGroup>();
    const g = week.get(subject) ?? { subject, days: [], types: [] };
    g.days.push(d);
    for (const t of shotType(d.slot, d.type)) if (!g.types.includes(t)) g.types.push(t);
    week.set(subject, g);
    weeks.set(monday, week);
  }
  return [...weeks.entries()].map(([monday, groups]) => ({ monday, groups: [...groups.values()] }));
}

export function Month() {
  const { data, error, loading, reload } = useApi(getMonth, 'month');

  return (
    <>
      <PageHeader title="Month" subtitle={data?.days.length ? `${fmtDayMonth(data.days[0]!.date)} – ${fmtDayMonth(data.days[data.days.length - 1]!.date)} · ${data.days.length} days` : 'the whole calendar'} />
      {error ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading what="Loading the month" /> : null}
      {data && data.days.length === 0 ? <Empty>The calendar is empty. Run the seed to load the 30 days.</Empty> : null}
      {data && data.days.length > 0 ? (
        <>
          <div className="sa-grid">
            {data.days.map((d) => <Tile key={d.id} day={d} today={data.today} />)}
          </div>
          <div className="sa-legend" aria-hidden="true">
            <span><span className="sa-legend-dot" style={{ background: 'var(--fj-border-strong)' }} />Planned</span>
            <span><span className="sa-legend-dot" style={{ background: 'var(--fj-accent)' }} />Photo needed</span>
            <span><span className="sa-legend-dot" style={{ background: 'var(--fj-primary)' }} />Ready</span>
            <span><span className="sa-legend-dot" style={{ background: 'var(--fj-success)' }} />Posted</span>
            <span>▢ feed · ▤ carousel · ▶ reel · dot = open question</span>
          </div>

          <h2 className="sa-section-title">What to shoot this month</h2>
          <div className="sa-stack">
            {groupShoots(data.days).map(({ monday, groups }) => (
              <Card key={monday}>
                <div className="sa-weekblock-title">{fmtWeekRange(monday)}</div>
                <ul className="sa-shootlist">
                  {groups.map((g) => (
                    <li key={g.subject}>
                      <span className="sa-shootlist-dish">{g.subject}</span>
                      <span className="sa-shootlist-days fj-numeric">
                        {g.days.length === 1 ? 'Day ' : 'Days '}
                        {g.days.map((d, i) => (
                          <span key={d.id}>
                            {i > 0 ? ', ' : ''}
                            <Link to={`/day/${d.dayNo}`}>{d.dayNo}</Link>
                          </span>
                        ))}
                      </span>
                      <span className="sa-shootlist-type">{g.types.join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          {data.settings.storeAddress || data.settings.openHours ? (
            <p className="sa-muted" style={{ marginTop: 12 }}>
              Footer on the specials: {data.settings.storeAddress ?? 'address not set'}{data.settings.openHours ? ` · Open ${data.settings.openHours}` : ''}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
