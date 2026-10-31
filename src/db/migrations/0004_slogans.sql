-- The slogan bank: wordings the owner keeps per menu item (or "all" for every post), loaded from the Slogans
-- sheet next to the monthly plan or added with /slogan, and offered as wording options for posts about that item.
create table slogans (
  id          serial primary key,
  item        text not null,
  item_key    text not null,
  headline    text not null,
  line        text,
  caption     text,
  source      text not null default 'sheet',
  created_at  timestamptz not null default now(),
  unique (item_key, headline)
);
create index slogans_item on slogans(item_key);
