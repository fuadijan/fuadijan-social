-- The 30 days, seeded from calendar/Fuadijan-Posts-Calendar.xlsx. day_no (row order) is the key; dates may move.
create table calendar_rows (
  id                    serial primary key,
  day_no                int not null unique,
  date                  date not null,
  slot                  text not null check (slot in ('feed', 'carousel', 'reel')),
  type                  text not null,
  dish                  text,
  theme                 text,
  caption_hint          text,
  post_time             time,
  template              text not null,
  status                text not null default 'planned' check (status in ('planned', 'photo-needed', 'ready', 'posted')),
  asset                 text,
  objective             text,
  creative_instructions text,
  on_screen_text        text,
  caption               text,
  cta                   text,
  hashtags              text,
  story_ideas           text,
  confirmation_notes    text,
  posted_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Every change after the seed. The seed never overwrites a field with a non-seed edit.
create table calendar_edits (
  id          serial primary key,
  row_id      int not null references calendar_rows(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  source      text not null check (source in ('owner-telegram', 'owner-web', 'agent', 'seed')),
  created_at  timestamptz not null default now()
);
create index calendar_edits_row on calendar_edits(row_id, field);

-- Binary content (originals, crops, cutouts, renders): Railway's disk is wiped on deploy, Postgres isn't.
create table files (
  id          text primary key,
  mime        text not null,
  bytes       bytea not null,
  size        int not null,
  created_at  timestamptz not null default now()
);

create table assets (
  id                   serial primary key,
  telegram_file_id     text,
  telegram_message_id  bigint,
  kind                 text not null check (kind in ('photo', 'document', 'video', 'text')),
  filename             text,
  mime                 text,
  caption_raw          text,
  parsed_subject       text,
  parsed_tags          text[] not null default '{}',
  parsed_note          text,
  calendar_row_id      int references calendar_rows(id),
  set_key              text,
  original_file_id     text references files(id),
  width                int,
  height               int,
  quality              jsonb,
  prepped              jsonb,
  created_at           timestamptz not null default now()
);
create index assets_row on assets(calendar_row_id);

create table renders (
  id               serial primary key,
  asset_id         int references assets(id),
  calendar_row_id  int not null references calendar_rows(id),
  template         text not null,
  format           text not null check (format in ('feed', 'story', 'carousel', 'reel-cover')),
  page             int,
  file_id          text not null references files(id),
  created_at       timestamptz not null default now()
);

create table packs (
  id                  serial primary key,
  calendar_row_id     int not null references calendar_rows(id),
  caption             text not null,
  cta                 text,
  hashtags            text[] not null default '{}',
  alt_text            text,
  story_text          text,
  facebook_caption    text,
  reel_hook           text,
  reel_on_screen_text text[],
  reel_shot_list      text[],
  canva_brief         text not null,
  caption_txt         text not null,
  reel_pack_txt       text,
  folder              text not null,
  sources             jsonb not null default '{}',
  created_at          timestamptz not null default now()
);
create index packs_row on packs(calendar_row_id, created_at desc);

create table questions (
  id                   serial primary key,
  row_id               int references calendar_rows(id),
  job_id               int,
  field                text,
  question             text not null,
  options              jsonb not null default '[]',
  answer               text,
  answered_via         text,
  asked_at             timestamptz not null default now(),
  answered_at          timestamptz,
  telegram_message_id  bigint
);
create index questions_open on questions(asked_at) where answered_at is null;

create table jobs (
  id                      serial primary key,
  asset_id                int references assets(id),
  calendar_row_id         int references calendar_rows(id),
  stage                   text not null check (stage in ('intake', 'match', 'prep', 'resolve', 'render', 'pack', 'notify', 'done')),
  status                  text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'done', 'failed')),
  state                   jsonb not null default '{}',
  waiting_on_question_id  int references questions(id),
  attempts                int not null default 0,
  last_error              text,
  run_after               timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index jobs_due on jobs(status, run_after);

create table claude_calls (
  id                 serial primary key,
  purpose            text not null,
  model              text not null,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cost_usd           numeric(10, 6),
  latency_ms         int,
  ok                 boolean not null,
  error              text,
  job_id             int,
  created_at         timestamptz not null default now()
);

create table messages_log (
  id                   serial primary key,
  direction            text not null check (direction in ('in', 'out')),
  channel              text not null,
  chat_id              text,
  telegram_message_id  bigint,
  kind                 text,
  text                 text,
  ok                   boolean not null default true,
  error                text,
  created_at           timestamptz not null default now()
);
create index messages_log_kind on messages_log(kind, created_at desc);

create table settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

insert into settings (key, value) values
  ('store_address', '129 Parramatta Road, Auburn NSW 2144'),
  ('open_hours', '5PM – 10PM'),
  ('website_url', ''),
  ('post_time_default', '18:00'),
  ('story_time_default', '12:00'),
  ('instagram_handle', '@fuadijan'),
  ('paused', 'false');
