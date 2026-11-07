-- What the Invite style prints for a post, when the owner set it: the date shown (YYYY-MM-DD), the time, and the
-- short message over the time ("ALL DAY", "FROM"). Null means the post's own date, the opening hours and "FROM".
alter table calendar_rows add column invite jsonb;
