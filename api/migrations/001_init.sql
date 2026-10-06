-- Hydrox 45 initial schema (see docs/API.md). Append-only: never edit once applied.

create table users (
  id               serial primary key,
  slug             text not null unique,
  name             text not null,
  timezone         text not null default 'America/Toronto',
  kcal_target      int,
  protein_target_g int,
  created_at       timestamptz not null default now()
);

create table challenges (
  id          serial primary key,
  name        text not null,
  start_date  date not null,
  length_days int not null
);

create table goals (
  id            serial primary key,
  user_id       int not null references users(id) on delete cascade,
  key           text not null,
  label         text not null,
  kind          text not null check (kind in ('bool', 'number')),
  unit          text,
  direction     text check (direction in ('at_least', 'at_most')),
  daily_target  numeric,
  weekly_target numeric,
  sort          int not null default 0,
  active        bool not null default true,
  unique (user_id, key)
);

create table checkins (
  user_id    int not null references users(id) on delete cascade,
  date       date not null,
  goal_id    int not null references goals(id) on delete cascade,
  value      numeric not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, goal_id)
);

create index checkins_date_idx on checkins (date);

create table sessions (
  id         text primary key,
  user_id    int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_user_id_idx on sessions (user_id);

create table setup_tokens (
  token      text primary key,
  user_id    int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
