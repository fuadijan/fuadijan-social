-- What the owner's knowledge base says beyond a name and a status. A product's launch date and notes reach the
-- writer, so an upcoming dish is never written up as on sale. A benefit keeps its message and when it applies. A
-- campaign keeps how its success is measured.
alter table products add column launch text;
alter table products add column hero boolean not null default false;
alter table products add column notes text;
alter table benefits add column category text;
alter table benefits add column message text;
alter table benefits add column status text;
alter table benefits add column series text;
alter table campaigns add column success_metric text;

-- The planning documents that are not posts (src/reference.ts): each sheet kept whole, replaced when loaded again.
create table reference_sheets (
  name       text primary key,
  source     text,
  header     jsonb not null,
  rows       jsonb not null,
  loaded_at  timestamptz not null default now()
);
