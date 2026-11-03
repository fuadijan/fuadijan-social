-- Campaigns and the product roster: the two entities the workbook could not express.
--
-- A campaign (a launch, a countdown, a seasonal push) has dates, a status and a series, and the calendar rows
-- under it, so the app can say how far a launch has got. The Campaigns sheet of the monthly workbook fills it;
-- a row's `campaign` column names one by its id (CAMP001) or its name.
create table campaigns (
  id          serial primary key,
  key         text not null unique,      -- the sheet's CampaignID, lower-cased
  name        text not null,
  category    text,
  series      text,                      -- a series label ("FROM THE CHARCOAL SEA")
  template    text,                      -- the hero template that label resolves to
  start_date  date,
  end_date    date,
  status      text not null default 'planned',  -- planned | active | done
  priority    text,                      -- high | medium | low
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table calendar_rows add column campaign_id integer references campaigns(id) on delete set null;
create index calendar_rows_campaign on calendar_rows(campaign_id);

-- The product roster: every product the restaurant sells or will sell, with a status, so a post can be made
-- about a dish before it reaches the website menu. The live menu stays the source of prices and sold-out flags;
-- the roster adds what the menu does not know yet, and the series each product belongs to.
create table products (
  id          serial primary key,
  key         text not null unique,      -- the sheet's ProductID, lower-cased, or the name key
  name        text not null,
  name_key    text not null unique,      -- the name, trimmed, lower-cased, single-spaced (as the wording bank keys items)
  category    text,
  status      text not null default 'active',   -- active | coming-soon | planned | retired
  series      text,
  template    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
