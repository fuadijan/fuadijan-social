import type { ComponentType, ReactNode } from "react";

/** One page in an app's navigation. */
export type FjNavItem = {
  href: string;
  label: string;
  /** Emoji or a single glyph; shown in the sidebar and the phone bar. */
  icon: string;
  /** Shorter label for the phone bar, where ~70px is all a tab gets. */
  shortLabel?: string;
  /** A count worth interrupting for (e.g. unread alerts). 0/null hides it. */
  badge?: number | null;
  /** Match this path only, not its children. Needed for a root like "/dashboard". */
  exact?: boolean;
};

/** A labelled group of pages — the sidebar's sections and the More sheet's. */
export type FjNavSection = { label: string; items: FjNavItem[] };

export type FjLinkProps = {
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
  title?: string;
  "aria-current"?: "page";
};

/**
 * The app's own link component — next/link in the Next.js apps, a thin
 * wrapper around react-router's Link in Payroll — so in-app navigation stays
 * client-side. Defaults to a plain <a>.
 */
export type FjLink = ComponentType<FjLinkProps>;
