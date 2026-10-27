-- Autotalli: tietokantataulut ja käyttöoikeudet.
-- Aja tämä kerran Supabasessa: SQL Editor → New query → liitä → Run.
-- Jokainen käyttäjä näkee ja muokkaa vain omia autojaan (Row Level Security).

create table if not exists public.cars (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  make        text,
  model       text,
  plate       text,
  year        int,
  fuel        text,
  engine      text,
  oil_spec    text,
  tires       text,
  vin         text,
  oil_km      int  not null default 15000 check (oil_km >= 500),
  oil_months  int  not null default 12    check (oil_months >= 0),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.odometer (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  car_id      uuid not null references public.cars(id) on delete cascade,
  date        date not null default current_date,
  km          int  not null check (km >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.services (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  car_id      uuid not null references public.cars(id) on delete cascade,
  date        date not null default current_date,
  km          int  check (km >= 0),
  type        text not null default 'Huolto',
  is_oil      boolean not null default false,
  cost        numeric(10,2),
  place       text,
  description text,
  created_at  timestamptz not null default now()
);

create index if not exists cars_user_idx      on public.cars(user_id);
create index if not exists odometer_car_idx   on public.odometer(car_id);
create index if not exists services_car_idx   on public.services(car_id);

alter table public.cars     enable row level security;
alter table public.odometer enable row level security;
alter table public.services enable row level security;

drop policy if exists "own cars" on public.cars;
create policy "own cars" on public.cars
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own odometer" on public.odometer;
create policy "own odometer" on public.odometer
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.cars c where c.id = car_id and c.user_id = auth.uid()));

drop policy if exists "own services" on public.services;
create policy "own services" on public.services
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.cars c where c.id = car_id and c.user_id = auth.uid()));
