-- The photos the owner picked for a post's design: one, or two different dishes shown side by side, each with the
-- name printed on it. Null means the pipeline's own choice, the newest photo.
alter table calendar_rows add column design_photos jsonb;
