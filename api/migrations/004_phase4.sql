-- Hydrox 45 phase 4: finish-line tests for the Day 45 summary
-- (see docs/API.md "Phase 4 additions"). Append-only: never edit once applied.

create table finish_tests (
  id         serial primary key,
  user_id    int not null references users(id) on delete cascade,
  key        text not null,
  label      text not null,
  passed     boolean,          -- null = not tested yet
  result     text,             -- free text, e.g. "2 push-ups" (<= 80 chars)
  tested_on  date,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);
