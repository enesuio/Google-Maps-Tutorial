-- Hydrox 45 phase 2: metrics sharing flag, cheers, body metrics, push subscriptions
-- (see docs/API.md "Phase 2 additions"). Append-only: never edit once applied.

alter table users add column metrics_shared boolean not null default true;

create table cheers (
  id         serial primary key,
  from_user  int not null references users(id) on delete cascade,
  to_user    int not null references users(id) on delete cascade,
  date       date not null,
  emoji      text not null,
  note       text,
  created_at timestamptz not null default now()
);

create index cheers_to_user_date_idx on cheers (to_user, date);

create table body_metrics (
  user_id    int not null references users(id) on delete cascade,
  date       date not null,
  weight_kg  numeric,
  waist_cm   numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table push_subscriptions (
  id         serial primary key,
  user_id    int not null references users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  last_error text,
  failed_at  timestamptz
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);
