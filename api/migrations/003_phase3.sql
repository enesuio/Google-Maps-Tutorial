-- Hydrox 45 phase 3: goal sources, Apple Health import, measurements, photos
-- (see docs/API.md "Phase 3 additions"). Append-only: never edit once applied.

alter table goals add column source text not null default 'manual'
  check (source in ('manual', 'health_steps', 'health_active_kcal'));

create table health_daily (
  user_id     int not null references users(id) on delete cascade,
  date        date not null,
  steps       int,
  active_kcal numeric,
  source      text not null default 'shortcut',
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);

-- One active (revoked_at is null) token per user; previous tokens are revoked, never deleted.
create table import_tokens (
  token        text primary key,
  user_id      int not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index import_tokens_user_id_idx on import_tokens (user_id);

alter table body_metrics
  add column hips_cm  numeric,
  add column chest_cm numeric,
  add column arm_cm   numeric,
  add column thigh_cm numeric;

create table photos (
  id         serial primary key,
  user_id    int not null references users(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('start', 'progress', 'end')),
  path       text not null,
  mime       text not null,
  bytes      int not null,
  width      int,
  height     int,
  created_at timestamptz not null default now()
);

create index photos_user_id_idx on photos (user_id);
