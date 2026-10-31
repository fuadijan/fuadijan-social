-- Monthly plans: every calendar row belongs to a plan named after the month of the workbook's first date
-- (2026-11, 2026-12 …). Day numbers restart each month, so the unique key becomes (plan, day_no). The rows that
-- exist today become the plan of their earliest date.
alter table calendar_rows add column plan text not null default '';
update calendar_rows set plan = (select to_char(min(date), 'YYYY-MM') from calendar_rows);
alter table calendar_rows alter column plan drop default;
alter table calendar_rows drop constraint calendar_rows_day_no_key;
create unique index calendar_rows_plan_day on calendar_rows(plan, day_no);
create index calendar_rows_plan on calendar_rows(plan);
