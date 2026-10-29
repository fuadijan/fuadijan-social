"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { PlainLink } from "./links";
import type { FjLink, FjNavItem, FjNavSection } from "./types";

/**
 * One message for every app. The session cookie is shared across the
 * nutrimeals.au subdomains, so signing out anywhere signs out everywhere — and
 * naming the apps one by one went stale the moment a sixth was added.
 */
export const SIGN_OUT_EVERYWHERE =
  "Sign out of every Fuadijan app?\n\n" +
  "This ends your session in all of them, not just this one. You'll need your " +
  "password and authenticator code to get back in.";

/** Up to this many pages sit in the phone bar; any more and the last slot becomes "More". */
const PHONE_SLOTS = 5;

export function isActive(item: FjNavItem, path: string): boolean {
  if (path === item.href) return true;
  if (item.exact) return false;
  return path.startsWith(item.href.endsWith("/") ? item.href : `${item.href}/`);
}

type AppFrameProps = {
  /** The app's own name, shown under "Fuadijan" in the header. */
  appName: string;
  /** Small line above the app name. Pass null on the hub, whose name IS Fuadijan. */
  eyebrow?: string | null;
  logoSrc?: string;
  /** Where the logo/name goes. */
  homeHref?: string;
  /** The launcher. "‹ Apps" is omitted when this is unset (local dev, or the hub itself). */
  appsHref?: string | null;
  /** Grouped pages. Omit for a single-page app: no sidebar, no phone bar. */
  nav?: FjNavSection[];
  /**
   * hrefs for the phone bar, in order. When every page fits (five or fewer)
   * this is ignored and they all show; otherwise the first four listed show
   * and the fifth slot opens the full grouped list.
   */
  phoneNav?: string[];
  currentPath: string;
  Link?: FjLink;
  /** Omit to hide Sign out. */
  onSignOut?: () => void;
  /** Ask before signing out, because it ends every app's session. True behind the hub. */
  signOutEverywhere?: boolean;
  /** Extra header controls, placed before the theme switch. */
  headerExtra?: ReactNode;
  /** No padding around the page, for an app that lays out its own full-width bands. */
  flush?: boolean;
  children: ReactNode;
};

export function AppFrame({
  appName,
  eyebrow = "Fuadijan",
  logoSrc = "/fj-logo.png",
  homeHref = "/",
  appsHref,
  nav,
  phoneNav,
  currentPath,
  Link = PlainLink,
  onSignOut,
  signOutEverywhere = false,
  headerExtra,
  flush = false,
  children,
}: AppFrameProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);

  const all = nav?.flatMap((s) => s.items) ?? [];
  const fitsBar = all.length <= PHONE_SLOTS;
  const barItems = fitsBar
    ? all
    : (phoneNav ?? all.map((i) => i.href))
        .map((href) => all.find((i) => i.href === href))
        .filter((i): i is FjNavItem => Boolean(i))
        .slice(0, PHONE_SLOTS - 1);
  const currentInMore = !fitsBar && !barItems.some((i) => isActive(i, currentPath)) && all.some((i) => isActive(i, currentPath));
  const moreBadge = fitsBar ? 0 : all.filter((i) => !barItems.includes(i)).reduce((n, i) => n + (i.badge ?? 0), 0);

  // Moving to another page closes the sheet.
  useEffect(() => { setMoreOpen(false); }, [currentPath]);

  function handleSignOut() {
    if (!onSignOut) return;
    if (signOutEverywhere && !window.confirm(SIGN_OUT_EVERYWHERE)) return;
    onSignOut();
  }

  const navLink = (item: FjNavItem) => {
    const active = isActive(item, currentPath);
    return (
      <Link key={item.href} href={item.href} className="fj-nav-item" aria-current={active ? "page" : undefined}
        onClick={() => setMoreOpen(false)}>
        <span className="fj-nav-icon" aria-hidden="true">{item.icon}</span>
        <span className="fj-nav-text">{item.label}</span>
        {item.badge ? <span className="fj-badge">{item.badge}</span> : null}
      </Link>
    );
  };

  const sections = nav?.map((section) => (
    <div key={section.label} className="fj-nav-section" role="group" aria-label={section.label}>
      <div className="fj-nav-label" aria-hidden="true">{section.label}</div>
      {section.items.map(navLink)}
    </div>
  ));

  return (
    <div className={`fj-app${nav ? " fj-app--nav" : ""}`}>
      <header className="fj-header">
        <div className="fj-brand">
          <Link href={homeHref} className="fj-brand-home" title={`${appName} home`}>
            <img className="fj-brand-logo" src={logoSrc} alt="" width={32} height={32} />
            <span className="fj-brand-text">
              {eyebrow ? <span className="fj-brand-eyebrow">{eyebrow}</span> : null}
              <span className="fj-brand-name">{appName}</span>
            </span>
          </Link>
          {/* A plain <a>: the launcher is another site, not a route in this app. */}
          {appsHref ? <a className="fj-apps-link" href={appsHref}><span aria-hidden="true">‹</span> Apps</a> : null}
        </div>
        <div className="fj-header-actions">
          {headerExtra}
          <ThemeToggle />
          {onSignOut ? (
            <button type="button" className="fj-btn fj-btn--secondary fj-btn--sm" onClick={handleSignOut}
              title={signOutEverywhere ? "Sign out of every Fuadijan app" : "Sign out"}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <div className="fj-body">
        {nav ? <nav className="fj-sidenav" aria-label={`${appName} pages`}>{sections}</nav> : null}
        <main className={`fj-main${flush ? " fj-main--flush" : ""}`} id="main">{children}</main>
      </div>

      {nav ? (
        <nav className="fj-bottomnav" aria-label={`${appName} pages`}>
          {barItems.map((item) => {
            const active = isActive(item, currentPath);
            return (
              <Link key={item.href} href={item.href} className="fj-tab-item" aria-current={active ? "page" : undefined}>
                <span className="fj-tab-icon" aria-hidden="true">{item.icon}</span>
                <span className="fj-tab-label">{item.shortLabel ?? item.label}</span>
                {item.badge ? <span className="fj-badge">{item.badge}</span> : null}
              </Link>
            );
          })}
          {!fitsBar ? (
            <button ref={moreButton} type="button" className="fj-tab-item" aria-haspopup="dialog" aria-expanded={moreOpen}
              data-active={currentInMore || undefined} onClick={() => setMoreOpen(true)}>
              <span className="fj-tab-icon" aria-hidden="true">☰</span>
              <span className="fj-tab-label">More</span>
              {moreBadge ? <span className="fj-badge">{moreBadge}</span> : null}
            </button>
          ) : null}
        </nav>
      ) : null}

      {moreOpen && nav ? (
        <MoreSheet title={appName} onClose={() => { setMoreOpen(false); moreButton.current?.focus(); }}>
          {sections}
        </MoreSheet>
      ) : null}
    </div>
  );
}

function MoreSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  // Held in a ref so the effect below runs once per opening. As a dependency,
  // every parent re-render (Costing refreshes its alert count every 30s) would
  // re-run it and yank focus back to Close mid-browse.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    // Widen past the phone layout (rotate a tablet, resize a window) and the
    // sidebar takes over; the sheet would otherwise sit on top of it.
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => { if (wide.matches) close.current(); };
    wide.addEventListener("change", onWide);
    // The page behind stays put while the sheet scrolls.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <>
      <div className="fj-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="fj-sheet" role="dialog" aria-modal="true" aria-labelledby="fj-sheet-title">
        <div className="fj-sheet-head">
          <span className="fj-sheet-title" id="fj-sheet-title">{title}</span>
          <button ref={closeButton} type="button" className="fj-btn fj-btn--ghost fj-btn--sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </>
  );
}
