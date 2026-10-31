-- Wording options: each resolve keeps the main copy and Claude's alternative wordings; the owner picks one
-- before the design is rendered, and old sets stay available to choose from again.
create table copy_options (
  id               serial primary key,
  calendar_row_id  int not null references calendar_rows(id),
  job_id           int,
  options          jsonb not null default '[]',
  chosen           int,
  created_at       timestamptz not null default now()
);
create index copy_options_row on copy_options(calendar_row_id, created_at desc);
