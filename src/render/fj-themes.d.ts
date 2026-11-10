// Types for fj-themes.js. Vendored by sync.py — edit it in fuadijan-brand/themes.

export type ThemeRole = "ground" | "surface" | "text" | "muted" | "highlight" | "action";
export type ThemeColors = Record<ThemeRole, string>;
export type ThemeMode = "auto" | "on" | "off";

export interface FjTheme {
  key: string;
  name: string;
  /** auto: on between its dates; on: on now, whatever the date; off: never. */
  mode: ThemeMode;
  /** YYYY-MM-DD, inclusive. A yearly theme uses only the month and day. */
  start: string;
  end: string;
  yearly: boolean;
  colors: ThemeColors;
  updatedAt: string;
}

export const THEME_ROLES: ThemeRole[];
export const THEMES_URL: string;
export function sydneyToday(now?: Date): string;
export function cleanTheme(t: unknown): FjTheme | null;
export function covers(t: FjTheme, day: string): boolean;
export function pickTheme(themes: unknown, day: string): FjTheme | null;
export function fetchThemes(url?: string, fetchImpl?: typeof fetch): Promise<FjTheme[] | null>;
