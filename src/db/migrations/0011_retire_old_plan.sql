-- The new planning documents replace the old plan and the old wordings, so nothing old can duplicate or oppose them.
-- A retired post leaves every screen, reminder and command, and its plan name changes so its day number is free for
-- the new plan. Nothing is erased: the rows, their photos, designs and packs stay in the database.
alter table calendar_rows add column retired_at timestamptz;
alter table slogans add column retired_at timestamptz;

update calendar_rows set retired_at = now(), plan = 'retired-' || plan where content is null;

-- Anything still waiting on a retired post is closed, or the bot would go on asking about it. So are the photo-quality
-- questions left open since before this plan; they were never tied to a post, and an open one takes the next reply.
update questions set answered_at = now(), answer = '(closed: replaced by the new plan)', answered_via = 'system'
 where answered_at is null
   and (row_id in (select id from calendar_rows where retired_at is not null)
        or (row_id is null and field = 'quality' and asked_at < timestamptz '2026-11-03 00:00:00+11'));

update jobs set status = 'failed', last_error = 'Closed: replaced by the new plan.', updated_at = now()
 where status in ('queued', 'running', 'waiting')
   and (calendar_row_id in (select id from calendar_rows where retired_at is not null)
        or asset_id in (select id from assets where calendar_row_id in (select id from calendar_rows where retired_at is not null))
        or waiting_on_question_id in (select id from questions where answered_via = 'system'));

-- The old strategy's wordings: every one came from it, and the app no longer adds them at start-up.
update slogans set retired_at = now() where source = 'strategy';
