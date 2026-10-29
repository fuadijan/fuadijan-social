import type { FjLink } from "./types";

/** Fallback link for apps without a router link of their own. */
export const PlainLink: FjLink = ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>;
