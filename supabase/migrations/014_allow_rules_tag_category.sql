-- Allow "Rules" as a valid tag category.

ALTER TABLE tags
  DROP CONSTRAINT IF EXISTS tags_category_check;

ALTER TABLE tags
  ADD CONSTRAINT tags_category_check
  CHECK (category IN ('Strategy', 'Mistakes', 'Rules', 'Custom'));
