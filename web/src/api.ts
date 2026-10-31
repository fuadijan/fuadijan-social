/**
 * Same-origin JSON client. A 401 means no hub session: the page goes to the hub's login and comes back here.
 * A 403 carrying `hub` means signed in but not granted Social: the page goes to the hub.
 */
import type { DayResponse, EditableField, Me, MonthResponse, StatusResponse, UploadResponse, WeekResponse } from './types';

export const DEFAULT_HUB = 'https://apps.nutrimeals.au';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  ok?: boolean;
  error?: string;
  login?: string;
  hub?: string;
}

function withCallback(login: string): string {
  const back = encodeURIComponent(window.location.href);
  return `${login}${login.includes('?') ? '&' : '?'}callbackUrl=${back}`;
}

/** Never resolves: the browser is leaving the page, so the screen stays on its loading state. */
function leaving<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  // A FormData body sets its own multipart content-type (with the boundary); never override it.
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (init?.body && !isForm && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  } catch {
    throw new ApiError('No connection. Check the network and try again.', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const body = (json ?? {}) as ErrorBody;
  if (res.status === 401) {
    window.location.assign(withCallback(body.login ?? `${DEFAULT_HUB}/login`));
    return leaving<T>();
  }
  if (res.status === 403 && body.hub) {
    window.location.assign(body.hub);
    return leaving<T>();
  }
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText || 'Request failed'}`, res.status);
  return json as T;
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(payload) });
}

export const getMe = () => apiFetch<Me>('/api/me');
export const getWeek = () => apiFetch<WeekResponse>('/api/week');
export const getMonth = (plan?: string | null) => apiFetch<MonthResponse>(plan ? `/api/month?plan=${encodeURIComponent(plan)}` : '/api/month');
export const getDay = (dayNo: number) => apiFetch<DayResponse>(`/api/day/${dayNo}`);
export const getStatus = () => apiFetch<StatusResponse>('/api/status');

export const answerQuestion = (id: number, answer: string) => post<{ ok: true; message: string }>(`/api/questions/${id}/answer`, { answer });
export const chooseWording = (dayNo: number, setId: number, index: number) => post<{ ok: true; message: string }>(`/api/rows/${dayNo}/wording`, { setId, index });
export const markPosted = (dayNo: number) => post<{ ok: true }>(`/api/rows/${dayNo}/status`, { status: 'posted' });
export const skipDay = (dayNo: number, mode: 'push-all' | 'just-this') => post<{ ok: true; date: string }>(`/api/rows/${dayNo}/skip`, { mode });
export const pushDay = (dayNo: number, days: number) => post<{ ok: true; date: string }>(`/api/rows/${dayNo}/push`, { days });

/** Cut 2: edit one text field of a row. An empty value clears it; `redo` also queues a rebuild of the copy and pack. */
export const patchRow = (dayNo: number, field: EditableField, value: string, redo = false) =>
  apiFetch<{ ok: true }>(`/api/rows/${dayNo}`, { method: 'PATCH', body: JSON.stringify({ field, value, redo }) });

/**
 * Cut 2: photos or clips from the phone, through the same intake pipeline as Telegram. The caption follows the
 * Telegram convention ("dish -- note #tags"); empty means the server uses the day's dish and adds #dayN.
 */
export function uploadToDay(dayNo: number, files: File[], caption: string): Promise<UploadResponse> {
  const form = new FormData();
  for (const f of files) form.append('file', f, f.name);
  form.append('caption', caption);
  return apiFetch<UploadResponse>(`/api/rows/${dayNo}/upload`, { method: 'POST', body: form });
}

/** Image bytes for a stored file id. */
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;
/** The pack's text files. */
export const packTextUrl = (dayNo: number, name: 'caption.txt' | 'canva-brief.txt' | 'reel-pack.txt') => `/api/packs/${dayNo}/${name}`;
