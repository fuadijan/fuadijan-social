"use client";

import { Fragment, useRef, type KeyboardEvent, type ReactNode } from "react";

export type FjTab = {
  id: string;
  label: ReactNode;
  /** Tabs sharing a group sit together; a hairline separates one group from the next. */
  group?: string;
};

/**
 * Underline tabs for switching sections within one page. Arrow keys, Home and
 * End move between tabs (the WAI-ARIA tabs pattern); only the selected tab is
 * in the Tab order.
 */
export function Tabs({
  tabs, value, onChange, label, idPrefix = "fj-tab", className,
}: {
  tabs: FjTab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list, e.g. "Loan sections". */
  label: string;
  /** Tab ids become `${idPrefix}-${id}`; give panels aria-labelledby that. */
  idPrefix?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={["fj-tabs", className].filter(Boolean).join(" ")}>
      {tabs.map((tab, i) => (
        <Fragment key={tab.id}>
          {i > 0 && tab.group !== tabs[i - 1].group ? <span className="fj-tabs-sep" aria-hidden="true" /> : null}
          <button
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-${tab.id}`}
            aria-selected={value === tab.id}
            tabIndex={value === tab.id ? 0 : -1}
            className="fj-tab"
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
