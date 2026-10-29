import { useState } from 'react';
import { Link } from 'react-router';
import { answerQuestion, getWeek } from '../api';
import { Button, Card, PageHeader } from '../components/fj';
import { QuestionButtons } from '../components/QuestionButtons';
import { SlotBadge } from '../components/SlotBadge';
import { Empty, ErrorCard, Loading } from '../components/States';
import { StatusPill } from '../components/StatusPill';
import { fmtDate, fmtTime, SLOT_LABEL, weekdayShort } from '../format';
import type { DayView, ShootItem } from '../types';
import { useApi } from '../useApi';

const SHOTS_SHOWN = 3;

/** The shoot list grouped by dish, so one evening's cooking can cover several days. */
function ShootStrip({ items }: { items: ShootItem[] }) {
  const sections: { label: string; within: 7 | 14 }[] = [
    { label: 'Next 7 days', within: 7 },
    { label: 'Days 8–14', within: 14 },
  ];
  return (
    <Card className="sa-shoot" title="Shoot list">
      {items.length === 0 ? (
        <div className="sa-muted">Nothing to shoot in the next two weeks.</div>
      ) : (
        sections.map(({ label, within }) => {
          const here = items.filter((i) => i.within === within);
          if (here.length === 0) return null;
          const byDish = new Map<string, ShootItem[]>();
          for (const i of here) byDish.set(i.dish, [...(byDish.get(i.dish) ?? []), i]);
          return (
            <div key={within} className="sa-shoot-group">
              <div className="sa-eyebrow">{label}</div>
              <div className="sa-chips">
                {[...byDish.entries()].map(([dish, list]) => {
                  const first = list[0]!;
                  const kinds = [...new Set(list.map((i) => (i.slot === 'reel' ? 'clips' : 'photo')))].join(' + ');
                  const days = list.map((i) => `${weekdayShort(i.date)} ${Number(i.date.slice(8))}`).join(', ');
                  return (
                    <Link key={dish} to={`/day/${first.dayNo}`} className="sa-chip" title={list.map((i) => `Day ${i.dayNo} · ${SLOT_LABEL[i.slot]}`).join('\n')}>
                      <span className="sa-chip-dish">{dish}</span>
                      <span className="sa-chip-meta">{kinds} · {days}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}

function DayCard({ day, today, onChanged }: { day: DayView; today: string; onChanged: () => Promise<void> }) {
  const [allShots, setAllShots] = useState(false);
  const [useNote, setUseNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = day.questions ?? [];
  const dishQuestion = questions.find((q) => q.field === 'dish');
  const shots = allShots ? day.shotList : day.shotList.slice(0, SHOTS_SHOWN);
  const isToday = day.date === today;
  const needsNothing = /^nothing/i.test(day.needs);

  async function useSuggestion() {
    if (!day.suggestion) return;
    if (!dishQuestion) {
      setUseNote('The bot will ask you on the morning brief.');
      return;
    }
    setBusy(true);
    try {
      const r = await answerQuestion(dishQuestion.id, day.suggestion);
      setUseNote(r.message || 'Saved.');
      await onChanged();
    } catch (e) {
      setUseNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="sa-daycard">
      <Link to={`/day/${day.dayNo}`} className="sa-daycard-head" aria-label={`${fmtDate(day.date)}, ${day.title}`}>
        <span className={`sa-daycard-date fj-numeric${isToday ? ' sa-daycard-today' : ''}`}>{fmtDate(day.date)}</span>
        <SlotBadge slot={day.slot} />
        <span className="sa-daycard-spacer" />
        <StatusPill status={day.status} />
        <span className="sa-daycard-chev" aria-hidden="true">›</span>
      </Link>
      <div className="sa-daycard-body">
        {day.dish && !day.needsDish ? (
          <div className="sa-dish">{day.dish}</div>
        ) : (
          <>
            <div className="sa-dish sa-dish--missing">Dish to choose{day.theme ? ` · ${day.theme}` : ''}</div>
            {day.suggestion ? (
              <div className="sa-suggest">
                <span>Suggestion: <strong>{day.suggestion}</strong></span>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void useSuggestion()}>Use this</Button>
                {useNote ? <span className="sa-note">{useNote}</span> : null}
              </div>
            ) : null}
          </>
        )}
        {!day.dish && day.theme ? null : day.theme && day.dish ? <div className="sa-muted">{day.theme}</div> : null}
        <div className={`sa-needs${needsNothing ? ' sa-needs--clear' : ''}`}>{day.needs}</div>
        {day.shotList.length > 0 ? (
          <div>
            <div className="sa-eyebrow">Shoot</div>
            <ol className="sa-shots">
              {shots.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {day.shotList.length > SHOTS_SHOWN ? (
              <button type="button" className="sa-more" onClick={() => setAllShots((v) => !v)}>
                {allShots ? 'Show fewer' : `+${day.shotList.length - SHOTS_SHOWN} more`}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="sa-meta">
          <span>Post at <span className="fj-numeric">{fmtTime(day.postTime)}</span></span>
          <span>{day.series}</span>
          {day.received.photos || day.received.clips ? (
            <span className="fj-numeric">
              {day.received.photos ? `${day.received.photos} photo${day.received.photos === 1 ? '' : 's'}` : ''}
              {day.received.photos && day.received.clips ? ', ' : ''}
              {day.received.clips ? `${day.received.clips} clip${day.received.clips === 1 ? '' : 's'}` : ''} received
            </span>
          ) : null}
        </div>
        <QuestionButtons questions={questions} onAnswered={onChanged} />
      </div>
    </Card>
  );
}

export function Week() {
  const { data, error, loading, reload } = useApi(getWeek, 'week');

  return (
    <>
      <PageHeader title="This week" subtitle="the next 7 days" />
      {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading what="Loading the week" /> : null}
      {data ? (
        <>
          {error ? <ErrorCard message={error} onRetry={() => void reload()} /> : null}
          <ShootStrip items={data.shootList} />
          {data.days.length === 0 ? (
            <Empty>No calendar rows in the next 7 days. The calendar runs 3 Nov – 2 Dec.</Empty>
          ) : (
            <div className="sa-stack">
              {data.days.map((d) => <DayCard key={d.id} day={d} today={data.today} onChanged={reload} />)}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
