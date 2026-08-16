-- =============================================================================
-- PixelPlay – Supabase-skjema for innlogging, profiler, avatar-innstillinger
-- og spillrekorder.
--
-- Kjør denne filen i Supabase-dashbordet under "SQL Editor" på et nytt/tomt
-- prosjekt. Se SUPABASE_SETUP.md for full oppsettsguide (Google-provider,
-- redirect-URLer, bootstrapping av første admin osv.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. avatar_options – singleton-rad med fargene/ikonene som tildeles
--    automatisk ved registrering. Redigeres fra adminpanelet (admin.html).
-- ---------------------------------------------------------------------------
create table if not exists public.avatar_options (
  id smallint primary key default 1,
  colors text[] not null default array[
    '#2ee87f', '#5c8df5', '#f5715c', '#f5c95c',
    '#a56cf5', '#5cf5df', '#f55c9b', '#8bf05c'
  ],
  icons text[] not null default array[
    '🎮', '🚀', '🐱', '🦊', '🐸', '🔥', '⚡', '🌟', '🎯', '👾', '🐼', '🦄'
  ],
  updated_at timestamptz not null default now(),
  constraint avatar_options_singleton check (id = 1)
);

insert into public.avatar_options (id) values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. profiles – ett rad per bruker (1:1 med auth.users).
--    Brukernavn: 5-20 tegn, bokstaver/tall/understrek, unikt (uavh. av store/små bokstaver).
--    level/xp/is_admin kan kun endres av admins eller systemet selv (se trigger under).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  username_is_default boolean not null default false,
  avatar_color text not null,
  avatar_icon text not null,
  level int not null default 1,
  xp int not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-zA-Z0-9_]{5,20}$'),
  constraint profiles_level_positive check (level >= 1),
  constraint profiles_xp_positive check (xp >= 0)
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- ---------------------------------------------------------------------------
-- 3. game_records – historikk over poengsummer per spiller/spill.
--    game_id skal matche id-feltet i js/games-data.js. Ingen UI skriver til
--    denne tabellen ennå (ingen spill er bygget), men strukturen er klar for
--    når spillene begynner å rapportere poeng.
-- ---------------------------------------------------------------------------
create table if not exists public.game_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null,
  score numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists game_records_user_idx on public.game_records (user_id);
create index if not exists game_records_game_idx on public.game_records (game_id);

-- ---------------------------------------------------------------------------
-- 4. Hjelpefunksjon: er innlogget bruker admin? (SECURITY DEFINER for å
--    unngå rekursive RLS-oppslag mot profiles).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- 5. Hjelpefunksjon: generer et unikt, gyldig brukernavn ut fra en base
--    (brukes for Google-innlogging, der vi ikke kan spørre om brukernavn
--    før kontoen opprettes).
-- ---------------------------------------------------------------------------
create or replace function public.generate_unique_username(base text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cleaned text;
  candidate text;
  suffix int := 0;
begin
  cleaned := regexp_replace(lower(coalesce(nullif(base, ''), 'spiller')), '[^a-z0-9_]', '', 'g');
  if length(cleaned) = 0 then
    cleaned := 'spiller';
  end if;
  if length(cleaned) < 5 then
    cleaned := rpad(cleaned, 5, '0');
  end if;
  cleaned := left(cleaned, 15);
  candidate := cleaned;

  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := left(cleaned, 15) || suffix::text;
  end loop;

  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Trigger: opprett profil automatisk når en ny bruker registrerer seg
--    (både e-post og Google). Tildeler tilfeldig farge + ikon fra
--    avatar_options. Bruker brukernavn fra metadata hvis oppgitt
--    (e-post-registrering), ellers genereres et unikt brukernavn
--    (Google-registrering) og username_is_default settes til true slik at
--    profilsiden kan oppfordre brukeren til å velge et eget brukernavn.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meta_username text := new.raw_user_meta_data ->> 'username';
  final_username text;
  is_default boolean := false;
  picked_color text;
  picked_icon text;
begin
  if meta_username is not null and meta_username ~ '^[a-zA-Z0-9_]{5,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(meta_username)) then
    final_username := meta_username;
  else
    final_username := public.generate_unique_username(split_part(new.email, '@', 1));
    is_default := true;
  end if;

  select colors[1 + floor(random() * array_length(colors, 1))::int],
         icons[1 + floor(random() * array_length(icons, 1))::int]
    into picked_color, picked_icon
    from public.avatar_options where id = 1;

  insert into public.profiles (id, username, username_is_default, avatar_color, avatar_icon)
  values (new.id, final_username, is_default, coalesce(picked_color, '#2ee87f'), coalesce(picked_icon, '🎮'));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Trigger: hindre vanlige brukere i å skrive til level/xp/is_admin selv
--    (disse skal kun endres av adminpanelet eller av spill-backend senere).
--    Brukeren kan fortsatt oppdatere username/avatar_color/avatar_icon.
-- ---------------------------------------------------------------------------
create or replace function public.guard_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.level := old.level;
    new.xp := old.xp;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_privileged_profile_fields();

-- ---------------------------------------------------------------------------
-- 8. RPC: la en innlogget bruker slette sin egen konto (auth.users-raden).
--    Sletter automatisk profil + spillrekorder via ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.game_records enable row level security;
alter table public.avatar_options enable row level security;

-- profiles: alle (også utlogget) kan lese offentlig profilinfo (til f.eks.
-- rangeringssiden senere). E-post ligger i auth.users og eksponeres aldri her.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

-- profiles: en bruker kan kun oppdatere sin egen rad. Privilegerte felt
-- (level/xp/is_admin) beskyttes av triggeren over uansett.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- admin kan i tillegg oppdatere andre sine rader (f.eks. gjøre noen til admin,
-- eller justere nivå/xp manuelt).
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (true);

-- game_records: offentlig lesbar (rangering/rekorder), men en bruker kan kun
-- sette inn rader for seg selv.
drop policy if exists "game_records_select_all" on public.game_records;
create policy "game_records_select_all" on public.game_records
  for select using (true);

drop policy if exists "game_records_insert_own" on public.game_records;
create policy "game_records_insert_own" on public.game_records
  for insert with check (auth.uid() = user_id);

-- avatar_options: alle kan lese (trengs på profilsiden for å vise valgene),
-- kun admin kan skrive.
drop policy if exists "avatar_options_select_all" on public.avatar_options;
create policy "avatar_options_select_all" on public.avatar_options
  for select using (true);

drop policy if exists "avatar_options_update_admin" on public.avatar_options;
create policy "avatar_options_update_admin" on public.avatar_options
  for update using (public.is_admin());

-- =============================================================================
-- Bootstrap av første admin (kjør manuelt ETTER at du har registrert din
-- egen bruker via login.html):
--
--   update public.profiles set is_admin = true where lower(username) = lower('dittbrukernavn');
--
-- Etter det kan du gjøre flere til admin direkte fra adminpanelet.
-- =============================================================================
