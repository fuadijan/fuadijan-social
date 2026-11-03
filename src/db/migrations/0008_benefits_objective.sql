-- A campaign states what it is for; a post can carry a customer benefit instead of (or beside) a dish.
--
-- Customer benefits are the owner's own list (plenty of parking, fully air-conditioned dining, …): the one thing
-- the writer may say about an improvement. A Benefits sheet fills the table; a calendar row names one by its id
-- (BEN001) or in words, and the resolved sentence is kept on the row so the writer reads it as the brief.
alter table campaigns add column objective text;

create table benefits (
  id          serial primary key,
  key         text not null unique,      -- the sheet's BenefitID, lower-cased, or the sentence's key
  benefit     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table calendar_rows add column benefit text;
