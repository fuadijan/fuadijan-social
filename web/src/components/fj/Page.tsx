import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { PlainLink } from "./links";
import type { FjLink } from "./types";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Title in Nunito, optional subtitle and back link, actions on the right (below it on a phone). */
export function PageHeader({
  title, subtitle, actions, back, Link = PlainLink, className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  Link?: FjLink;
  className?: string;
}) {
  return (
    <div className={cx("fj-page-header", className)}>
      <div className="fj-page-heading">
        {back ? <Link href={back.href} className="fj-page-back">‹ {back.label}</Link> : null}
        <h1 className="fj-page-title">{title}</h1>
        {subtitle ? <p className="fj-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="fj-page-actions">{actions}</div> : null}
    </div>
  );
}

/** Surface, neutral border, 14px corners, soft shadow. `flush` drops the padding for lists and tables. */
export function Card({
  title, flush = false, className, children, ...rest
}: { title?: ReactNode; flush?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("fj-card", flush && "fj-card--flush", className)} {...rest}>
      {title ? <h2 className="fj-card-title">{title}</h2> : null}
      {children}
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** The button classes, for links and anything else that should look like a button. */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md", block = false) {
  return cx("fj-btn", `fj-btn--${variant}`, size === "sm" && "fj-btn--sm", block && "fj-btn--block");
}

/**
 * Primary is solid red with white text in both themes. Danger is for
 * destructive actions only, and its label must say what gets destroyed.
 */
export function Button({
  variant = "primary", size = "md", block = false, className, type = "button", ...rest
}: { variant?: ButtonVariant; size?: "md" | "sm"; block?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(buttonClass(variant, size, block), className)} {...rest} />;
}
