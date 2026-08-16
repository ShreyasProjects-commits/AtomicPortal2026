-- FitPortal database schema (Supabase / Postgres)
-- Run in Supabase SQL editor, or via `supabase db push`.
-- Units are stored explicitly (cm / kg) to avoid ambiguity across teams.

-- Items available to pack ----------------------------------------------------
create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  length_cm   numeric not null check (length_cm > 0),
  width_cm    numeric not null check (width_cm  > 0),
  height_cm   numeric not null check (height_cm > 0),
  weight_kg   numeric not null check (weight_kg >= 0),
  created_at  timestamptz not null default now()
);

-- Containers / cartons -------------------------------------------------------
create table if not exists containers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  length_cm     numeric not null check (length_cm > 0),
  width_cm      numeric not null check (width_cm  > 0),
  height_cm     numeric not null check (height_cm > 0),
  max_weight_kg numeric not null check (max_weight_kg > 0),
  created_at    timestamptz not null default now()
);

-- Orders submitted by operational staff -------------------------------------
create table if not exists orders (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'draft'
                check (status in ('draft','submitted','solved','failed')),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

-- Line items on an order (item + quantity) ----------------------------------
create table if not exists order_items (
  order_id  uuid not null references orders (id) on delete cascade,
  item_id   uuid not null references items (id),
  quantity  integer not null check (quantity > 0),
  primary key (order_id, item_id)
);

-- Solver results, stored as-is from the /optimize response ------------------
create table if not exists order_results (
  order_id           uuid primary key references orders (id) on delete cascade,
  packed_containers  jsonb not null,
  unpacked_items     jsonb not null default '[]',
  created_at         timestamptz not null default now()
);

-- RLS: enable and lock down; policies added alongside auth work -------------
alter table items         enable row level security;
alter table containers    enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;
alter table order_results enable row level security;
