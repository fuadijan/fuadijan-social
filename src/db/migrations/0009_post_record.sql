-- One record per post, enough to make every platform's version from it: the Canva wording, the reel cover, the
-- Facebook and TikTok versions, the story sequence, the image prompt and the internal notes. They live on the row
-- as jsonb (null for a classic 18-column row), the finished set on the pack.
alter table calendar_rows add column content jsonb;
alter table packs add column platforms jsonb;
