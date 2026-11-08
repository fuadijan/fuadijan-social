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
  /** The campaign the post belongs to, when the workbook named one. */
  campaign: { key: string; name: string; status: CampaignStatus } | null;
  /** A customer benefit the post is about, beside or instead of a dish. */
  benefit: string | null;
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
  /** The photos the owner picked for the design; null means the newest. */
  design_photos: { assetId: number; name: string | null }[] | null;
  /** The calendar record's own words (Canva Headline, Hook, Reel Cover Text …), when the workbook had one. */
  content?: Record<string, string | null> | null;
  /** What the Invite style prints, when the owner set it. */
  invite?: InviteDetails | null;
  /** The clips picked for a reel, in order (video asset ids). */
  clips?: number[] | null;
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
  /** The file's name as uploaded (a clip's name from the phone). */
  filename?: string | null;
  /** A photo's thumbnail, or a clip's still made in the browser when it was uploaded. */
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

/** The finished texts of a post that PATCH /api/rows/:dayNo/text accepts (POST_TEXT_FIELDS in src/pipeline/post-text.ts). */
export type PostTextField =
  | 'caption' | 'cta' | 'hashtags' | 'alt_text' | 'story_text'
  | 'facebook_caption' | 'facebook_cta' | 'facebook_hashtags'
  | 'tiktok_opening' | 'tiktok_hook' | 'tiktok_script' | 'tiktok_caption' | 'tiktok_cta' | 'tiktok_hashtags'
  | 'story_sequence' | 'reel_cover_text' | 'canva_headline' | 'canva_subheading' | 'hook';

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

export interface WordingOption { name: string; headline: string; line: string; caption: string; owner?: boolean }
export interface WordingSet { id: number; options: WordingOption[]; chosen: number | null; createdAt: string }

/** Every platform's version of one post, from one record. */
export interface PlatformVersions {
  instagram: { caption: string; cta: string; hashtags: string[] };
  facebook: { caption: string; cta: string; hashtags: string[] };
  tiktok: { opening: string; hook: string; script: string; caption: string; cta: string; hashtags: string[] };
  stories: string[];
  reel_cover: string;
  canva: { headline: string; subheading: string };
  image_prompt: string;
  photo_edit_prompt: string;
  benefit: string;
  customer_message: string;
  notes: { platform: string; goal: string; funnel: string; kpi: string; priority: string; objective: string };
}

export interface DayResponse extends DayView {
  row: Row;
  canPair: boolean;
  questions: Question[];
  wording: WordingSet[];
  wordingWaiting: boolean;
  platforms: PlatformVersions | null;
  assets: Asset[];
  pack: Pack | null;
  renders: Render[];
  edits: Edit[];
  settings: { storeAddress: string | null; openHours: string | null; websiteUrl: string | null; postTimeDefault: string | null; brandLine?: string };
}

export interface StatusResponse {
  text: string;
}

// ─── the Create flow (custom designs) and the wording bank ──────────────────────────────────────────────

export type StyleKey = 'band' | 'split' | 'poster' | 'flat' | 'invite' | 'arch' | 'countdown' | 'ribbon' | 'jaali' | 'deal' | 'menu';
export type CustomFormat = 'feed' | 'story' | 'reel';

/**
 * A look's own details: the date (the invite's day, the countdown's big day; YYYY-MM-DD), the time and the short
 * message (over the invite's time, under the count, on the ribbon, over the price); the deal's price; the menu's
 * dishes; and for any look the text side and the italic line over the title (its colour and its own words).
 */
export interface InviteDetails {
  /** The look picked on the day's page, kept with its details (the server adds it). */
  style?: StyleKey;
  date: string | null; time: string; message: string;
  price?: string; menu?: { name: string; price: string }[];
  side?: 'left' | 'right'; accent?: 'none' | 'gold' | 'orange'; lead?: string;
}

/** What the owner chose for a one-off post; stored on the row (`row.custom`). */
export interface CustomSpec {
  product: string;
  style: StyleKey | 'auto';
  formats: CustomFormat[];
  wording: { headline: string; line: string; caption: string } | null;
  sloganId: number | null;
  cta?: string | null;
  hashtags?: string | null;
  hook?: string | null;
  onScreen?: string[] | null;
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
  /** Every product or group this wording is linked to; `products` says how many a group holds. */
  items: { item: string; itemKey: string; products?: number }[];
  /** The posts it reaches. */
  posts: PostRef[];
}

/** A post under a wording; `inUse` when it is the wording that post is using. */
export interface PostRef { dayNo: number; date: string; status: Status; inUse?: boolean }
/** One post's own words, as the Captions tab lists them. */
export interface PostWording {
  dayNo: number;
  date: string;
  status: Status;
  slot: Slot;
  title: string;
  series: string;
  items: string[];
  headline: string;
  line: string;
  caption: string;
  cta: string;
  hashtags: string;
  platforms: PlatformVersions | null;
  set: WordingSet | null;
  waiting: boolean;
  /** The reusable caption with these words, once they are saved as one. */
  reusableId?: number;
}
/** A planning library of wordings; `belongsTo` says what a group's value stands for, `posts` what uses each row, `reusable` the reusable caption with its words. */
export interface WordingLibrary { name: string; title: string; header: string[]; rows: string[][]; groupColumn: number; belongsTo: Record<string, string>; posts: Record<number, PostRef[]>; reusable: Record<number, number> }
export interface WordingsResponse { reusable: Wording[]; posts: PostWording[]; libraries: WordingLibrary[]; products: string[]; groups: string[] }
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
  /** The footer's two texts: the brand line and the store address. */
  footers: { brand: string; address: string };
  /** `template` is the series suggested for the product (its menu category: drinks pour, sweets save room, karahis from the karahi). */
  products: { name: string; category: string | null; series: string | null; status: string; wordings: number; template: string }[];
  templates: { template: string; label: string; footer: 'brand' | 'address'; style: StyleKey | null }[];
  styles: { key: StyleKey; name: string; blurb: string; needsCutout: boolean; story: boolean; occasion: boolean }[];
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
  cta?: string | null;
  hashtags?: string | null;
  hook?: string | null;
  onScreen?: string[] | null;
  invite?: InviteDetails | null;
}

/** The builder's real preview (POST /api/preview): the words drawn on the photo, nothing stored. */
export interface PreviewRequest {
  template: string;
  kind: 'post' | 'reel';
  label: string;
  headline: string;
  line: string;
  hook: string;
  style: StyleKey | 'auto';
  dish: string | null;
  date: string | null;
  photo: { assetId: number } | { dayNo: number } | { dataUrl: string } | { blank: true } | null;
  invite?: InviteDetails | null;
}
export interface PreviewResponse { ok: true; images: { format: 'feed' | 'story' | 'reel-cover'; dataUrl: string }[]; style: StyleKey; note: string | null }

/** The parts of a post the builder saves together (POST_PARTS in src/pipeline/post-text.ts). */
export type PostPartField = 'canva_subheading' | 'canva_headline' | 'hook' | 'reel_cover_text' | 'on_screen_text' | 'caption' | 'cta' | 'hashtags';

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

export interface SeedPlanResponse { ok: true; plan: string | null; inserted: number; updated: number; protectedFields: { day_no: number; field: string }[]; kept: number[] }

/** A month's workbook loaded from the browser: the seed's result plus what was read. */
export interface ImportCalendarResponse extends SeedPlanResponse { rows: number; from: string | null; to: string | null; campaigns: number; products: number; benefits: number; unread: string[]; unreadSheets: string[]; reference: string[]; slogans: { loaded: number; items: number }; placeholders: string[] }

export type CampaignStatus = 'planned' | 'active' | 'done';

/** A campaign and how far its posts have got; several run at once. */
export interface CampaignProgress {
  id: number;
  key: string;
  name: string;
  category: string | null;
  objective: string | null;
  success_metric: string | null;
  series: string | null;
  template: string | null;
  start_date: string | null;
  end_date: string | null;
  status: CampaignStatus;
  priority: string | null;
  posts: number;
  made: number;
  posted: number;
  next: string | null;
}

/** A planning sheet kept whole: strategy, roadmap or a library. */
export interface PlanningSheet { name: string; source: string | null; header: string[]; rows: string[][] }
export interface PlanningResponse {
  sheets: PlanningSheet[];
  products: { key: string; name: string; category: string | null; status: string; launch: string | null; series: string | null; notes: string | null }[];
  benefits: { key: string; benefit: string; message: string | null; status: string | null; series: string | null }[];
}

export interface CampaignsResponse { campaigns: CampaignProgress[] }

export interface StrategyResponse { today: string; strategy: Strategy; todayRituals: string[]; runningEvents: string[]; wordingsInBank: number }
