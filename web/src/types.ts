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
  posted_at: string | null;
  updated_at: string;
}

export type CropName = '4x5' | '9x16' | '1x1';
/** Crop name → file id. */
export type Crops = Record<string, string | undefined>;

export interface Asset {
  id: number;
  kind: 'photo' | 'document' | 'video' | 'text';
  caption: string | null;
  thumb: string | null; // file id
  crops: Crops | null;
  createdAt: string;
  quality: unknown;
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

export interface Edit {
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
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

export interface MonthResponse {
  today: string;
  days: DayView[];
  settings: { storeAddress: string | null; openHours: string | null };
}

export interface DayResponse extends DayView {
  row: Row;
  questions: Question[];
  assets: Asset[];
  pack: Pack | null;
  renders: Render[];
  edits: Edit[];
  settings: { storeAddress: string | null; openHours: string | null; websiteUrl: string | null; postTimeDefault: string | null };
}

export interface StatusResponse {
  text: string;
}
