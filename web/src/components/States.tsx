import { Button, Card } from './fj';

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <Card className="sa-state" aria-busy="true">
      <span className="sa-spinner" aria-hidden="true" />
      <span>{what}…</span>
    </Card>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="sa-state sa-state--error" role="alert">
      <div>
        <strong>Something went wrong.</strong>
        <div className="sa-state-message">{message}</div>
      </div>
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : null}
    </Card>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="sa-state sa-state--empty">{children}</Card>;
}
