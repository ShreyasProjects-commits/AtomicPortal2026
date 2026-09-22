-- FitPortal database schema (Supabase / Postgres)
-- Run in Supabase SQL editor, or via `supabase db push`.
-- Full field reference: docs/database-schema.md
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

-- Orders imported from the business order page / CSV -----------------------
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  external_ref  text,
  status        text not null default 'draft'
                  check (status in ('draft','submitted','solved','failed')),
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists orders_external_ref_idx
  on orders (external_ref) where external_ref is not null;

-- Line items on an order (item + quantity) ----------------------------------
create table if not exists order_items (
  order_id  uuid not null references orders (id) on delete cascade,
  item_id   uuid not null references items (id),
  quantity  integer not null check (quantity > 0),
  primary key (order_id, item_id)
);

-- Containers selected for an order ------------------------------------------
create table if not exists order_containers (
  order_id      uuid not null references orders (id) on delete cascade,
  container_id  uuid not null references containers (id),
  primary key (order_id, container_id)
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
alter table order_items      enable row level security;
alter table order_containers enable row level security;
alter table order_results    enable row level security;

-- Profile info for each authenticated user (first/last name + role) --------
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  role        text not null default 'warehouse_worker'
                check (role in ('admin', 'warehouse_worker')),
  created_at  timestamptz not null default now()
);

alter table profiles enable row level security;

-- A user can read their own profile row (needed so the nav bar can show their name)
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up, using the
-- first_name/last_name/role passed in from the sign-up form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'warehouse_worker')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
