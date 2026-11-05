-- The owner's edits to a library row (a hook, a CTA, a hashtag set, a benefit caption), so loading the same workbook
-- again leaves them. The key is the row as the workbook wrote it, the value the row as the owner changed it.
alter table reference_sheets add column owner_rows jsonb not null default '{}'::jsonb;
