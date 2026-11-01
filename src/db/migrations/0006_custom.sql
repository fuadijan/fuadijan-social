-- Custom designs: a one-off post the owner composes in the web app (product, series, wording, style, formats).
-- It is an ordinary calendar row in the running plan, numbered from 101 so a re-seed of the month never touches
-- it; the choices live here and steer the pipeline (src/pipeline/custom.ts).
alter table calendar_rows add column custom jsonb;
