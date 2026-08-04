-- Slice 0007 follow-up: lets the operator caption a numbered library picture (e.g. "flashy chestnut,
-- jumping") from /admin/breeds, without touching the filename or the upload workflow. A missing row
-- means the picture has no label, same empty-state discipline as image_count = 0 (0026's own
-- comment) - not a special case anywhere that reads this table.
CREATE TABLE breed_image_labels (
  breed_id INTEGER NOT NULL REFERENCES breeds (id),
  image_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (breed_id, image_index)
);
