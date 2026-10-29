import { STATUS_LABEL } from '../format';
import type { Status } from '../types';

/** planned = muted grey, photo-needed = saffron with dark text, ready = ember with white, posted = green with white. */
export function StatusPill({ status, size = 'md' }: { status: Status; size?: 'md' | 'sm' }) {
  return (
    <span className={`sa-pill sa-pill--${status}${size === 'sm' ? ' sa-pill--sm' : ''}`}>{STATUS_LABEL[status]}</span>
  );
}
