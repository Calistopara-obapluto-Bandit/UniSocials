-- ============================================================
-- Unisocials — PostgreSQL events seed script
-- ------------------------------------------------------------
-- Seeds the `events` table with the default UNN event catalog.
-- Safe to run repeatedly (idempotent): it creates the table if
-- it does not exist and upserts each event by id.
--
-- Usage (from the repo root, with a DATABASE_URL):
--   psql "$DATABASE_URL" -f data/events_seed.sql
-- Or paste the SQL into your Render → PSQL / SQL Query console.
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upsert each default UNN event. The app stores the full event
-- object as JSONB under `data` (matching the JSON-file storage mode).
INSERT INTO events (id, data) VALUES
(
  'arts-cultural-night',
  '{"id":"arts-cultural-night","name":"Faculty of Arts Cultural Night","category":"Arts & Culture","price":2500,"vvipPrice":5000,"tablePrice":10000,"date":"March 10, 2025","time":"4:00 PM","venue":"Arts Theatre","description":"An evening of drama, poetry, music, and dance performances showcasing the best of the Arts department.","tags":["💃 Performance","🎤 Live Music","🎭 Drama"],"icon":"🎭","featured":true,"seats":"150 seats left","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
),
(
  'engineering-dinner',
  '{"id":"engineering-dinner","name":"Engineering Annual Dinner","category":"Engineering","price":5000,"vvipPrice":10000,"tablePrice":25000,"date":"March 15, 2025","time":"5:00 PM","venue":"Engineering Auditorium","description":"The flagship engineering social event — awards ceremony, networking with alumni, dinner service, and live entertainment.","tags":["🏆 Awards","🍽️ Dinner","🤝 Networking"],"icon":"⚙️","featured":true,"seats":"80 seats left","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
),
(
  'entrepreneurship-summit',
  '{"id":"entrepreneurship-summit","name":"Entrepreneurship Summit","category":"Business","price":3000,"date":"March 22, 2025","time":"10:00 AM","venue":"Business School Hall","description":"Connect with startup founders, investors, and industry leaders. Pitch your business ideas and compete for funding.","tags":["💡 Pitching","💰 Funding","📈 Workshops"],"icon":"💼","featured":true,"seats":"200 seats left","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
),
(
  'music-festival',
  '{"id":"music-festival","name":"Campus Music Festival","category":"Music","price":4000,"vvipPrice":8000,"tablePrice":20000,"date":"March 29, 2025","time":"6:00 PM","venue":"Sports Complex","description":"Live performances from the best campus bands, guest artists, and DJs. A night of unforgettable music and dancing.","tags":["🎸 Live Bands","🎧 DJ Sets","🍹 Refreshments"],"icon":"🎵","featured":true,"seats":"300 seats left","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
),
(
  'law-moot-court',
  '{"id":"law-moot-court","name":"Faculty of Law Moot Court","category":"Academic","price":1500,"date":"April 5, 2025","time":"9:00 AM","venue":"Faculty of Law","description":"The annual inter-faculty mock trial competition. Watch future lawyers battle it out in a simulated courtroom.","tags":["⚖️ Mock Trial","📜 Legal Debate","🏅 Competition"],"icon":"📚","featured":false,"seats":"100 seats left","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
),
(
  'sports-day',
  '{"id":"sports-day","name":"Inter-Faculty Sports Day","category":"Sports","price":1000,"date":"April 12, 2025","time":"8:00 AM","venue":"Main Stadium","description":"A day of friendly competition across football, basketball, athletics, and relay races. Cheer your faculty to victory!","tags":["⚽ Football","🏀 Basketball","🏃 Athletics"],"icon":"⚽","featured":false,"seats":"Unlimited","universityId":"uni-unn","universityName":"University of Nigeria, Nsukka","universitySlug":"unn"}'
)
ON CONFLICT (id) DO UPDATE SET
  data = EXCLUDED.data,
  updated_at = NOW();

-- Optional: verify the seeded rows (run manually to confirm).
-- SELECT id, data->>'name' AS name, data->>'universitySlug' AS university_slug FROM events ORDER BY id;
