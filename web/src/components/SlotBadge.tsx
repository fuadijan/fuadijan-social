import { SLOT_ICON, SLOT_LABEL } from '../format';
import type { Slot } from '../types';

export function SlotBadge({ slot }: { slot: Slot }) {
  return (
    <span className={`sa-slot sa-slot--${slot}`}>
      <span aria-hidden="true">{SLOT_ICON[slot]}</span> {SLOT_LABEL[slot]}
    </span>
  );
}
