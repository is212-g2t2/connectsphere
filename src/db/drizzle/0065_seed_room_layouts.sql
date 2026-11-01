-- PTR-161: seed the six room layouts under their current keys. `room_layouts` holds the
-- maintained list, and venues keep their stored keys. This file is the reviewed
-- `db:generate --custom` data exception. Do not edit generated DDL.
--
-- `ON CONFLICT DO NOTHING` keeps the migration re-runnable and preserves a renamed label:
-- a row that Venue Staff renamed keeps its key and label.
INSERT INTO "room_layouts" ("key", "label") VALUES
  ('theatre', 'Theatre'),
  ('classroom', 'Classroom'),
  ('boardroom', 'Boardroom'),
  ('banquet', 'Banquet'),
  ('exhibition', 'Exhibition'),
  ('other', 'Other')
ON CONFLICT DO NOTHING;
