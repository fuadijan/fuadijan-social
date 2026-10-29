import { useEffect, useId, useRef, useState } from 'react';
import { uploadToDay } from '../api';
import { Button, buttonClass } from './fj';
import type { DayResponse } from '../types';

const MAX_FILES = 10; // @fastify/multipart limits in src/server.ts
const MAX_BYTES = 25 * 1024 * 1024;
const POLL_MS = 4_000;
const POLL_FOR_MS = 60_000;

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The Telegram caption convention, pre-filled the way the server would fill it: the first dish, lower-case, then #dayN. */
export function defaultCaption(d: DayResponse): string {
  const dish = d.row.dish?.trim();
  const base = dish && !dish.startsWith('[') ? (dish.split(',')[0] ?? dish).trim().toLowerCase() : (d.row.theme ?? 'photo').trim().toLowerCase();
  return `${base} #day${d.dayNo}`;
}

interface Watch {
  startedAt: number;
  assets: number;
  packKey: string | null;
  questions: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'processing'; caption: string; count: number }
  | { kind: 'done'; count: number; asked: boolean; packChanged: boolean }
  | { kind: 'slow'; count: number };

const packKeyOf = (d: DayResponse) => (d.pack ? `${d.pack.id}:${d.pack.created_at}` : null);

/**
 * Photos and clips from the phone, into the same intake pipeline as Telegram. After the upload the day is refetched
 * every 4 s for up to a minute, until the new asset shows and the pack has changed or a question has been raised.
 */
export function UploadPhotos({ d, onChanged }: { d: DayResponse; onChanged: () => void | Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState(() => defaultCaption(d));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const captionId = useId();

  // Poll while a watch is open.
  useEffect(() => {
    if (!watch) return;
    const id = window.setInterval(() => void onChanged(), POLL_MS);
    return () => window.clearInterval(id);
  }, [watch, onChanged]);

  // Each refetch: has the pipeline caught up?
  useEffect(() => {
    if (!watch) return;
    const grew = d.assets.length > watch.assets;
    const packChanged = packKeyOf(d) !== watch.packKey;
    const asked = d.questions.length > watch.questions;
    const expired = Date.now() - watch.startedAt > POLL_FOR_MS;
    if ((grew && (packChanged || asked)) || expired) {
      setWatch(null);
      const count = Math.max(0, d.assets.length - watch.assets);
      setPhase(grew ? { kind: 'done', count, asked, packChanged } : { kind: 'slow', count });
    }
  }, [d, watch]);

  const busy = phase.kind === 'uploading';
  const tooMany = files.length > MAX_FILES;
  const tooBig = files.filter((f) => f.size > MAX_BYTES);
  const canUpload = files.length > 0 && !tooMany && tooBig.length === 0 && !busy;

  function pick(list: FileList | null) {
    setFiles(list ? Array.from(list) : []);
    setError(null);
    if (phase.kind !== 'uploading') setPhase({ kind: 'idle' });
  }

  async function upload() {
    if (!canUpload) return;
    setPhase({ kind: 'uploading' });
    setError(null);
    try {
      const r = await uploadToDay(d.dayNo, files, caption.trim());
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      setPhase({ kind: 'processing', caption: r.caption, count: r.assetIds.length });
      setWatch({ startedAt: Date.now(), assets: d.assets.length, packKey: packKeyOf(d), questions: d.questions.length });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ kind: 'idle' });
    }
  }

  return (
    <div className="sa-upload">
      <div className="sa-upload-row">
        {/* The input stays in the tree (hidden visually) so the picker opens from the label. capture is not forced, so the gallery is offered too. */}
        <label className={`${buttonClass('secondary', 'sm')} sa-upload-pick`} htmlFor={fileId}>
          {files.length ? 'Change files' : 'Choose photos or clips'}
        </label>
        <input ref={inputRef} id={fileId} className="sa-visually-hidden" type="file" accept="image/*,video/*" multiple disabled={busy} onChange={(e) => pick(e.target.files)} />
        {files.length > 0 ? <span className="sa-muted">{files.length} selected</span> : null}
      </div>
      {files.length > 0 ? (
        <ul className="sa-filelist">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className={f.size > MAX_BYTES ? 'sa-filelist--bad' : undefined}>
              <span className="sa-filelist-name">{f.name}</span>
              <span className="sa-filelist-size fj-numeric">{fmtSize(f.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tooMany ? <div className="sa-result sa-result--error">Up to {MAX_FILES} files at a time.</div> : null}
      {tooBig.length > 0 ? <div className="sa-result sa-result--error">Each file must be under 25 MB ({tooBig.map((f) => f.name).join(', ')}).</div> : null}
      <div className="sa-upload-caption">
        <label className="sa-eyebrow" htmlFor={captionId}>Caption</label>
        <input id={captionId} className="sa-input" type="text" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={busy} autoComplete="off" autoCapitalize="none" />
        <div className="sa-note">Same convention as Telegram: dish -- note #tags</div>
      </div>
      <div className="sa-actions">
        <Button variant="primary" disabled={!canUpload} onClick={() => void upload()}>
          {busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
        </Button>
        {busy ? <span className="sa-spinner" aria-hidden="true" /> : null}
      </div>
      {error ? <div className="sa-result sa-result--error" role="alert">{error}</div> : null}
      {phase.kind === 'processing' ? (
        <div className="sa-result sa-upload-status" role="status">
          <span className="sa-spinner" aria-hidden="true" />
          <span>
            Filed as <strong>{phase.caption}</strong>. Processing… the pack will update in a moment.
          </span>
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <div className="sa-result" role="status">
          {phase.count === 1 ? 'Photo received.' : `${phase.count} files received.`}{' '}
          {phase.asked ? 'The pipeline has a question — see Confirm above.' : phase.packChanged ? 'The pack is updated below.' : 'The pack will follow when the pipeline is done.'}
        </div>
      ) : null}
      {phase.kind === 'slow' ? <div className="sa-result" role="status">Still processing. It will show here on the next refresh.</div> : null}
    </div>
  );
}
