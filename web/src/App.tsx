import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { DEFAULT_HUB, getMe, getWeek } from './api';
import { AppFrame, type FjLink, type FjNavSection } from './components/fj';
import { ErrorCard, Loading } from './components/States';
import { useApi } from './useApi';
import { Day } from './screens/Day';
import { Month } from './screens/Month';
import { Week } from './screens/Week';
import { Create } from './screens/Create';
import { Wordings } from './screens/Wordings';
import { Strategy } from './screens/Strategy';

/** The kit's link, backed by react-router so in-app navigation stays client-side. */
const Link: FjLink = ({ href, children, ...rest }) => (
  <RouterLink to={href} {...rest}>
    {children}
  </RouterLink>
);

const NAV: FjNavSection[] = [
  {
    label: 'Calendar',
    items: [
      { href: '/', label: 'This week', shortLabel: 'Week', icon: '☀️', exact: true },
      { href: '/month', label: 'Month', icon: '🗓️' },
      { href: '/day', label: 'Day', icon: '📄' },
    ],
  },
  {
    label: 'Create',
    items: [
      { href: '/create', label: 'New design', shortLabel: 'Create', icon: '✨' },
      { href: '/wordings', label: 'Wordings', icon: '✍️' },
      { href: '/strategy', label: 'Strategy', icon: '🧭' },
    ],
  },
];

/** /day with no number: today's row, else the first of the coming week, else Day 1. */
function DayRedirect() {
  const { data, error, loading, reload } = useApi(getWeek, 'week');
  if (error) return <ErrorCard message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <Loading what="Finding today" />;
  const today = data.days.find((d) => d.date === data.today) ?? data.days[0];
  return <Navigate to={`/day/${today?.dayNo ?? 1}`} replace />;
}

export function App() {
  const { pathname } = useLocation();
  const [hub, setHub] = useState(DEFAULT_HUB);

  useEffect(() => {
    // The launcher link; on failure the default hub still works. A 401 here also sends the user to sign in.
    getMe().then((me) => me.hub && setHub(me.hub), () => undefined);
  }, []);

  return (
    <AppFrame appName="Social" appsHref={hub} nav={NAV} currentPath={pathname} Link={Link}>
      <Routes>
        <Route path="/" element={<Week />} />
        <Route path="/month" element={<Month />} />
        <Route path="/day" element={<DayRedirect />} />
        <Route path="/day/:dayNo" element={<Day />} />
        <Route path="/create" element={<Create />} />
        <Route path="/wordings" element={<Wordings />} />
        <Route path="/strategy" element={<Strategy />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppFrame>
  );
}
