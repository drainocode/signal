-- 2-3 sentence agent-written blurb covering what a person does and the
-- background uncovered during enrichment. Surfaced at the top of the
-- person drawer/contact detail so the user gets a quick read.

alter table people
  add column if not exists bio_summary text;
