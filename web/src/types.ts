/** The JSON shapes src/api/routes.ts returns. That file is the truth; keep these in step with it. */

export type Slot = 'feed' | 'carousel' | 'reel';
export type Status = 'planned' | 'photo-needed' | 'ready' | 'posted';

export interface Me {
  user: { name: string; email: string | null; via: 'hub' | 'dev' } | null;
  hub: string;
  webUrl: string;
}

export interface QuestionOption {
  key: string;
  label: string;
  value: string;
}

export interface Question {
  id: number;
  rowId: number | null;
  field: string;
  question: string;
  options: QuestionOption[];
  askedAt: string;
}

export interface DayView {
  id: number;
  dayNo: number;
  date: string; // YYYY-MM-DD
  slot: Slot;
  type: string;
  dish: string | null;
  theme: string | null;
  status: Status;
  template: string;
  postTime: string | null; // HH:MM or HH:MM:SS
  title: string; // "Day 12 — Chicken Tikka Snack Pack"
  series: string; // "FROM THE FIRE" …
  needs: string; // plain words
  needsPhoto: boolean;
  needsClips: boolean;
  needsDish: boolean;
  confirmations: number;
  received: { photos: number; clips: number };
  openQuestions: number;
  suggestion: string | null;
  placeholders: string[];
  shotList: string[];
  /** The week endpoint attaches the row's open questions. */
  questions?: Question[];
}

export interface Row {
  id: number;
  day_no: number;
  date: string;
  slot: Slot;
  type: string;
  dish: string | null;
  theme: string | null;
  caption_hint: string | null;
  post_time: string | null;
  template: string;
  status: Status;
  asset: string | null;
  objective: string | null;
  creative_instructions: string | null;
  on_screen_text: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: string | null; // space separated
  story_ideas: string | null;
  confirmation_notes: string | null;
  /** Set on a one-off post made in the Create flow. */
  custom: CustomSpec | null;
  posted_at: string | null;
  updated_at: string;
}

export type CropName = '4x5' | '9x16' | '1x1';
/** Crop name → file id. */
export type Crops = Record<string, string | undefined>;

/** What src/images/prep.ts measured on an incoming photo. Anything but `ok` made the pipeline ask for a resend. */
export interface Quality {
  width: number;
  height: number;
  longEdge: number;
  luminance: number;
  laplacian: number;
  verdict: 'ok' | 'small' | 'dark' | 'blurry';
}

export interface Asset {
  id: number;
  kind: 'photo' | 'document' | 'video' | 'text';
  caption: string | null;
  thumb: string | null; // file id
  crops: Crops | null;
  createdAt: string;
  quality: Quality | null;
}

export interface Pack {
  id: number;
  caption: string;
  cta: string | null;
  hashtags: string[];
  alt_text: string | null;
  story_text: string | null;
  facebook_caption: string | null;
  reel_pack_txt: string | null;
  canva_brief: string;
  caption_txt: string;
  folder: string;
  crops: Crops;
  created_at: string;
}

export interface Render {
  id: number;
  format: 'feed' | 'story' | 'carousel' | 'reel-cover';
  page: number | null;
  file_id: string;
}

/** The row columns PATCH /api/rows/:dayNo accepts (EDITABLE_FIELDS in src/calendar/rows.ts). */
export type EditableField =
  | 'dish' | 'caption' | 'cta' | 'hashtags' | 'story_ideas' | 'post_time'
  | 'on_screen_text' | 'creative_instructions' | 'theme' | 'objective' | 'confirmation_notes';

/** Who made an edit: the owner from the web app or Telegram, the agent, or the seed import. */
export type EditSource = 'owner-web' | 'owner-telegram' | 'agent' | 'seed' | string;

export interface Edit {
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: EditSource;
  created_at: string;
}

export interface UploadResponse {
  ok: true;
  assetIds: number[];
  /** The caption the server filed the photos under (the dish, or yours, always with #dayN). */
  caption: string;
}

export interface ShootItem {
  dayNo: number;
  date: string;
  dish: string;
  slot: Slot;
  within: 7 | 14;
}

export interface WeekResponse {
  today: string;
  days: DayView[];
  shootList: ShootItem[];
}

export interface PlanInfo { plan: string; first: string; last: string; rows: number }

export interface MonthResponse {
  today: string;
  /** The plan shown (YYYY-MM) and every plan loaded, oldest first. */
  plan: string | null;
  plans: PlanInfo[];
  days: DayView[];
  settings: { storeAddress: string | null; openHours: string | null };
}

export interface WordingOption { name: string; headline: string; line: string; caption: string }
export interface WordingSet { id: number; options: WordingOption[]; chosen: number | null; createdAt: string }

export interface DayResponse extends DayView {
  row: Row;
  questions: Question[];
  wording: WordingSet[];
  wordingWaiting: boolean;
  assets: Asset[];
  pack: Pack | null;
  renders: Render[];
  edits: Edit[];
  settings: { storeAddress: string | null; openHours: string | null; websiteUrl: string | null; postTimeDefault: string | null };
}

export interface StatusResponse {
  text: string;
}

// ─── the Create flow (custom designs) and the wording bank ──────────────────────────────────────────────

export type StyleKey = 'band' | 'split' | 'poster' | 'flat' | 'invite';
export type CustomFormat = 'feed' | 'story';

/** What the owner chose for a one-off post; stored on the row (`row.custom`). */
export interface CustomSpec {
  product: string;
  style: StyleKey | 'auto';
  formats: CustomFormat[];
  wording: { headline: string; line: string; caption: string } | null;
  sloganId: number | null;
}

export interface Wording {
  id: number;
  item: string;
  /** Lower-case key; `all` = every post. */
  itemKey: string;
  headline: string;
  line: string | null;
  caption: string | null;
  source: string;
}

export interface WordingGroup { item: string; itemKey: string; wordings: Wording[] }
export interface WordingsResponse { groups: WordingGroup[]; products: string[] }
export interface WordingInput { headline: string; line: string; caption: string }

export interface RecentPhoto {
  assetId: number;
  thumb: string | null; // file id
  caption: string | null;
  dayNo: number | null;
  dish: string | null;
  createdAt: string;
}

export interface CreateOptions {
  today: string;
  postTimeDefault: string;
  products: { name: string; category: string | null; wordings: number }[];
  templates: { template: string; label: string; footer: 'brand' | 'address'; style: StyleKey | null }[];
  styles: { key: StyleKey; name: string; blurb: string; needsCutout: boolean; story: boolean }[];
  photos: RecentPhoto[];
}

export interface CreateRequest {
  product: string;
  template: string;
  style: StyleKey | 'auto';
  formats: CustomFormat[];
  wording: WordingInput | null;
  sloganId: number | null;
  date: string;
  postTime: string | null;
  assetId: number | null;
}

export interface CreateResponse { ok: true; dayNo: number; date: string; plan: string }

// ─── the marketing strategy (brand/strategy.json) ──────────────────────────────────────────────────────────

export interface StrategyPoster { headline: string; line: string; visual: string }

export interface Strategy {
  name: string;
  version: number;
  source?: string;
  positioning: string;
  descriptor: string;
  oneIdea: string;
  knownFor: { primary: string; secondary: string; trust: string };
  taglines: { text: string; use: string }[];
  voice: { do: string[]; dont: string[] };
  signatureDishes: { dish: string; role: string; why: string }[];
  segments: { segment: string; want: string; message: string; channels: string }[];
  platforms: { platform: string; job: string; cadence: string; share: string }[];
  captionTemplates: Record<string, string>;
  hashtagSets: Record<string, { when: string; tags: string[] }>;
  rituals: { name: string; item: string; when: string; weekday: number | null; rule?: string; offer: string; measure: string }[];
  events: { name: string; item: string; from: string; to: string; approximate?: boolean; quarterly?: boolean; offers: string; poster: StrategyPoster }[];
  posters: (StrategyPoster & { name: string; item: string })[];
  captions: { name: string; item: string; headline: string; line: string; caption: string; hashtags: string }[];
  photoPrompts: string[];
  photoRules: string[];
  reelIdeas: { concept: string; hook: string; shots: string; length: string }[];
  visual: { palette: string; rules: string[] };
  kpis: { layer: string; metric: string; where: string; target: string }[];
  monthlyLoop: string[];
  plan: {
    from: string;
    to: string;
    weeks: { week: number; dates: string; theme: string; goal: string }[];
    days: { date: string; format: string; idea: string; booster: string; dish: string | null; template: string; sets: string[]; event?: string }[];
  };
}

export interface StrategyResponse { today: string; strategy: Strategy; todayRituals: string[]; runningEvents: string[]; wordingsInBank: number }
