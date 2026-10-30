-- What Claude read in the photo (composition, clutter, where the dish sits), kept on the asset so a /redo can
-- re-crop without re-reading the photo.
alter table assets add column match jsonb;
