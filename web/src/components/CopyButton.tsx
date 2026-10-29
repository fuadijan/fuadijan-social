import { useEffect, useRef, useState } from 'react';
import { Button } from './fj';

/** Writes to the clipboard inside the tap handler (iOS Safari needs the gesture) and says "Copied" for a moment. */
export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function copy() {
    const done = (s: 'copied' | 'failed') => {
      setState(s);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState('idle'), 1600);
    };
    if (!navigator.clipboard?.writeText) {
      done('failed');
      return;
    }
    // Not awaited before the call: the writeText itself must start inside the gesture.
    navigator.clipboard.writeText(text).then(() => done('copied'), () => done('failed'));
  }

  return (
    <Button variant="secondary" size={size} onClick={copy} disabled={!text} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : label}
    </Button>
  );
}
