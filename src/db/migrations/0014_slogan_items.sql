-- A wording can belong to any number of items, so one change reaches all of them and the owner can link or unlink it.
-- slogans.item stays as the item it was first added for; what it applies to is here.
create table slogan_items (
  slogan_id integer not null references slogans(id) on delete cascade,
  item      text not null,
  item_key  text not null,
  primary key (slogan_id, item_key)
);
create index slogan_items_key on slogan_items(item_key);

insert into slogan_items (slogan_id, item, item_key) select id, item, item_key from slogans;
