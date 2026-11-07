-- The clips the owner picked for a reel, in order (video asset ids). Null means none picked yet.
alter table calendar_rows add column clips jsonb;
-- A still from a clip uploaded in the web app (the browser makes it), so the clip can be recognised and picked.
-- Kept apart from `prepped`, which only photos have.
alter table assets add column still_file_id text;
