import { useState } from 'react';
import { Button } from './fj';

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/**
 * Web Share with the image as a File, which opens the phone's share sheet (Instagram is one tap away).
 * Everything happens inside the tap handler; where files can't be shared it falls back to a download.
 */
export function ShareButton({ url, name, text, size = 'sm' }: { url: string; name: string; text?: string; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Couldn't fetch the image (${res.status})`);
      const blob = await res.blob();
      const type = blob.type || 'image/png';
      const ext = EXT[type] ?? '';
      const fileName = /\.[a-z0-9]{3,4}$/i.test(name) ? name : name + ext;
      const file = new File([blob], fileName, { type });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
      const data: ShareData = { files: [file], ...(text ? { text } : {}) };
      if (nav.share && nav.canShare?.(data)) {
        await nav.share(data);
        return;
      }
      // No file sharing here: save it instead.
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setNote('Sharing isn’t available here, so it was downloaded.');
    } catch (e) {
      // The user closing the share sheet is an AbortError and not worth a message.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" size={size} onClick={() => void share()} disabled={busy}>
        {busy ? 'Preparing…' : 'Share'}
      </Button>
      {note ? <span className="sa-note" role="status">{note}</span> : null}
    </>
  );
}
