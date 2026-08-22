-- =============================================================================
-- Studilla – Supabase-skjema for innlogging, profiler, avatar-innstillinger
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
    '#2ee87f', '#38bdf8', '#a78bfa', '#f472b6',
    '#ffd166', '#fb923c', '#ff9385', '#e8edf5'
  ],
  -- icons er nøkler inn i figur-settet i js/avatar-figures.js (robot, katt,
  -- spoke, alien, fugl, bjorn, krystall, blekk), ikke emoji-tegn.
  icons text[] not null default array[
    'robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk'
  ],
  updated_at timestamptz not null default now(),
  constraint avatar_options_singleton check (id = 1)
);

insert into public.avatar_options (id) values (1)
on conflict (id) do nothing;

-- Migrering: eksisterende installasjoner som fortsatt har de gamle
-- emoji-verdiene (fra før figur-avatarene ble innført) får de nye
-- standardfigurene/-fargene i stedet, slik at avataren ikke blir tom.
update public.avatar_options
   set colors = array['#2ee87f', '#38bdf8', '#a78bfa', '#f472b6', '#ffd166', '#fb923c', '#ff9385', '#e8edf5'],
       icons = array['robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk'],
       updated_at = now()
 where id = 1
   and not (icons <@ array['robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk']);

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
-- 2b. profiles.is_hidden – lar en bruker skjule seg selv fra rangeringen
--     (personvern-innstilling på innstillinger.html). Brukeren fortsetter å
--     samle poeng som normalt, men vises ikke i offentlige lister/søk.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_hidden boolean not null default false;

-- Migrering: eksisterende profiler med et gammelt emoji-avatar_icon (fra før
-- figur-avatarene ble innført) får standardfiguren "robot" i stedet, slik at
-- avataren ikke blir tom.
update public.profiles
   set avatar_icon = 'robot'
 where avatar_icon not in ('robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk');

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
  values (new.id, final_username, is_default, coalesce(picked_color, '#2ee87f'), coalesce(picked_icon, 'robot'));

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
--
--    Trigger'en fyrer på ENHVER oppdatering av profiles, også den som
--    public.add_points() gjør selv for å legge til poeng. Systemfunksjoner
--    som skal få lov til å skrive level/xp setter derfor et transaksjons-
--    lokalt flagg ("studilla.trusted_profile_write" = 'on') rett før sin
--    egen update; trigger'en slipper skrivingen gjennom når flagget er satt,
--    i tillegg til når brukeren er admin. Flagget nullstilles automatisk når
--    transaksjonen er ferdig (set_config-parameteret `is_local` = true).
-- ---------------------------------------------------------------------------
create or replace function public.guard_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin()
     and coalesce(current_setting('studilla.trusted_profile_write', true), '') <> 'on' then
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

-- ---------------------------------------------------------------------------
-- 10. levels – nivåstigen som vises på premier.html. Hvert nivå har et
--     poengkrav og en liste med premier (rabattkoder). Redigeres fra
--     adminpanelet (admin.html): admin kan legge til nye nivåer, endre
--     poengkrav, og legge til/fjerne premier per nivå.
--     rewards-formatet er en JSON-liste av objekter:
--     [{ "brand": "Nike", "title": "25 % på sko", "sub": "Utvalgte modeller" }, ...]
-- ---------------------------------------------------------------------------
create table if not exists public.levels (
  level_number int primary key,
  points_required int not null default 0,
  rewards jsonb not null default '[]'::jsonb,
  constraint levels_points_positive check (points_required >= 0)
);

insert into public.levels (level_number, points_required, rewards) values
  (1, 0, '[
    {"brand":"Peppes","title":"20 % på pizza","sub":"Gjelder hele menyen"},
    {"brand":"Narvesen","title":"Gratis kaffe","sub":"Én kopp per uke"}
  ]'::jsonb),
  (2, 1000, '[
    {"brand":"Cubus","title":"15 % på klær","sub":"Nettbutikk og butikk"},
    {"brand":"McDonald''s","title":"Gratis McFlurry","sub":"Ved kjøp over 99 kr"}
  ]'::jsonb),
  (3, 2500, '[
    {"brand":"Elkjøp","title":"10 % på gaming","sub":"Headset og mus"},
    {"brand":"Burger King","title":"2 for 1 burger","sub":"Alle dager"}
  ]'::jsonb),
  (12, 12000, '[
    {"brand":"Nike","title":"25 % på sko","sub":"Utvalgte modeller"},
    {"brand":"Sushi & Wok","title":"150 kr avslag","sub":"Ved kjøp over 500 kr"}
  ]'::jsonb),
  (13, 13000, '[
    {"brand":"Norwegian","title":"500 kr på fly","sub":"Innenriks, hele året"},
    {"brand":"Kicks","title":"30 % på hudpleie","sub":"Én ordre"}
  ]'::jsonb),
  (15, 16000, '[
    {"brand":"Steam","title":"Gavekort 500 kr","sub":"Trekning hver måned"},
    {"brand":"XXL","title":"20 % på alt","sub":"Unntatt sykkel"}
  ]'::jsonb)
on conflict (level_number) do nothing;

alter table public.levels enable row level security;

drop policy if exists "levels_select_all" on public.levels;
create policy "levels_select_all" on public.levels
  for select using (true);

drop policy if exists "levels_admin_write" on public.levels;
create policy "levels_admin_write" on public.levels
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 11. user_codes – rabattkoder en bruker har hentet ut ("Mine koder" på
--     premier.html). Koden selv genereres tilfeldig på klienten når brukeren
--     trykker "Hent rabattkode" (placeholder-koder inntil ekte partnerintegrasjon
--     finnes), og lagres her slik at den blir liggende i profilen.
-- ---------------------------------------------------------------------------
create table if not exists public.user_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  brand text not null,
  title text not null,
  code text not null,
  created_at timestamptz not null default now()
);

create index if not exists user_codes_user_idx on public.user_codes (user_id);

alter table public.user_codes enable row level security;

drop policy if exists "user_codes_select_own" on public.user_codes;
create policy "user_codes_select_own" on public.user_codes
  for select using (auth.uid() = user_id);

drop policy if exists "user_codes_insert_own" on public.user_codes;
create policy "user_codes_insert_own" on public.user_codes
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 12. RPC: legg poeng til innlogget bruker (brukes av lykkehjulet på
--     premier.html). SECURITY DEFINER slik at klienten ikke trenger direkte
--     skrivetilgang til xp/level-feltene (de er beskyttet av trigger #7).
--     Nivået oppdateres automatisk til høyeste nivå brukeren nå har nok
--     poeng til – men aldri nedover, og en admin kan fortsatt sette et
--     manuelt nivå fra adminpanelet (det blir stående til brukeren tjener
--     seg forbi et enda høyere nivå).
-- ---------------------------------------------------------------------------
create or replace function public.add_points(p_delta int)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.profiles;
  best_level int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'p_delta må være et positivt tall';
  end if;

  perform set_config('studilla.trusted_profile_write', 'on', true);
  update public.profiles
     set xp = xp + p_delta
   where id = auth.uid()
   returning * into updated;

  if updated is null then
    raise exception 'Fant ingen profil for innlogget bruker';
  end if;

  select max(level_number) into best_level
    from public.levels
   where points_required <= updated.xp;

  if best_level is not null and best_level > updated.level then
    perform set_config('studilla.trusted_profile_write', 'on', true);
    update public.profiles set level = best_level where id = auth.uid()
      returning * into updated;
  end if;

  return updated;
end;
$$;

revoke all on function public.add_points(int) from public;
grant execute on function public.add_points(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. RPC: antall rabattkoder en spiller har hentet ut, uten å eksponere de
--     faktiske kodene (user_codes er kun lesbar for eieren selv, se policy
--     "user_codes_select_own" over). Brukes på offentlige spillerprofiler og
--     rangeringssiden, som skal vise "antall rabattkoder" for alle spillere.
-- ---------------------------------------------------------------------------
create or replace function public.user_codes_count(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) from public.user_codes where user_id = p_user_id;
$$;

revoke all on function public.user_codes_count(uuid) from public;
grant execute on function public.user_codes_count(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. games – spilldatabasen. Erstatter etter hvert den statiske listen i
--     js/games-data.js (som fremdeles brukes som offline-fallback). id skal
--     matche filnavnet på bildene: assets/img/games/<id>.svg (cover) og
--     assets/img/icons/<id>.svg (ikon). Redigeres fra adminpanelet
--     (admin.html): admin kan bytte ikon/cover (URL) per spill, og velge
--     hvilket spill som er "dagens spill". Cover-/ikonbytte slår automatisk
--     ut alle steder som leser fra denne tabellen (forside, rangering, mine
--     rekorder, spillerprofil), siden alle bruker samme rad.
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id text primary key,
  name text not null,
  genre text not null default '',
  rating text not null default '',
  points text not null default '',
  time_estimate text not null default '',
  description text not null default '',
  thumbnail_url text,
  icon_url text,
  points_multiplier text,
  is_daily_game boolean not null default false,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- Kun ett spill kan være "dagens spill" om gangen.
create unique index if not exists games_single_daily_idx
  on public.games (is_daily_game)
  where is_daily_game;

insert into public.games (id, name, genre, rating, points, time_estimate, description, thumbnail_url, icon_url, is_daily_game, sort_order) values
  ('fruktfusjon', 'Fruktfusjon', 'Puslespill', '4,7', 'Din skår = dine poeng', '~10 min', 'Slipp frukt ned i krukken og slå sammen like frukter til større og større frukter, uten at haugen renner over.', 'assets/img/games/fruktfusjon.svg', 'assets/img/icons/fruktfusjon.svg', false, 1),
  ('2048', '2048', 'Puslespill', '4,9', 'Din skår = dine poeng', '~5 min', 'Slå sammen brikker med like tall og jag den store 2048-brikken. Skåren din legges rett til poengsummen og nivået ditt.', 'assets/img/games/2048.svg', 'assets/img/icons/2048.svg', true, 2),
  ('tetris', 'Tetris', 'Puslespill', '4,9', 'Din skår = dine poeng', '~15 min', 'Styr de fargerike klossene mens de faller, fyll hele rader for å sprenge dem, og jag din egen rekord i det klassiske puslespillet.', 'assets/img/games/tetris.svg', 'assets/img/icons/tetris.svg', false, 3),
  ('block-blast', 'Block Blast', 'Puslespill', '4,8', 'Din skår = dine poeng', '~10 min', 'Dra fargerike klosser fra hånden din over på brettet og fyll hele rader eller kolonner for å sprenge dem og score poeng.', 'assets/img/games/block-blast.svg', 'assets/img/icons/block-blast.svg', false, 4),
  ('snake', 'Snake', 'Arkade', '4,6', 'Din skår = dine poeng', '~8 min', 'Styr slangen rundt brettet, spis prikkene og voks deg lengst mulig uten å treffe deg selv eller veggen.', 'assets/img/games/snake.svg', 'assets/img/icons/snake.svg', false, 5),
  ('bubble-shooter', 'Bubble Shooter', 'Puslespill', '4,7', 'Din skår = dine poeng', '~10 min', 'Sikt og skyt kuler for å matche tre eller flere med samme farge. Tøm hele brettet for maks poeng før kulene når bunnen.', 'assets/img/games/bubble-shooter.svg', 'assets/img/icons/bubble-shooter.svg', false, 6)
on conflict (id) do nothing;

alter table public.games enable row level security;

drop policy if exists "games_select_all" on public.games;
create policy "games_select_all" on public.games
  for select using (true);

drop policy if exists "games_admin_write" on public.games;
create policy "games_admin_write" on public.games
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 15. RPC: sett hvilket spill som er "dagens spill". Nullstiller alle andre
--     rader atomisk (unngår at unikindeksen over kortvarig brytes) og krever
--     admin. Brukes av adminpanelet (admin.html).
-- ---------------------------------------------------------------------------
create or replace function public.set_daily_game(p_game_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Kun admin kan endre dagens spill';
  end if;

  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'Fant ikke spillet %', p_game_id;
  end if;

  update public.games set is_daily_game = false where is_daily_game and id <> p_game_id;
  update public.games set is_daily_game = true where id = p_game_id;
end;
$$;

revoke all on function public.set_daily_game(text) from public;
grant execute on function public.set_daily_game(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. games.hidden – lar admin skjule et spill fra rutenettet på forsiden og
--     andre lister uten å slette det (nyttig for spill som fortsatt bygges).
--     Et skjult spill er fortsatt tilgjengelig direkte via
--     player.html?id=<id>, det vises bare ikke i lister. Redigeres fra
--     adminpanelet (admin.html) under "Spill".
-- ---------------------------------------------------------------------------
alter table public.games add column if not exists hidden boolean not null default false;

-- ---------------------------------------------------------------------------
-- 17. RPC: la en admin slette en annen brukers konto fra adminpanelet.
--     SECURITY DEFINER slik at klienten ikke trenger direkte tilgang til
--     auth.users. Sletter auth.users-raden, som via ON DELETE CASCADE også
--     fjerner profil, spillrekorder og rabattkoder. En admin kan ikke slette
--     sin egen konto herfra (bruk "Slett konto" på profilsiden for det).
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Kun admin kan slette andre brukere';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Kan ikke slette din egen konto herfra';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. rewards – erstatter det tidligere frie jsonb-feltet levels.rewards.
--     Hver rad er én premie/kampanje knyttet til et nivå. code_type avgjør
--     hvordan koden tildeles ved claim:
--       'general' – alle med opplåsing bruker samme kode (general_code).
--       'list'    – hver bruker får tildelt én unik kode fra reward_codes
--                    (seksjon 19), og den koden er deretter brukt opp.
--     expires_at (valgfri) gjør at premien ikke lenger kan claimes etter en
--     gitt dato. Redigeres fra adminpanelet (admin.html, "Nivåer og premier").
-- ---------------------------------------------------------------------------
create table if not exists public.rewards (
  id bigint generated always as identity primary key,
  level_number int not null references public.levels (level_number) on delete cascade,
  brand text not null default '',
  title text not null default '',
  sub text not null default '',
  code_type text not null default 'general' check (code_type in ('general', 'list')),
  general_code text,
  expires_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint rewards_general_code_required
    check (code_type <> 'general' or general_code is not null)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rewards' and column_name = 'level_number'
  ) then
    create index if not exists rewards_level_idx on public.rewards (level_number);
  end if;
end $$;

-- Engangsmigrering: overfør eksisterende premier fra levels.rewards (jsonb)
-- til den nye tabellen, med en tydelig placeholder-kode som admin må bytte
-- ut med en ekte kode (eller endre til kodeliste) i adminpanelet.
-- Kun relevant første gang skjemaet kjøres (seksjon 26 fjerner senere
-- rewards.level_number helt) – hoppes over ved re-kjøring på en database
-- som allerede er migrert, ellers feiler denne med "column level_number
-- does not exist".
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rewards' and column_name = 'level_number'
  ) then
    insert into public.rewards (level_number, brand, title, sub, code_type, general_code, sort_order)
    select lv.level_number,
           coalesce(elem ->> 'brand', ''),
           coalesce(elem ->> 'title', ''),
           coalesce(elem ->> 'sub', ''),
           'general',
           'SETT-KODE-I-ADMIN',
           (ord - 1)::int
      from public.levels lv,
           lateral jsonb_array_elements(coalesce(lv.rewards, '[]'::jsonb)) with ordinality as t (elem, ord)
     where not exists (select 1 from public.rewards r where r.level_number = lv.level_number);
  end if;
end $$;

alter table public.rewards enable row level security;

drop policy if exists "rewards_select_all" on public.rewards;
create policy "rewards_select_all" on public.rewards
  for select using (true);

drop policy if exists "rewards_admin_write" on public.rewards;
create policy "rewards_admin_write" on public.rewards
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 19. reward_codes – kodepool for premier med code_type = 'list'. Admin laster
--     opp koder her (én per rad); claim_reward (seksjon 21) tildeler atomisk
--     én ledig rad (claimed_by is null) per bruker og markerer den brukt opp.
--     Kun admin har direkte lesetilgang – claim_reward er SECURITY DEFINER og
--     omgår RLS, så vanlige brukere ser aldri hele kodelisten, kun sin egen
--     tildelte kode (via user_codes).
-- ---------------------------------------------------------------------------
create table if not exists public.reward_codes (
  id bigint generated always as identity primary key,
  reward_id bigint not null references public.rewards (id) on delete cascade,
  code text not null,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reward_codes_reward_idx on public.reward_codes (reward_id);
create index if not exists reward_codes_unclaimed_idx on public.reward_codes (reward_id) where claimed_by is null;
create unique index if not exists reward_codes_reward_code_idx on public.reward_codes (reward_id, code);

alter table public.reward_codes enable row level security;

drop policy if exists "reward_codes_admin_all" on public.reward_codes;
create policy "reward_codes_admin_all" on public.reward_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 20. user_codes – kobles nå til rewards (reward_id) slik at vi kan håndheve
--     at hver premie kun kan claimes én gang per bruker. Direkte innsetting
--     fra klienten stenges: koden skal ikke havne i user_codes før claim er
--     bekreftet server-side av claim_reward (seksjon 21), aldri via en rå
--     insert fra klienten.
-- ---------------------------------------------------------------------------
alter table public.user_codes add column if not exists reward_id bigint references public.rewards (id) on delete cascade;

create unique index if not exists user_codes_user_reward_idx
  on public.user_codes (user_id, reward_id)
  where reward_id is not null;

drop policy if exists "user_codes_insert_own" on public.user_codes;

drop policy if exists "user_codes_select_admin" on public.user_codes;
create policy "user_codes_select_admin" on public.user_codes
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 21. RPC: claim_reward – den nivå-bundne forgjengeren til open_level_case
--     (seksjon 30). Er permanent erstattet og droppes uansett i seksjon 29,
--     så den opprettes ikke lenger her: funksjonskroppen refererte
--     rewards.level_number/expires_at, som seksjon 26 fjerner – å re-opprette
--     den ved en re-kjøring av dette skriptet mot en allerede migrert
--     database feilet derfor med "column level_number does not exist".
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 22. RPC: reward_codes_remaining – antall ledige koder igjen for en
--     'list'-premie, uten å eksponere selve kodene. Brukes av adminpanelet
--     for å vise "X koder igjen" per premie/kampanje.
-- ---------------------------------------------------------------------------
create or replace function public.reward_codes_remaining(p_reward_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) from public.reward_codes where reward_id = p_reward_id and claimed_by is null;
$$;

revoke all on function public.reward_codes_remaining(bigint) from public;
grant execute on function public.reward_codes_remaining(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 23. Storage-bucket for spillbilder (cover/ikon), lastet opp fra
--     adminpanelet (admin.html) under "Spill". Bildene er offentlig lesbare
--     (samme som resten av forsiden), men kun admin kan laste opp/endre/
--     slette. Kjør denne delen i Supabase SQL-editoren (evt. hele filen på
--     nytt) for å ta i bruk bildeopplasting.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('game-images', 'game-images', true)
on conflict (id) do nothing;

drop policy if exists "game_images_select_all" on storage.objects;
create policy "game_images_select_all" on storage.objects
  for select using (bucket_id = 'game-images');

drop policy if exists "game_images_admin_write" on storage.objects;
create policy "game_images_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'game-images' and public.is_admin());

drop policy if exists "game_images_admin_update" on storage.objects;
create policy "game_images_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'game-images' and public.is_admin())
  with check (bucket_id = 'game-images' and public.is_admin());

drop policy if exists "game_images_admin_delete" on storage.objects;
create policy "game_images_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'game-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 24. Innstramning: "profiles_select_all" ga tidligere ALLE (også anonyme
--     besøkende) full lesetilgang til hele profiles-tabellen, inkludert
--     is_admin – det lekker unødvendig hvem som er admin. Vanlige select mot
--     profiles begrenses nå til egen rad (admin ser fortsatt alt, siden
--     adminpanelet trenger det). En egen VIEW uten is_admin/username_is_default
--     eksponerer fortsatt det rangering/søk/spillerprofiler trenger fra ALLE
--     brukere (leaderboard-data.js, login.html sin brukernavn-sjekk).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

create or replace view public.profiles_public as
  select id, username, avatar_color, avatar_icon, level, xp, is_hidden, created_at
    from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 25. Fyller hullene i nivåstigen (nivå 4–11 og 14 manglet poengkrav, slik at
--     "Nivåstigen" på premier.html hoppet rett fra nivå 3 til 12). Ingen
--     premier legges til her – admin fyller inn ekte partnerpremier for disse
--     nivåene fra adminpanelet når de er klare.
-- ---------------------------------------------------------------------------
insert into public.levels (level_number, points_required) values
  (4, 4000),
  (5, 5500),
  (6, 7000),
  (7, 8000),
  (8, 9000),
  (9, 10000),
  (10, 10800),
  (11, 11400),
  (14, 14500)
on conflict (level_number) do nothing;

-- ---------------------------------------------------------------------------
-- 26. Rabatt-redesign: rabattene (rewards) er ikke lenger knyttet til et
--     bestemt nivå. Hvert nivå gir i stedet én "kasse" som – når den åpnes –
--     tildeler brukeren én tilfeldig aktiv rabatt, vektet etter
--     sjeldenhetsgrad (rarity_weights, seksjon 27). Rabattene redigeres nå på
--     egen "Rabatter"-side i adminpanelet (admin.html), og er fortsatt
--     knyttet til premiesiden gjennom kassene (åpnes via open_level_case,
--     seksjon 30). "sub" brukes som beskrivelsen bak infosymbolet på
--     premier.html.
-- ---------------------------------------------------------------------------
drop index if exists public.rewards_level_idx;

alter table public.rewards add column if not exists rarity text not null default 'vanlig'
  check (rarity in ('vanlig', 'sjelden', 'episk', 'legendarisk'));
alter table public.rewards add column if not exists image_url text;
alter table public.rewards add column if not exists active boolean not null default true;

alter table public.rewards drop constraint if exists rewards_level_number_fkey;
alter table public.rewards drop column if exists level_number;
alter table public.rewards drop column if exists expires_at;

-- ---------------------------------------------------------------------------
-- 27. rarity_weights – hvor sannsynlig hver sjeldenhetsgrad er når en kasse
--     åpnes. Vektene er relative til hverandre (de trenger ikke summere til
--     100). Redigeres fra adminpanelet under "Rabatter".
-- ---------------------------------------------------------------------------
create table if not exists public.rarity_weights (
  rarity text primary key check (rarity in ('vanlig', 'sjelden', 'episk', 'legendarisk')),
  weight int not null default 25 check (weight >= 0)
);

insert into public.rarity_weights (rarity, weight) values
  ('vanlig', 60), ('sjelden', 25), ('episk', 11), ('legendarisk', 4)
on conflict (rarity) do nothing;

alter table public.rarity_weights enable row level security;

drop policy if exists "rarity_weights_select_all" on public.rarity_weights;
create policy "rarity_weights_select_all" on public.rarity_weights
  for select using (true);

drop policy if exists "rarity_weights_admin_write" on public.rarity_weights;
create policy "rarity_weights_admin_write" on public.rarity_weights
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 28. user_level_cases – holder styr på hvilke nivå-kasser en bruker har
--     åpnet, og hvilken rabatt kassen ga. Én kasse per nivå per bruker.
--     Skrives kun av open_level_case (seksjon 29), aldri direkte fra
--     klienten.
-- ---------------------------------------------------------------------------
create table if not exists public.user_level_cases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  level_number int not null references public.levels (level_number) on delete cascade,
  reward_id bigint references public.rewards (id) on delete set null,
  code text,
  opened_at timestamptz not null default now(),
  unique (user_id, level_number)
);

create index if not exists user_level_cases_user_idx on public.user_level_cases (user_id);

alter table public.user_level_cases enable row level security;

drop policy if exists "user_level_cases_select_own" on public.user_level_cases;
create policy "user_level_cases_select_own" on public.user_level_cases
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- 29. RPC: claim_reward (den gamle, nivå-bundne modellen) er erstattet av
--     open_level_case og gir ikke lenger mening siden rewards.level_number er
--     fjernet over.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_reward(bigint);

-- ---------------------------------------------------------------------------
-- 30. RPC: open_level_case – åpner en brukers kasse for et gitt nivå. Kan kun
--     åpnes én gang per nivå per bruker (SECURITY DEFINER, sjekker nivået
--     server-side). Trekker én tilfeldig aktiv rabatt vektet etter
--     rarity_weights (Efraimidis–Spirakis-vekting: order by -ln(random()) /
--     vekt gir korrekt sannsynlighetsfordeling uten å måtte normalisere).
--     For en 'list'-rabatt tildeles én kode atomisk (samme SKIP LOCKED-mønster
--     som den gamle claim_reward); går kodene tomme etter tildelingen,
--     deaktiveres rabatten automatisk (active = false) slik at den ikke kan
--     trekkes igjen før admin legger til flere koder.
-- ---------------------------------------------------------------------------
create or replace function public.open_level_case(p_level_number int)
returns table (brand text, title text, sub text, rarity text, image_url text, code text, already_opened boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  my_level int;
  existing public.user_level_cases;
  r public.rewards;
  picked_code text;
  remaining bigint;
begin
  if auth.uid() is null then
    raise exception 'Du må være innlogget for å åpne en kasse';
  end if;

  select level into my_level from public.profiles where id = auth.uid();
  if my_level is null or my_level < p_level_number then
    raise exception 'Du har ikke låst opp dette nivået ennå';
  end if;

  select * into existing from public.user_level_cases
   where user_id = auth.uid() and level_number = p_level_number;

  if existing is not null then
    select * into r from public.rewards where id = existing.reward_id;
    if r is null then
      return query select null::text, null::text, null::text, null::text, null::text, existing.code, true;
      return;
    end if;
    return query select r.brand, r.title, r.sub, r.rarity, r.image_url, existing.code, true;
    return;
  end if;

  select rw.* into r
    from public.rewards rw
    join public.rarity_weights ww on ww.rarity = rw.rarity
   where rw.active and ww.weight > 0
   order by -ln(random()) / ww.weight
   limit 1;

  if r is null then
    raise exception 'Ingen rabatter tilgjengelig akkurat nå';
  end if;

  if r.code_type = 'general' then
    picked_code := r.general_code;
  else
    update public.reward_codes
       set claimed_by = auth.uid(), claimed_at = now()
     where id = (
       select id from public.reward_codes
        where reward_id = r.id and claimed_by is null
        order by id
        limit 1
        for update skip locked
     )
     returning code into picked_code;

    if picked_code is null then
      raise exception 'Ingen flere koder igjen for denne rabatten akkurat nå';
    end if;

    select count(*) into remaining from public.reward_codes
     where reward_id = r.id and claimed_by is null;
    if remaining = 0 then
      update public.rewards set active = false where id = r.id;
    end if;
  end if;

  insert into public.user_level_cases (user_id, level_number, reward_id, code)
  values (auth.uid(), p_level_number, r.id, picked_code);

  insert into public.user_codes (user_id, brand, title, code, reward_id)
  values (auth.uid(), r.brand, r.title, picked_code, r.id);

  return query select r.brand, r.title, r.sub, r.rarity, r.image_url, picked_code, false;
end;
$$;

revoke all on function public.open_level_case(int) from public;
grant execute on function public.open_level_case(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 31. Storage-bucket for rabattbilder, lastet opp fra adminpanelet
--     (admin.html) under "Rabatter". Samme mønster som game-images
--     (seksjon 23).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reward-images', 'reward-images', true)
on conflict (id) do nothing;

drop policy if exists "reward_images_select_all" on storage.objects;
create policy "reward_images_select_all" on storage.objects
  for select using (bucket_id = 'reward-images');

drop policy if exists "reward_images_admin_write" on storage.objects;
create policy "reward_images_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'reward-images' and public.is_admin());

drop policy if exists "reward_images_admin_update" on storage.objects;
create policy "reward_images_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'reward-images' and public.is_admin())
  with check (bucket_id = 'reward-images' and public.is_admin());

drop policy if exists "reward_images_admin_delete" on storage.objects;
create policy "reward_images_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'reward-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 32. RPC: admin_preview_case – lar en admin spinne kassen et ubegrenset
--     antall ganger for å forhåndsvise hva den kan gi, uten at det påvirker
--     ordinære brukere. Bruker samme vektede trekning som open_level_case
--     (seksjon 30, rewards er ikke lenger nivå-bundet – se seksjon 26), men
--     er kun en "peek": den claimer ALDRI en rad i reward_codes
--     (claimed_by/claimed_at røres ikke), og skriver ALDRI til
--     user_level_cases eller user_codes. Koden som vises er derfor fortsatt
--     ledig for en ekte bruker etterpå, og admins egen ekte kasse (via
--     open_level_case) påvirkes heller ikke.
-- ---------------------------------------------------------------------------
create or replace function public.admin_preview_case()
returns table (brand text, title text, sub text, rarity text, image_url text, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.rewards;
  peeked_code text;
begin
  if not public.is_admin() then
    raise exception 'Kun admin kan forhåndsvise kasser';
  end if;

  select rw.* into r
    from public.rewards rw
    join public.rarity_weights ww on ww.rarity = rw.rarity
   where rw.active and ww.weight > 0
   order by -ln(random()) / ww.weight
   limit 1;

  if r is null then
    raise exception 'Ingen rabatter tilgjengelig akkurat nå';
  end if;

  if r.code_type = 'general' then
    peeked_code := r.general_code;
  else
    select code into peeked_code
      from public.reward_codes
     where reward_id = r.id and claimed_by is null
     order by random()
     limit 1;

    if peeked_code is null then
      raise exception 'Ingen flere koder igjen for denne rabatten akkurat nå';
    end if;
  end if;

  return query select r.brand, r.title, r.sub, r.rarity, r.image_url, peeked_code;
end;
$$;

revoke all on function public.admin_preview_case() from public;
grant execute on function public.admin_preview_case() to authenticated;

-- =============================================================================
-- Bootstrap av første admin (kjør manuelt ETTER at du har registrert din
-- egen bruker via login.html):
--
--   update public.profiles set is_admin = true where lower(username) = lower('dittbrukernavn');
--
-- Etter det kan du gjøre flere til admin direkte fra adminpanelet.
-- =============================================================================
