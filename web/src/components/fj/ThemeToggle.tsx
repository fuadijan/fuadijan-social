"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

/** Shared by every app, so a choice made in one carries to the next on the same device. */
export const THEME_KEY = "fj-theme";

/**
 * The tokens key off data-theme on <html>: "dark" forces dark, "system"
 * follows the OS through a prefers-color-scheme query, anything else is
 * light. The attribute is always written, never removed.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Blocking script for <head>. Runs before first paint so the saved theme is
 * on <html> immediately — a React effect would paint once in the wrong one.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem(${JSON.stringify(THEME_KEY)}) || "system";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`.trim();

function Icon({ name }: { name: Theme }) {
  const common = {
    width: 13, height: 13, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
      </svg>
    );
  }
  if (name === "dark") {
    return (
      <svg {...common}>
        <path d="M13.5 9.6A5.9 5.9 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 1.8v12.4A6.2 6.2 0 0 0 8 1.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Always light" },
  { value: "dark", label: "Dark", title: "Always dark" },
  { value: "system", label: "Auto", title: "Follow your device setting" },
];

/** Light / Dark / Auto. Labels collapse to icons below 640px. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: Theme | null = null;
    try { stored = window.localStorage.getItem(THEME_KEY) as Theme | null; } catch { /* private mode */ }
    setTheme(stored ?? "system");
    setReady(true);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    applyTheme(next);
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className="fj-theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={ready && theme === opt.value}
          aria-label={opt.label}
          title={opt.title}
          onClick={() => choose(opt.value)}
        >
          <Icon name={opt.value} />
          <span className="fj-theme-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
