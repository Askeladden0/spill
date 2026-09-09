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
-- Ikoner som er opplastede bilder (URL-er til avatar-images-bucketen,
-- se seksjon 31b) er ikke gamle emoji og skal ikke rulles tilbake her.
update public.avatar_options
   set colors = array['#2ee87f', '#38bdf8', '#a78bfa', '#f472b6', '#ffd166', '#fb923c', '#ff9385', '#e8edf5'],
       icons = array['robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk'],
       updated_at = now()
 where id = 1
   and not (icons <@ array['robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk'])
   and not exists (select 1 from unnest(icons) i where i like 'http%');

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
-- avataren ikke blir tom. avatar_icon som er en URL (opplastet profilbilde,
-- se seksjon 31b) er ikke gammel emoji og skal ikke rulles tilbake.
update public.profiles
   set avatar_icon = 'robot'
 where avatar_icon not in ('robot', 'katt', 'spoke', 'alien', 'fugl', 'bjorn', 'krystall', 'blekk')
   and avatar_icon not like 'http%';

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
  -- is_daily_game settes kun hvis ingen triks er merket som dagens fra før.
  -- Samme fallgruve som guides_single_featured_idx lenger nede: «on conflict
  -- (id)» fanger ikke et brudd på games_single_daily_idx, så hadde man
  -- slettet 2048 og merket et annet triks som dagens, stoppet hele filen her.
  ('2048', '2048', 'Puslespill', '4,9', 'Din skår = dine poeng', '~5 min', 'Slå sammen brikker med like tall og jag den store 2048-brikken. Skåren din legges rett til poengsummen og nivået ditt.', 'assets/img/games/2048.svg', 'assets/img/icons/2048.svg', not exists (select 1 from public.games where is_daily_game), 2),
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

-- Slippes først: seksjon 49 utvider den samme viewen med streak-kolonnene,
-- og `create or replace view` kan ikke fjerne kolonner fra en view som
-- allerede finnes. Uten dette stopper hele filen på andre gangs kjøring.
drop view if exists public.profiles_public;
create view public.profiles_public as
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
--
--     drop function if exists trengs her selv om dette er den første
--     definisjonen i filen – re-kjøring av hele schema.sql mot en database
--     som allerede har en eldre versjon av funksjonen (annen OUT-radtype)
--     feiler ellers med 42P13 "cannot change return type of existing
--     function", se seksjon 40 for samme fiks lenger ned.
-- ---------------------------------------------------------------------------
drop function if exists public.open_level_case(int);

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
     returning reward_codes.code into picked_code;

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
-- 31b. Storage-bucket for opplastede profilbilder, lastet opp fra
--      adminpanelet (admin.html) under "Profilbilder". Samme mønster som
--      reward-images (seksjon 31). URL-en til et opplastet bilde lagres
--      direkte i avatar_options.icons (seksjon 1) og profiles.avatar_icon
--      (seksjon 2) i stedet for en av de innebygde figur-nøklene.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatar-images', 'avatar-images', true)
on conflict (id) do nothing;

drop policy if exists "avatar_images_select_all" on storage.objects;
create policy "avatar_images_select_all" on storage.objects
  for select using (bucket_id = 'avatar-images');

drop policy if exists "avatar_images_admin_write" on storage.objects;
create policy "avatar_images_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatar-images' and public.is_admin());

drop policy if exists "avatar_images_admin_update" on storage.objects;
create policy "avatar_images_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'avatar-images' and public.is_admin())
  with check (bucket_id = 'avatar-images' and public.is_admin());

drop policy if exists "avatar_images_admin_delete" on storage.objects;
create policy "avatar_images_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'avatar-images' and public.is_admin());

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
--
--     drop function if exists trengs her av samme grunn som for
--     open_level_case over – re-kjøring mot en database med en eldre
--     versjon av funksjonen kan ellers feile med 42P13.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_preview_case();

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
    select reward_codes.code into peeked_code
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


-- ---------------------------------------------------------------------------
-- 33. rewards.expires_at / rewards.link_url
--     expires_at: valgfri utløpsdato. Når den er passert regnes rabatten som
--     deaktivert – den trekkes ikke lenger i kasser (open_level_case /
--     admin_preview_case, se seksjon 38) og vises som «Utgått» i adminpanelet.
--     Settes til null for å fjerne utløpet igjen.
--     link_url: valgfri lenke til partneren/tilbudet. Vises som en
--     «Gå til tilbudet»-knapp når brukeren åpner kassen på premier.html.
-- ---------------------------------------------------------------------------
alter table public.rewards add column if not exists expires_at timestamptz;
alter table public.rewards add column if not exists link_url text;

-- ---------------------------------------------------------------------------
-- 34. reward_codes.disabled – lar admin deaktivere én enkelt kode i en
--     kodeliste (f.eks. en kode partneren har trukket tilbake) uten å slette
--     den eller deaktivere hele rabatten. En deaktivert kode deles aldri ut,
--     og teller ikke som «ledig» noe sted.
-- ---------------------------------------------------------------------------
alter table public.reward_codes add column if not exists disabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 35. games.point_rate – hvor mange poeng spilleren får per poeng skår i
--     spillet. 1 = skåren gis 1:1 (som før), 2 = dobbelt opp, 0,5 = halvparten.
--     Redigeres per spill fra adminpanelet ("Triks"), og brukes av
--     js/game-runtime.js når resultatet sendes til add_points. Selve rekorden
--     i game_records lagres fortsatt som den rå skåren, slik at rekordlistene
--     ikke endrer seg når faktoren justeres.
-- ---------------------------------------------------------------------------
alter table public.games add column if not exists point_rate numeric not null default 1
  constraint games_point_rate_positive check (point_rate >= 0);

-- ---------------------------------------------------------------------------
-- 36. app_settings – singleton-rad med globale innstillinger.
--     level_step: hvor mange poeng hvert nivå øker med. Nivåstigen er lineær –
--     nivå N krever (N - 1) * level_step poeng – slik at admin kun trenger å
--     fylle inn ett tall i stedet for et poengkrav per nivå.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  level_step int not null default 1000 check (level_step > 0),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, level_step) values (1, 1000)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_all" on public.app_settings;
create policy "app_settings_select_all" on public.app_settings
  for select using (true);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 37. Behold brukernes koder når admin rydder i nivåer og rabatter.
--
--     user_level_cases.level_number pekte tidligere på levels med
--     ON DELETE CASCADE: slettet admin et nivå, forsvant også historikken
--     over hvilke kasser brukerne hadde åpnet på det nivået (og dermed
--     koblingen mellom bruker og utdelt kode). Nå er level_number en vanlig
--     int uten fremmednøkkel, slik at raden – og koden – blir liggende.
--
--     user_codes.reward_id pekte tilsvarende på rewards med ON DELETE CASCADE,
--     så en slettet rabatt tømte «Mine koder» hos alle som hadde hentet den.
--     Nå settes reward_id til null i stedet: koden brukeren allerede har fått
--     blir stående (brand/title/code ligger på raden selv).
-- ---------------------------------------------------------------------------
alter table public.user_level_cases drop constraint if exists user_level_cases_level_number_fkey;

alter table public.user_codes drop constraint if exists user_codes_reward_id_fkey;
alter table public.user_codes
  add constraint user_codes_reward_id_fkey
  foreign key (reward_id) references public.rewards (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 38. Kassetrekningen tar hensyn til utløpsdato (seksjon 33) og deaktiverte
--     enkeltkoder (seksjon 34). En rabatt er «tilgjengelig» når den er aktiv
--     OG ikke utgått; en kode er «ledig» når den verken er hentet eller
--     deaktivert. Ellers uendret fra seksjon 30/32.
-- ---------------------------------------------------------------------------
-- Returtypen har fått en ny kolonne (link_url), og CREATE OR REPLACE kan ikke
-- endre returtypen på en eksisterende funksjon – derfor droppes den først.
drop function if exists public.open_level_case(int);

create or replace function public.open_level_case(p_level_number int)
returns table (brand text, title text, sub text, rarity text, image_url text, link_url text, code text, already_opened boolean)
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
      return query select null::text, null::text, null::text, null::text, null::text, null::text, existing.code, true;
      return;
    end if;
    return query select r.brand, r.title, r.sub, r.rarity, r.image_url, r.link_url, existing.code, true;
    return;
  end if;

  select rw.* into r
    from public.rewards rw
    join public.rarity_weights ww on ww.rarity = rw.rarity
   where rw.active
     and (rw.expires_at is null or rw.expires_at > now())
     and ww.weight > 0
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
        where reward_id = r.id and claimed_by is null and not disabled
        order by id
        limit 1
        for update skip locked
     )
     returning reward_codes.code into picked_code;

    if picked_code is null then
      raise exception 'Ingen flere koder igjen for denne rabatten akkurat nå';
    end if;

    select count(*) into remaining from public.reward_codes
     where reward_id = r.id and claimed_by is null and not disabled;
    if remaining = 0 then
      update public.rewards set active = false where id = r.id;
    end if;
  end if;

  insert into public.user_level_cases (user_id, level_number, reward_id, code)
  values (auth.uid(), p_level_number, r.id, picked_code);

  insert into public.user_codes (user_id, brand, title, code, reward_id)
  values (auth.uid(), r.brand, r.title, picked_code, r.id);

  return query select r.brand, r.title, r.sub, r.rarity, r.image_url, r.link_url, picked_code, false;
end;
$$;

revoke all on function public.open_level_case(int) from public;
grant execute on function public.open_level_case(int) to authenticated;

drop function if exists public.admin_preview_case();

create or replace function public.admin_preview_case()
returns table (brand text, title text, sub text, rarity text, image_url text, link_url text, code text)
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
   where rw.active
     and (rw.expires_at is null or rw.expires_at > now())
     and ww.weight > 0
   order by -ln(random()) / ww.weight
   limit 1;

  if r is null then
    raise exception 'Ingen rabatter tilgjengelig akkurat nå';
  end if;

  if r.code_type = 'general' then
    peeked_code := r.general_code;
  else
    select reward_codes.code into peeked_code
      from public.reward_codes
     where reward_id = r.id and claimed_by is null and not disabled
     order by random()
     limit 1;

    if peeked_code is null then
      raise exception 'Ingen flere koder igjen for denne rabatten akkurat nå';
    end if;
  end if;

  return query select r.brand, r.title, r.sub, r.rarity, r.image_url, r.link_url, peeked_code;
end;
$$;

revoke all on function public.admin_preview_case() from public;
grant execute on function public.admin_preview_case() to authenticated;

create or replace function public.reward_codes_remaining(p_reward_id bigint)
returns bigint
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(*)
    from public.reward_codes
   where reward_id = p_reward_id
     and claimed_by is null
     and not disabled;
$$;

-- ---------------------------------------------------------------------------
-- 39. RPC: admin_set_level_config – bygger hele nivåstigen ut fra ett tall.
--     p_step  = hvor mange poeng hvert nivå øker med (nivå N krever
--               (N - 1) * step poeng, så nivå 1 alltid er 0).
--     p_count = hvor mange nivåer stigen skal ha.
--     Nivåer over p_count slettes, manglende nivåer opprettes, og alle
--     poengkrav skrives om. Brukernes åpnede kasser (user_level_cases) og
--     hentede koder (user_codes) blir liggende uansett, se seksjon 37.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_level_config(p_step int, p_count int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Kun admin kan endre nivåstigen';
  end if;
  if p_step is null or p_step <= 0 then
    raise exception 'Poeng per nivå må være større enn 0';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Antall nivåer må være mellom 1 og 500';
  end if;

  insert into public.app_settings (id, level_step, updated_at)
  values (1, p_step, now())
  on conflict (id) do update set level_step = excluded.level_step, updated_at = now();

  delete from public.levels where level_number > p_count;

  insert into public.levels (level_number, points_required)
  select n, (n - 1) * p_step from generate_series(1, p_count) as n
  on conflict (level_number) do update set points_required = excluded.points_required;
end;
$$;

revoke all on function public.admin_set_level_config(int, int) from public;
grant execute on function public.admin_set_level_config(int, int) to authenticated;

-- Førstegangs-oppretting: gjør den eksisterende (ujevne) nivåstigen lineær
-- med standard 1 000 poeng per nivå, slik at nivåene stemmer med den nye
-- "poeng per nivå"-boksen i adminpanelet fra første stund.
update public.levels lv
   set points_required = (lv.level_number - 1) * (select level_step from public.app_settings where id = 1)
 where lv.points_required <> (lv.level_number - 1) * (select level_step from public.app_settings where id = 1);

-- ---------------------------------------------------------------------------
-- 40. Fiks: open_level_case kunne trekke en rabatt brukeren allerede hadde
--     fått utdelt fra et annet nivå (idempotens-sjekken i seksjon 38 er kun
--     per nivå, ikke per premie). user_codes_user_reward_idx (seksjon 20)
--     tillater bare én kode per bruker per premie, så insert i user_codes
--     feilet da med "duplicate key value violates unique constraint
--     user_codes_user_reward_idx" og hele kasseåpningen krasjet. Trekningen
--     ekskluderer nå premier brukeren allerede har fått kode for.
--
--     drop function if exists trengs her selv om returtypen er uendret fra
--     seksjon 38 – create or replace kan feile på "cannot change return
--     type of existing function" for table-funksjoner uansett, avhengig av
--     hva som faktisk ligger i databasen.
-- ---------------------------------------------------------------------------
drop function if exists public.open_level_case(int);

create or replace function public.open_level_case(p_level_number int)
returns table (brand text, title text, sub text, rarity text, image_url text, link_url text, code text, already_opened boolean)
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
      return query select null::text, null::text, null::text, null::text, null::text, null::text, existing.code, true;
      return;
    end if;
    return query select r.brand, r.title, r.sub, r.rarity, r.image_url, r.link_url, existing.code, true;
    return;
  end if;

  select rw.* into r
    from public.rewards rw
    join public.rarity_weights ww on ww.rarity = rw.rarity
   where rw.active
     and (rw.expires_at is null or rw.expires_at > now())
     and ww.weight > 0
     and not exists (
       select 1 from public.user_codes uc
        where uc.user_id = auth.uid() and uc.reward_id = rw.id
     )
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
        where reward_id = r.id and claimed_by is null and not disabled
        order by id
        limit 1
        for update skip locked
     )
     returning reward_codes.code into picked_code;

    if picked_code is null then
      raise exception 'Ingen flere koder igjen for denne rabatten akkurat nå';
    end if;

    select count(*) into remaining from public.reward_codes
     where reward_id = r.id and claimed_by is null and not disabled;
    if remaining = 0 then
      update public.rewards set active = false where id = r.id;
    end if;
  end if;

  insert into public.user_level_cases (user_id, level_number, reward_id, code)
  values (auth.uid(), p_level_number, r.id, picked_code);

  insert into public.user_codes (user_id, brand, title, code, reward_id)
  values (auth.uid(), r.brand, r.title, picked_code, r.id);

  return query select r.brand, r.title, r.sub, r.rarity, r.image_url, r.link_url, picked_code, false;
end;
$$;

revoke all on function public.open_level_case(int) from public;
grant execute on function public.open_level_case(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 41. app_settings: innstillinger for lykkehjulet og dagens triks.
--     wheel_spins_per_day: hvor mange ganger hver spiller kan spinne
--       lykkehjulet per døgn. 0 = ingen grense.
--     daily_game_rotation: når den er på, roterer "dagens triks" automatisk
--       til et nytt triks hvert døgn (rekkefølgen på forsiden brukes som
--       runde). Skrus den av, blir triksadmin har merket med is_daily_game
--       stående til det byttes manuelt.
-- ---------------------------------------------------------------------------
alter table public.app_settings add column if not exists wheel_spins_per_day int not null default 1
  constraint app_settings_wheel_spins_nonneg check (wheel_spins_per_day >= 0);
alter table public.app_settings add column if not exists daily_game_rotation boolean not null default true;

-- ---------------------------------------------------------------------------
-- 42. wheel_spins – én rad per spinn på lykkehjulet, med hvilken dato spinnet
--     hørte til (UTC-dato). Brukes til å håndheve dagsgrensen server-side, så
--     grensen ikke kan omgås ved å tømme localStorage.
-- ---------------------------------------------------------------------------
create table if not exists public.wheel_spins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  spun_on date not null default (now() at time zone 'utc')::date,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists wheel_spins_user_day_idx on public.wheel_spins (user_id, spun_on);

alter table public.wheel_spins enable row level security;

drop policy if exists "wheel_spins_select_own" on public.wheel_spins;
create policy "wheel_spins_select_own" on public.wheel_spins
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- 43. RPC: hvor mange spinn den innloggede brukeren har igjen i dag.
--     -1 betyr "ingen grense" (wheel_spins_per_day = 0).
-- ---------------------------------------------------------------------------
create or replace function public.wheel_spins_left()
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  per_day int;
  used int;
begin
  select coalesce(wheel_spins_per_day, 1) into per_day from public.app_settings where id = 1;
  if per_day is null then per_day := 1; end if;
  if per_day = 0 then return -1; end if;

  select count(*) into used
    from public.wheel_spins
   where user_id = auth.uid()
     and spun_on = (now() at time zone 'utc')::date;

  return greatest(0, per_day - used);
end;
$$;

revoke all on function public.wheel_spins_left() from public;
grant execute on function public.wheel_spins_left() to authenticated;

-- ---------------------------------------------------------------------------
-- 44. RPC: spinn lykkehjulet. Sjekker dagsgrensen, logger spinnet og legger
--     poengene til brukeren i én og samme transaksjon, slik at klienten ikke
--     kan spinne flere ganger enn admin har åpnet for.
-- ---------------------------------------------------------------------------
create or replace function public.spin_wheel(p_delta int)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_day int;
  used int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'p_delta må være et positivt tall';
  end if;

  select coalesce(wheel_spins_per_day, 1) into per_day from public.app_settings where id = 1;
  if per_day is null then per_day := 1; end if;

  if per_day > 0 then
    select count(*) into used
      from public.wheel_spins
     where user_id = auth.uid()
       and spun_on = (now() at time zone 'utc')::date;

    if used >= per_day then
      raise exception 'Du har brukt opp spinnene dine for i dag. Kom tilbake i morgen!';
    end if;
  end if;

  insert into public.wheel_spins (user_id, points) values (auth.uid(), p_delta);

  return public.add_points(p_delta);
end;
$$;

revoke all on function public.spin_wheel(int) from public;
grant execute on function public.spin_wheel(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 45. guest_game_plays – logger runder spilt av utloggede besøkende, slik at
--     adminpanelets statistikk (spilte runder / poeng per spill) også dekker
--     gjester, ikke bare innloggede brukere (game_records krever user_id og
--     kan derfor aldri inneholde gjesterunder). Ingen personopplysninger
--     lagres – kun hvilket spill og skåren, uten noen kobling til besøkeren –
--     så tallene kan brukes til volum, men ikke til gjeste-retention.
-- ---------------------------------------------------------------------------
create table if not exists public.guest_game_plays (
  id bigint generated always as identity primary key,
  game_id text not null,
  score numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists guest_game_plays_game_idx on public.guest_game_plays (game_id);
create index if not exists guest_game_plays_created_idx on public.guest_game_plays (created_at);

alter table public.guest_game_plays enable row level security;

-- Alle (også utlogget) kan legge inn en rad når de fullfører et spill uten å
-- være innlogget. Kun admin kan lese dem tilbake – det er kun adminpanelets
-- statistikk som trenger dem.
drop policy if exists "guest_game_plays_insert_all" on public.guest_game_plays;
create policy "guest_game_plays_insert_all" on public.guest_game_plays
  for insert with check (true);

drop policy if exists "guest_game_plays_select_admin" on public.guest_game_plays;
create policy "guest_game_plays_select_admin" on public.guest_game_plays
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 46. site_visits – enkel, anonym besøksmåling for adminpanelets "aktive
--     personer i dag" (Oversikt/Statistikk). Bygges av js/visit-tracking.js,
--     som kjøres på alle sider (via layout) og registrerer maks én rad per
--     dag per besøker – innlogget eller ikke – med en tilfeldig visitor-id
--     lagret i nettleserens localStorage. Pinger kun når brukeren har gitt
--     samtykke til statistikk-informasjonskapsler (se js/consent.js), så
--     "aktive personer" er derfor et minstetall, ikke et eksakt tall.
--
--     Ingen kobling til e-post/IP lagres – kun en tilfeldig id, dato og
--     (om innlogget) profil-id, slik at admin kan se om aktiviteten kommer
--     fra registrerte brukere eller gjester.
-- ---------------------------------------------------------------------------
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  unique (visitor_id, day)
);

create index if not exists site_visits_day_idx on public.site_visits (day);

alter table public.site_visits enable row level security;

-- Alle (også utlogget) kan registrere at de var innom i dag. Kun admin kan
-- lese dataene tilbake – det er kun adminpanelet som trenger dem.
drop policy if exists "site_visits_insert_all" on public.site_visits;
create policy "site_visits_insert_all" on public.site_visits
  for insert with check (true);

drop policy if exists "site_visits_select_admin" on public.site_visits;
create policy "site_visits_select_admin" on public.site_visits
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 47. guides / guide_modules – "Guider og ressurser" (guider.html + guide.html).
--
--     `guides` er ett kort per guide (tittel, kategori, ingress, "mengde
--     spart/tjent" og lesetid). `guide_modules` er innholdet i guiden, som en
--     rekke moduler i rekkefølge (sort_order) – hver modul har en `type`
--     (tekst/fil/tabell/gevinst/poll/triks/bilde) og alle detaljene sine i `data`
--     (jsonb), slik at nye felter kan legges til uten skjemaendring.
--
--     Det finnes ingen egen adminpanel-seksjon for dette – admin oppretter,
--     redigerer og sletter guider og moduler direkte fra de offentlige sidene
--     guider.html og guide.html (se js/guides.js), på samme måte som resten av
--     siden bruker RLS (under) til å håndheve at kun admin kan skrive.
--
--     Modul-typer og felter i `data`:
--       tekst   – { heading, headingLevel (2|3), body (avsnitt skilt med
--                   tomlinje), bullets: string[], tip }
--       fil     – { name, ext, meta, url } – url peker til `guide-files`-bøtta
--       tabell  – { title, rows: [{a,b,c}], source }
--       gevinst – { heading, note, gains: [{label, amountKr, displayText}] } –
--                   summen regnes ut i js/guides.js fra amountKr-feltene
--       poll    – { question, options: [{label, votes}] } – votes økes av
--                   RPC-en guide_vote_poll under, ikke direkte av klienten
--       triks   – { gameId, title, intro, href } – peker enten til et
--                   eksisterende triks (gameId) eller en egen lenke (href)
--       bilde   – { url, alt, caption, size ('full'|'medium') } – url peker til
--                   `guide-images`-bøtta, alt er alt-teksten for skjermlesere
-- ---------------------------------------------------------------------------
create table if not exists public.guides (
  id text primary key,
  title text not null default '',
  category text not null default '',
  excerpt text not null default '',
  value_label text not null default '',
  read_time text not null default '',
  cover_url text,
  is_featured boolean not null default false,
  is_hidden boolean not null default false,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.guides add column if not exists is_hidden boolean not null default false;

-- Kun én guide kan være fremhevet (toppkortet på guider.html) om gangen.
create unique index if not exists guides_single_featured_idx
  on public.guides (is_featured) where is_featured;

alter table public.guides enable row level security;

drop policy if exists "guides_select_all" on public.guides;
create policy "guides_select_all" on public.guides
  for select using (true);

drop policy if exists "guides_admin_write" on public.guides;
create policy "guides_admin_write" on public.guides
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.guide_modules (
  id bigint generated always as identity primary key,
  guide_id text not null references public.guides (id) on delete cascade,
  type text not null check (type in ('tekst', 'fil', 'tabell', 'gevinst', 'poll', 'triks', 'bilde')),
  sort_order int not null default 0,
  data jsonb not null default '{}'::jsonb
);

-- Modul-typene utvides over tid. `create table if not exists` over rører ikke
-- en tabell som allerede finnes, så check-en settes eksplisitt på nytt her –
-- ellers ville nye typer (bilde) blitt avvist i eksisterende prosjekter.
alter table public.guide_modules drop constraint if exists guide_modules_type_check;
alter table public.guide_modules
  add constraint guide_modules_type_check
  check (type in ('tekst', 'fil', 'tabell', 'gevinst', 'poll', 'triks', 'bilde'));

create index if not exists guide_modules_guide_idx on public.guide_modules (guide_id, sort_order);

alter table public.guide_modules enable row level security;

drop policy if exists "guide_modules_select_all" on public.guide_modules;
create policy "guide_modules_select_all" on public.guide_modules
  for select using (true);

drop policy if exists "guide_modules_admin_write" on public.guide_modules;
create policy "guide_modules_admin_write" on public.guide_modules
  for all using (public.is_admin()) with check (public.is_admin());

-- Avstemningsmodulen kan besvares av alle, også utlogget besøkende. Selve
-- opptellingen skjer i denne funksjonen (security definer) i stedet for at
-- klienten skriver til `data` selv – ellers måtte alle kunnet skrive til
-- guide_modules, og da kunne hvem som helst redigert resten av innholdet også.
create or replace function public.guide_vote_poll(p_module_id bigint, p_option_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  update public.guide_modules
     set data = jsonb_set(
       data,
       array['options', p_option_index::text, 'votes'],
       to_jsonb(coalesce((data -> 'options' -> p_option_index ->> 'votes')::int, 0) + 1)
     )
   where id = p_module_id and type = 'poll'
   returning data into v_data;

  if v_data is null then
    raise exception 'Fant ikke avstemningsmodulen';
  end if;

  return v_data;
end;
$$;

grant execute on function public.guide_vote_poll(bigint, int) to anon, authenticated;

-- Bilder til guide-kort/toppbilde og nedlastbare filer (fil-modulen) – samme
-- mønster som game-images/reward-images: offentlig lesbar bøtte, kun admin
-- kan laste opp/endre/slette.
insert into storage.buckets (id, name, public)
values ('guide-images', 'guide-images', true)
on conflict (id) do nothing;

drop policy if exists "guide_images_select_all" on storage.objects;
create policy "guide_images_select_all" on storage.objects
  for select using (bucket_id = 'guide-images');

drop policy if exists "guide_images_admin_write" on storage.objects;
create policy "guide_images_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'guide-images' and public.is_admin());

drop policy if exists "guide_images_admin_update" on storage.objects;
create policy "guide_images_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'guide-images' and public.is_admin())
  with check (bucket_id = 'guide-images' and public.is_admin());

drop policy if exists "guide_images_admin_delete" on storage.objects;
create policy "guide_images_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'guide-images' and public.is_admin());

insert into storage.buckets (id, name, public)
values ('guide-files', 'guide-files', true)
on conflict (id) do nothing;

drop policy if exists "guide_files_select_all" on storage.objects;
create policy "guide_files_select_all" on storage.objects
  for select using (bucket_id = 'guide-files');

drop policy if exists "guide_files_admin_write" on storage.objects;
create policy "guide_files_admin_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'guide-files' and public.is_admin());

drop policy if exists "guide_files_admin_update" on storage.objects;
create policy "guide_files_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'guide-files' and public.is_admin())
  with check (bucket_id = 'guide-files' and public.is_admin());

drop policy if exists "guide_files_admin_delete" on storage.objects;
create policy "guide_files_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'guide-files' and public.is_admin());

-- Eksempelguiden fra designet ("Hvordan tjene penger på å sitte i
-- elevrådet") settes inn som utgangspunkt, med én modul av hver type – rediger
-- eller slett den fritt fra guider.html/guide.html, den er ikke spesialbehandlet.
--
-- is_featured settes kun hvis INGEN guide er fremhevet fra før.
--
-- «on conflict (id) do nothing» fanger bare konflikter på primærnøkkelen.
-- Har man slettet denne eksempelguiden fra adminpanelet og fremhevet en
-- annen i stedet, finnes det ingen id-konflikt – raden settes inn med
-- is_featured = true, og bryter da den ANDRE unike indeksen
-- (guides_single_featured_idx, «kun én fremhevet guide»). Resultatet var at
-- hele schema.sql stoppet med
--   duplicate key value violates unique constraint "guides_single_featured_idx"
-- for alle som hadde byttet fremhevet guide, og alt lenger nede i filen ble
-- aldri kjørt.
insert into public.guides (id, title, category, excerpt, value_label, read_time, is_featured, sort_order) values
  ('elevrad-penger', 'Hvordan tjene penger på å sitte i elevrådet', 'Elevrådet', 'Honorar, møtegodtgjørelse, reisedekning og fondene elevrådet kan søke på.', 'Opptil 12 000 kr', '8 min',
   not exists (select 1 from public.guides where is_featured), 1)
on conflict (id) do nothing;

insert into public.guide_modules (guide_id, type, sort_order, data)
select * from (values
  ('elevrad-penger', 'tekst', 1, '{
    "heading": "Slik kommer du i gang",
    "headingLevel": 2,
    "body": "De fleste elevråd har rett på mer penger enn de bruker. Pengene ligger tre steder: i skolens eget elevrådsbudsjett, i fylkets tilskuddsordninger, og i eksterne fond som deler ut midler til elevdemokrati. Start med å finne ut hvilket av de tre skolen din allerede bruker.\n\nBe rektor om budsjettlinja for elevrådet. Den skal finnes skriftlig, og du har rett til å se den. Er summen under 100 kroner per elev, ligger skolen lavt sammenlignet med snittet.",
    "bullets": ["Spør etter budsjettlinja skriftlig, i god tid før neste møte.", "Sammenlign med naboskolene – tall gir tyngde i forhandlingen.", "Skriv et kort krav med sum, formål og frist."],
    "tip": "Møtegodtgjørelse må vedtas før arbeidet er gjort. Ta det opp på det første møtet i skoleåret."
  }'::jsonb),
  ('elevrad-penger', 'fil', 2, '{"name": "Budsjettmal for elevrådet", "ext": "XLSX", "meta": "Regneark · 42 kB · ferdig utfylt eksempel inkludert", "url": null}'::jsonb),
  ('elevrad-penger', 'tabell', 3, '{
    "title": "Satser per verv, skoleåret 2026/27",
    "columns": ["Verv", "Godtgjørelse", "Per år"],
    "source": "Kilde: innsamlede satser fra 34 videregående skoler, august 2026.",
    "rows": [
      {"a": "Elevrådsleder", "b": "Honorar + møtegodtgjørelse", "c": "10 200 kr"},
      {"a": "Nestleder", "b": "Halvt honorar + møtegodtgjørelse", "c": "7 200 kr"},
      {"a": "Økonomiansvarlig", "b": "Møtegodtgjørelse", "c": "4 200 kr"},
      {"a": "Klassetillitsvalgt", "b": "Ingen fast sats", "c": "0 kr"}
    ]
  }'::jsonb),
  ('elevrad-penger', 'gevinst', 4, '{
    "heading": "Dette kan du tjene",
    "note": "per skoleår, som leder med full dekning",
    "gains": [
      {"label": "Møtegodtgjørelse, 14 møter", "amountKr": 4200},
      {"label": "Honorar som elevrådsleder", "amountKr": 6000},
      {"label": "Dekket reise til fylkessamlinger", "amountKr": 1800},
      {"label": "Tilskudd fra elevdemokratifondet", "amountKr": 0, "displayText": "søkes særskilt"}
    ]
  }'::jsonb),
  ('elevrad-penger', 'poll', 5, '{
    "question": "Får elevrådet ditt honorar i dag?",
    "options": [
      {"label": "Ja, vedtatt honorar", "votes": 148},
      {"label": "Bare dekning av reise", "votes": 96},
      {"label": "Nei, ingenting", "votes": 312}
    ]
  }'::jsonb),
  ('elevrad-penger', 'triks', 6, '{"gameId": null, "title": "Budsjett-byggeren", "intro": "Sett opp elevrådets årsbudsjett på tid og se hvor pengene forsvinner. Gir poeng til rangeringen.", "href": null}'::jsonb),
  ('elevrad-penger', 'tekst', 7, '{
    "heading": "Neste steg",
    "headingLevel": 2,
    "body": "Har du fått vedtaket i boks, er neste jobb å søke eksterne midler. Se etter flere guider om arrangementer og søknader i listen over alle guider.",
    "bullets": [],
    "tip": null
  }'::jsonb)
) as v(guide_id, type, sort_order, data)
where not exists (select 1 from public.guide_modules where guide_id = 'elevrad-penger');

-- Tre ressursguider flyttet inn fra skolesaus.no (mal-siden, P-matte-siden og
-- nynorsk-oversetteren) – samme redirect+popup-mønster som spillene bruker
-- (js/new-site-welcome-modal.js), bare med "guiden" i teksten i stedet for
-- "spillet". Filene modulene peker til ligger statisk i /documents/ i dette
-- repoet; admin kan bytte dem ut når som helst fra "Rediger modul" på
-- guide.html, som laster opp til guide-files-bøtta og overskriver url-en.
insert into public.guides (id, title, category, excerpt, value_label, read_time, is_featured, sort_order) values
  ('mal-norsk-nynorsk', 'Mal til norsk og nynorsk', 'Norsk', 'Ferdige maler til fagtekst, retorisk analyse, essay, leserinnlegg, sammenligning og novelle-/diktanalyse.', '', '2 min', false, 2),
  ('p-matte-snarveier', 'Snarveier til P-matte', 'Matte', 'Snarveier til Del 2 av eksamen, tilpasset 1P, 1PY, 2P og 2PY.', '', '1 min', false, 3),
  ('nynorsk-oversetter', 'Nynorsk-oversetter', 'Norsk', 'Din praktiske guide for bokmål → nynorsk-oversettelse, med oppsett for autokorrektur og full ordliste.', '', '5 min', false, 4)
on conflict (id) do nothing;

insert into public.guide_modules (guide_id, type, sort_order, data)
select * from (values
  ('mal-norsk-nynorsk', 'tekst', 1, '{
    "heading": "Slik bruker du malene",
    "headingLevel": 2,
    "body": "Her finner du maler til fagtekst, retorisk analyse, essay, leserinnlegg, sammenligning og novelle- og diktanalyse – last ned den formen som passer i PDF eller DOCX.",
    "bullets": [],
    "tip": "Det kan hende du får opp en feilmelding når du prøver å laste ned DOCX-filen. Trykk bare \"Ja\" i dialogboksen, så åpnes filen som normalt."
  }'::jsonb),
  ('mal-norsk-nynorsk', 'fil', 2, '{"name": "Snorres hjelpehefte (PDF)", "ext": "PDF", "meta": "PDF · maler til fagtekst, retorisk analyse, essay, leserinnlegg, sammenligning og novelle-/diktanalyse", "url": "documents/Snorres_hjelpehefte.pdf"}'::jsonb),
  ('mal-norsk-nynorsk', 'fil', 3, '{"name": "Snorres hjelpehefte (DOCX)", "ext": "DOCX", "meta": "Word-dokument · samme maler, redigerbar", "url": "documents/Snorres_hjelpehefte.docx"}'::jsonb),

  ('p-matte-snarveier', 'tekst', 1, '{
    "heading": "Slik bruker du snarveiene",
    "headingLevel": 2,
    "body": "Snarveiene under kan brukes på Del 2 av eksamen, og er tilpasset 1P, 1PY, 2P og 2PY. Last ned regnearket og ha det oppe ved siden av eksamenen.",
    "bullets": [],
    "tip": null
  }'::jsonb),
  ('p-matte-snarveier', 'fil', 2, '{"name": "Snorres Matteskjema", "ext": "XLSX", "meta": "Regneark · snarveier tilpasset 1P, 1PY, 2P og 2PY", "url": "documents/Snorres_Matteskjema.xlsx"}'::jsonb),

  ('nynorsk-oversetter', 'tekst', 1, '{
    "heading": "Hvordan bruker du denne?",
    "headingLevel": 2,
    "body": "Åpne et Word-dokument og bytt språket til nynorsk. Klikk deretter på Fil, velg Alternativer, og gå til Korrektur. Klikk på Alternativer for autokorrektur, og kopier inn ordene fra listene under ved å trykke på dem – legg dem inn i autokorrektur-listen.\n\nNoen ord som \"dere\", \"de\" eller \"noen\" er ikke med i listen, fordi de kan bli til ulike ord på nynorsk avhengig av sammenhengen.",
    "bullets": [],
    "tip": "Trykk Windows + Shift for å ha denne siden og Word oppe samtidig!"
  }'::jsonb),
  ('nynorsk-oversetter', 'tabell', 2, '{
    "title": "De viktigste ordene",
    "columns": ["Bokmål", "Nynorsk", ""],
    "source": "",
    "rows": [{"a": "jeg", "b": "eg", "c": ""}, {"a": "ikke", "b": "ikkje", "c": ""}, {"a": "en", "b": "ein", "c": ""}, {"a": "et", "b": "eit", "c": ""}, {"a": "ett", "b": "eitt", "c": ""}, {"a": "man", "b": "ein", "c": ""}, {"a": "bare", "b": "berre", "c": ""}, {"a": "eksempel", "b": "døme", "c": ""}, {"a": "for eksempel", "b": "til dømes", "c": ""}, {"a": "også", "b": "òg", "c": ""}, {"a": "disse", "b": "desse", "c": ""}, {"a": "vi", "b": "me", "c": ""}, {"a": "siden", "b": "sidan", "c": ""}, {"a": "gjøre", "b": "gjere", "c": ""}, {"a": "derfor", "b": "difor", "c": ""}, {"a": "fra", "b": "frå", "c": ""}, {"a": "hvorfor", "b": "kvifor", "c": ""}, {"a": "hvordan", "b": "korleis", "c": ""}, {"a": "hva", "b": "kva", "c": ""}, {"a": "hvilken", "b": "kva for ein", "c": ""}]
  }'::jsonb),
  ('nynorsk-oversetter', 'tabell', 3, '{
    "title": "Andre ord",
    "columns": ["Bokmål", "Nynorsk", ""],
    "source": "",
    "rows": [{"a": "annenhver", "b": "annankvar", "c": ""}, {"a": "annerledes", "b": "annleis", "c": ""}, {"a": "virkemiddel", "b": "verkemiddel", "c": ""}, {"a": "språklig", "b": "språkleg", "c": ""}, {"a": "enten", "b": "anten", "c": ""}, {"a": "hete", "b": "heite", "c": ""}, {"a": "igjen", "b": "att", "c": ""}, {"a": "velge", "b": "velje", "c": ""}, {"a": "være", "b": "vere", "c": ""}, {"a": "blir", "b": "vert", "c": ""}, {"a": "bli", "b": "verte", "c": ""}, {"a": "engang", "b": "eingong", "c": ""}, {"a": "ved siden av", "b": "attmed", "c": ""}, {"a": "drar", "b": "dreg", "c": ""}, {"a": "da", "b": "då", "c": ""}, {"a": "eget", "b": "eige", "c": ""}, {"a": "eie", "b": "eige", "c": ""}, {"a": "eneste", "b": "einaste", "c": ""}, {"a": "enkel", "b": "einskild", "c": ""}, {"a": "fremmed", "b": "framand", "c": ""}, {"a": "foran", "b": "framfor", "c": ""}, {"a": "fremdeles", "b": "framleis", "c": ""}, {"a": "først", "b": "fyrst", "c": ""}, {"a": "gi", "b": "gje", "c": ""}, {"a": "hjem", "b": "heim", "c": ""}, {"a": "hjemme", "b": "heime", "c": ""}, {"a": "hennes", "b": "hennar", "c": ""}, {"a": "hos", "b": "hjå", "c": ""}, {"a": "hun", "b": "ho", "c": ""}, {"a": "huske", "b": "hugse", "c": ""}, {"a": "høy", "b": "høg", "c": ""}, {"a": "høyre", "b": "høgre", "c": ""}, {"a": "kommer", "b": "kjem", "c": ""}, {"a": "kjærlighet", "b": "kjærleik", "c": ""}, {"a": "hvor", "b": "kor", "c": ""}, {"a": "verken", "b": "korkje", "c": ""}, {"a": "hvordan", "b": "korleis", "c": ""}, {"a": "hver", "b": "kvar", "c": ""}, {"a": "hverandre", "b": "kvarandre", "c": ""}, {"a": "hvem", "b": "kven", "c": ""}, {"a": "leste", "b": "las", "c": ""}, {"a": "lest", "b": "lese", "c": ""}, {"a": "leser", "b": "les", "c": ""}, {"a": "lav", "b": "låg", "c": ""}, {"a": "lå", "b": "låg", "c": ""}, {"a": "mye", "b": "mykje", "c": ""}, {"a": "mandag", "b": "måndag", "c": ""}, {"a": "nå", "b": "no", "c": ""}, {"a": "noe", "b": "noko", "c": ""}, {"a": "fornøyd", "b": "nøgd", "c": ""}, {"a": "også", "b": "òg", "c": ""}, {"a": "sammen", "b": "saman", "c": ""}, {"a": "si", "b": "seie", "c": ""}, {"a": "selger", "b": "sel", "c": ""}, {"a": "selv", "b": "sjølv", "c": ""}, {"a": "se", "b": "sjå", "c": ""}, {"a": "forskjell", "b": "skilnad", "c": ""}, {"a": "skyldes", "b": "skuldast", "c": ""}, {"a": "spille", "b": "spele", "c": ""}, {"a": "spørre", "b": "spørje", "c": ""}, {"a": "sted", "b": "stad", "c": ""}, {"a": "størrelse", "b": "storleik", "c": ""}, {"a": "søndag", "b": "sundag", "c": ""}, {"a": "veldig", "b": "særs", "c": ""}, {"a": "telle", "b": "telje", "c": ""}, {"a": "for eksempel", "b": "til dømes", "c": ""}, {"a": "til tross for", "b": "trass i", "c": ""}, {"a": "tirsdag", "b": "tysdag", "c": ""}, {"a": "voksen", "b": "vaksen", "c": ""}, {"a": "forsiktig", "b": "varsam", "c": ""}, {"a": "ble", "b": "vart", "c": ""}, {"a": "vann", "b": "vatn", "c": ""}, {"a": "vindu", "b": "vindauge", "c": ""}, {"a": "vært", "b": "vore", "c": ""}, {"a": "blitt", "b": "vorte", "c": ""}, {"a": "alene", "b": "åleine", "c": ""}, {"a": "følelser", "b": "kjensler", "c": ""}, {"a": "tenke", "b": "tenkje", "c": ""}, {"a": "barn", "b": "born", "c": ""}, {"a": "begynne", "b": "byrje", "c": ""}]
  }'::jsonb),
  ('nynorsk-oversetter', 'fil', 4, '{"name": "Nynorsk-ordliste (Excel)", "ext": "XLSX", "meta": "Regneark · alle ordene · kolonner for nynorsk og norsk", "url": "documents/Nynorskordliste.xlsx"}'::jsonb)
) as v(guide_id, type, sort_order, data)
where not exists (select 1 from public.guide_modules where guide_id in ('mal-norsk-nynorsk', 'p-matte-snarveier', 'nynorsk-oversetter'));

-- ---------------------------------------------------------------------------
-- 48. Rekorder skrives ikke lenger rett fra nettleseren.
--
--     Slik det var: klienten gjorde `insert into game_records (...)` og kalte
--     `add_points(p_delta)` med et fritt tall. Begge deler kunne kjøres fra
--     nettleserkonsollen av hvem som helst som var logget inn:
--
--       supabaseClient.rpc('add_points', { p_delta: 10000000 })
--
--     Da er hele rangeringen verdiløs. Nå går all poenggivning gjennom
--     submit_game_score(), som selv regner ut hvor mange poeng skåren er
--     verdt, håndhever et tak per triks og en fartsgrense per bruker.
--
--     Dette gjør det ikke umulig å jukse (all klientkode kan manipuleres),
--     men det flytter jukset fra «ett linjes kall i konsollen» til «du må
--     faktisk spille, og du kan ikke få mer enn taket per runde».
-- ---------------------------------------------------------------------------

-- Tak per runde per triks. null = bruk standardtaket under. Redigeres i
-- adminpanelet sammen med point_rate.
alter table public.games add column if not exists max_score numeric;

-- Standardtak for triks som ikke har satt sitt eget. Rundene i dagens triks
-- ligger typisk på 1 000–30 000, så 250 000 stopper det absurde uten å
-- ramme en reell topprunde.
alter table public.app_settings add column if not exists default_max_score numeric not null default 250000;

-- Hvor mange runder én bruker kan levere inn per time. En ivrig spiller
-- rekker sjelden mer enn 20–30; 120 er romslig, men stopper et skript som
-- pumper inn tusen runder i minuttet.
alter table public.app_settings add column if not exists max_scores_per_hour int not null default 120;

create index if not exists game_records_user_created_idx
  on public.game_records (user_id, created_at desc);

/**
 * Leverer inn én ferdigspilt runde. Returnerer den oppdaterte profilraden
 * (samme form som add_points gjorde), slik at klienten kan animere xp/nivå
 * uten et ekstra oppslag.
 */
create or replace function public.submit_game_score(p_game_id text, p_score numeric)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  game public.games;
  cap numeric;
  per_hour int;
  used int;
  rate numeric;
  awarded int;
  updated public.profiles;
  best_level int;
begin
  if uid is null then
    raise exception 'Du må være logget inn for å lagre en runde';
  end if;

  if p_score is null or p_score < 0 or p_score <> floor(p_score) then
    raise exception 'Ugyldig skår';
  end if;

  select * into game from public.games where id = p_game_id and hidden = false;
  if game is null then
    raise exception 'Ukjent triks: %', p_game_id;
  end if;

  select coalesce(default_max_score, 250000), coalesce(max_scores_per_hour, 120)
    into cap, per_hour
    from public.app_settings where id = 1;
  cap := coalesce(game.max_score, cap, 250000);
  per_hour := coalesce(per_hour, 120);

  if p_score > cap then
    raise exception 'Skåren er høyere enn taket for dette trikset (%).', cap;
  end if;

  if per_hour > 0 then
    select count(*) into used
      from public.game_records
     where user_id = uid
       and created_at > now() - interval '1 hour';
    if used >= per_hour then
      raise exception 'Du har levert inn for mange runder på kort tid. Prøv igjen om litt.';
    end if;
  end if;

  insert into public.game_records (user_id, game_id, score) values (uid, p_game_id, p_score);

  -- Poengene regnes ut HER, ikke i nettleseren: klienten sender bare skåren.
  rate := coalesce(game.point_rate, 1);
  if rate < 0 then rate := 0; end if;
  awarded := round(p_score * rate);

  if awarded > 0 then
    perform set_config('studilla.trusted_profile_write', 'on', true);
    update public.profiles set xp = xp + awarded where id = uid returning * into updated;
  else
    select * into updated from public.profiles where id = uid;
  end if;

  if updated is null then
    raise exception 'Fant ingen profil for innlogget bruker';
  end if;

  select max(level_number) into best_level
    from public.levels where points_required <= updated.xp;

  if best_level is not null and best_level > updated.level then
    perform set_config('studilla.trusted_profile_write', 'on', true);
    update public.profiles set level = best_level where id = uid returning * into updated;
  end if;

  return updated;
end;
$$;

revoke all on function public.submit_game_score(text, numeric) from public;
grant execute on function public.submit_game_score(text, numeric) to authenticated;

/**
 * Overfører rekordene en besøkende satte mens hen var utlogget (lagret i
 * localStorage av js/game-runtime.js) til kontoen ved første innlogging.
 * Kjører hver rad gjennom det samme taket som submit_game_score, slik at
 * gjeste-nøkkelen i localStorage ikke blir en bakvei rundt valideringen.
 *
 * p_records: [{ "game_id": "2048", "score": 8460 }, ...]
 */
create or replace function public.claim_guest_progress(p_records jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec jsonb;
  updated public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Du må være logget inn';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    select * into updated from public.profiles where id = auth.uid();
    return updated;
  end if;

  -- Maks 20 rader – flere enn ett per triks gir ingen mening.
  for rec in select * from jsonb_array_elements(p_records) limit 20 loop
    begin
      updated := public.submit_game_score(rec->>'game_id', (rec->>'score')::numeric);
    exception when others then
      -- En ugyldig rad (ukjent triks, over taket) skal ikke stoppe resten.
      null;
    end;
  end loop;

  if updated is null then
    select * into updated from public.profiles where id = auth.uid();
  end if;
  return updated;
end;
$$;

revoke all on function public.claim_guest_progress(jsonb) from public;
grant execute on function public.claim_guest_progress(jsonb) to authenticated;

-- Direkte innsetting i game_records er nå stengt: alt går via RPC-en over,
-- som kjører som SECURITY DEFINER og derfor ikke berøres av denne policyen.
drop policy if exists "game_records_insert_own" on public.game_records;

-- add_points ga fritt spillerom til å legge til vilkårlig mange poeng.
-- Lykkehjulet (spin_wheel) kaller den fortsatt internt – den er SECURITY
-- DEFINER og kjører som eieren, så den mister ikke tilgangen her.
revoke execute on function public.add_points(int) from authenticated;

/**
 * Lykkehjulet fikk tidligere premien sendt inn fra klienten
 * (spin_wheel(p_delta)), så «vinn 1000 poeng» kunne bli «vinn 10 000 000».
 * Premien avgrenses nå til det admin faktisk har lagt inn som segmenter på
 * hjulet, med en absolutt øvre grense i tillegg.
 */
alter table public.app_settings add column if not exists wheel_max_prize int not null default 1000;

create or replace function public.spin_wheel(p_delta int)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_day int;
  used int;
  max_prize int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'p_delta må være et positivt tall';
  end if;

  select coalesce(wheel_spins_per_day, 1), coalesce(wheel_max_prize, 1000)
    into per_day, max_prize
    from public.app_settings where id = 1;
  if per_day is null then per_day := 1; end if;
  if max_prize is null then max_prize := 1000; end if;

  if p_delta > max_prize then
    raise exception 'Premien er høyere enn det hjulet kan gi.';
  end if;

  if per_day > 0 then
    select count(*) into used
      from public.wheel_spins
     where user_id = auth.uid()
       and spun_on = (now() at time zone 'utc')::date;

    if used >= per_day then
      raise exception 'Du har brukt opp spinnene dine for i dag. Kom tilbake i morgen!';
    end if;
  end if;

  insert into public.wheel_spins (user_id, points) values (auth.uid(), p_delta);

  return public.add_points(p_delta);
end;
$$;

revoke all on function public.spin_wheel(int) from public;
grant execute on function public.spin_wheel(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 49. Streak – grunnen til å komme tilbake i morgen.
--
--     Dagens triks roterte allerede på døgnnummer, men ingenting fortalte
--     spilleren at det var noe å miste ved å hoppe over en dag. Streaken
--     teller sammenhengende dager med minst én ferdigspilt runde, og gir en
--     liten poengbonus som vokser med lengden.
--
--     Dagsgrensen følger norsk tid (Europe/Oslo), ikke UTC: en runde spilt
--     kl. 23:30 og en kl. 00:30 skal telle som to dager for spilleren, slik
--     hen selv opplever døgnet.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists streak_current int not null default 0;
alter table public.profiles add column if not exists streak_best int not null default 0;
alter table public.profiles add column if not exists streak_last_day date;

alter table public.app_settings add column if not exists streak_bonus_base int not null default 25;
alter table public.app_settings add column if not exists streak_bonus_max int not null default 250;

/**
 * Registrerer at brukeren har spilt i dag og oppdaterer streaken.
 * Returnerer:
 *   { streak, best, bonus, is_new_day, broke_from }
 * der bonus er poengene som ble lagt til (0 hvis dagen allerede var talt),
 * og broke_from er streaken som gikk tapt hvis det er mer enn én dag siden
 * sist – slik at UIen kan si «du mistet en 6-dagers rekke» i stedet for å la
 * tallet bare hoppe til 1.
 */
create or replace function public.touch_daily_streak()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Europe/Oslo')::date;
  prof public.profiles;
  new_streak int;
  broke_from int := 0;
  bonus int := 0;
  base int;
  cap int;
begin
  if uid is null then
    return jsonb_build_object('streak', 0, 'best', 0, 'bonus', 0, 'is_new_day', false, 'broke_from', 0);
  end if;

  select * into prof from public.profiles where id = uid;
  if prof is null then
    raise exception 'Fant ingen profil for innlogget bruker';
  end if;

  if prof.streak_last_day = today then
    return jsonb_build_object(
      'streak', prof.streak_current, 'best', prof.streak_best,
      'bonus', 0, 'is_new_day', false, 'broke_from', 0
    );
  end if;

  if prof.streak_last_day = today - 1 then
    new_streak := prof.streak_current + 1;
  else
    broke_from := case when prof.streak_current > 1 then prof.streak_current else 0 end;
    new_streak := 1;
  end if;

  select coalesce(streak_bonus_base, 25), coalesce(streak_bonus_max, 250)
    into base, cap from public.app_settings where id = 1;
  base := coalesce(base, 25);
  cap := coalesce(cap, 250);
  bonus := least(cap, base * new_streak);

  perform set_config('studilla.trusted_profile_write', 'on', true);
  update public.profiles
     set streak_current = new_streak,
         streak_best = greatest(streak_best, new_streak),
         streak_last_day = today,
         xp = xp + bonus
   where id = uid
   returning * into prof;

  return jsonb_build_object(
    'streak', prof.streak_current,
    'best', prof.streak_best,
    'bonus', bonus,
    'is_new_day', true,
    'broke_from', broke_from
  );
end;
$$;

revoke all on function public.touch_daily_streak() from public;
grant execute on function public.touch_daily_streak() to authenticated;

-- Streak-feltene må beskyttes på samme måte som level/xp: uten dette kunne
-- en bruker skrive `update profiles set streak_current = 365` på sin egen rad
-- (RLS tillater oppdatering av egen profil), og streaken ville vært like
-- verdiløs som poengsummen var før seksjon 48.
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
    new.streak_current := old.streak_current;
    new.streak_best := old.streak_best;
    new.streak_last_day := old.streak_last_day;
  end if;
  return new;
end;
$$;

-- streak-feltene skal være synlige på offentlige profiler og i rangeringen.
--
-- MERK: `create or replace view` kan ikke legge til kolonner i en view som
-- allerede finnes med færre – den feiler med «cannot drop columns from view».
-- Seksjon 24 over definerer den samme viewen uten streak-kolonnene, så ved
-- en ny kjøring av hele filen (som er den vanlige måten å migrere på her)
-- ville dette stoppet skriptet. Derfor slippes den først.
drop view if exists public.profiles_public;
create view public.profiles_public as
  select id, username, avatar_color, avatar_icon, level, xp, is_hidden, created_at,
         streak_current, streak_best
    from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 50. user_blocks – blokkering.
--
--     Målgruppen er skoleelever. Et sosialt lag uten blokkering er ikke
--     ferdig, det er en fremtidig sak for den som drifter siden. En
--     blokkering stopper både meldinger og følging begge veier.
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- Man ser kun sine egne blokkeringer (den blokkerte skal ikke få vite det),
-- og kan bare opprette/slette sine egne.
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert with check (auth.uid() = blocker_id);

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete using (auth.uid() = blocker_id);

/** Er det en blokkering i noen retning mellom to brukere? */
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;

grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- Blokkering fjerner eksisterende følging begge veier, ellers blir man
-- stående i hverandres lister uten å kunne se det.
create or replace function public.drop_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists user_blocks_drop_follows on public.user_blocks;
create trigger user_blocks_drop_follows
  after insert on public.user_blocks
  for each row execute function public.drop_follows_on_block();

-- ---------------------------------------------------------------------------
-- 51. follows – å følge andre spillere.
--
--     Dette er ryggraden i både vennerangeringen («hvordan ligger jeg an mot
--     dem jeg faktisk kjenner?») og aktivitetsfeeden. Følging er ensidig som
--     på TikTok/Instagram – ingen godkjenning, men man kan blokkere (se 51).
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);

alter table public.follows enable row level security;

-- Hvem som følger hvem er offentlig (som på de fleste sosiale sider), men
-- man kan bare opprette og slette sine EGNE følginger.
drop policy if exists "follows_select_all" on public.follows;
create policy "follows_select_all" on public.follows for select using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and not exists (
      select 1 from public.user_blocks b
       where b.blocker_id = follows.following_id and b.blocked_id = auth.uid()
    )
  );

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows
  for delete using (auth.uid() = follower_id or auth.uid() = following_id);

/**
 * Antall følgere / følger for en spiller, og om DU følger hen. Ett kall i
 * stedet for tre, siden dette vises på hver eneste spillerprofil.
 */
create or replace function public.follow_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'followers', (select count(*) from public.follows where following_id = p_user_id),
    'following', (select count(*) from public.follows where follower_id = p_user_id),
    'is_following', (select exists (
       select 1 from public.follows
        where follower_id = auth.uid() and following_id = p_user_id)),
    'follows_you', (select exists (
       select 1 from public.follows
        where follower_id = p_user_id and following_id = auth.uid()))
  );
$$;

revoke all on function public.follow_stats(uuid) from public;
grant execute on function public.follow_stats(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 52. direct_messages – meldinger mellom to spillere.
--
--     Bevisst enkelt: én tabell, to parter, ingen gruppechat. thread_key er
--     de to bruker-idene sortert og limt sammen, slik at begge retninger
--     havner i samme samtale uten en egen conversations-tabell.
-- ---------------------------------------------------------------------------
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  thread_key text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_body_length check (char_length(body) between 1 and 1000),
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);

create index if not exists direct_messages_thread_idx
  on public.direct_messages (thread_key, created_at desc);
create index if not exists direct_messages_recipient_unread_idx
  on public.direct_messages (recipient_id) where read_at is null;

alter table public.direct_messages enable row level security;

/** Samtalenøkkel for to brukere – uavhengig av rekkefølge. */
create or replace function public.dm_thread_key(a uuid, b uuid)
returns text
language sql
immutable
as $$
  select case when a < b then a::text || ':' || b::text else b::text || ':' || a::text end;
$$;

grant execute on function public.dm_thread_key(uuid, uuid) to authenticated;

-- Kun de to partene i samtalen kan lese meldingene. Ingen policy for insert:
-- all sending går gjennom send_direct_message() under, som håndhever
-- blokkering og fartsgrense.
drop policy if exists "direct_messages_select_own" on public.direct_messages;
create policy "direct_messages_select_own" on public.direct_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Mottakeren kan markere som lest (og kun det – body/sender er beskyttet av
-- triggeren under). Avsenderen kan slette sin egen melding.
drop policy if exists "direct_messages_update_recipient" on public.direct_messages;
create policy "direct_messages_update_recipient" on public.direct_messages
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

drop policy if exists "direct_messages_delete_sender" on public.direct_messages;
create policy "direct_messages_delete_sender" on public.direct_messages
  for delete using (auth.uid() = sender_id);

/**
 * Mottakerens update-policy over ville ellers latt hen skrive om selve
 * meldingsteksten hen har fått. Denne triggeren låser alt annet enn read_at.
 */
create or replace function public.guard_direct_message_update()
returns trigger
language plpgsql
as $$
begin
  if new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.body is distinct from old.body
     or new.thread_key is distinct from old.thread_key
     or new.created_at is distinct from old.created_at then
    raise exception 'Kun lesetidspunktet kan endres på en melding';
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_guard_update on public.direct_messages;
create trigger direct_messages_guard_update
  before update on public.direct_messages
  for each row execute function public.guard_direct_message_update();

alter table public.app_settings add column if not exists dm_max_per_hour int not null default 60;
alter table public.app_settings add column if not exists dm_enabled boolean not null default true;

/**
 * Sender en melding. Håndhever blokkering, fartsgrense og at meldinger i det
 * hele tatt er skrudd på (admin kan slå av hele DM-funksjonen fra
 * adminpanelet hvis den blir misbrukt).
 */
create or replace function public.send_direct_message(p_recipient uuid, p_body text)
returns public.direct_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  msg public.direct_messages;
  per_hour int;
  enabled boolean;
  used int;
  clean text;
begin
  if uid is null then
    raise exception 'Du må være logget inn for å sende meldinger';
  end if;
  if p_recipient is null or p_recipient = uid then
    raise exception 'Ugyldig mottaker';
  end if;
  if not exists (select 1 from public.profiles where id = p_recipient) then
    raise exception 'Fant ikke mottakeren';
  end if;

  select coalesce(dm_enabled, true), coalesce(dm_max_per_hour, 60)
    into enabled, per_hour from public.app_settings where id = 1;
  if enabled is false then
    raise exception 'Meldinger er midlertidig slått av.';
  end if;
  per_hour := coalesce(per_hour, 60);

  if public.is_blocked_between(uid, p_recipient) then
    raise exception 'Du kan ikke sende melding til denne spilleren.';
  end if;

  clean := btrim(p_body);
  if clean = '' then
    raise exception 'Meldingen er tom';
  end if;

  if per_hour > 0 then
    select count(*) into used from public.direct_messages
     where sender_id = uid and created_at > now() - interval '1 hour';
    if used >= per_hour then
      raise exception 'Du har sendt mange meldinger på kort tid. Prøv igjen om litt.';
    end if;
  end if;

  insert into public.direct_messages (sender_id, recipient_id, thread_key, body)
  values (uid, p_recipient, public.dm_thread_key(uid, p_recipient), left(clean, 1000))
  returning * into msg;

  return msg;
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

/**
 * Innboksen: én rad per samtale med siste melding, motpartens profil og
 * antall uleste. Gjøres i databasen fordi klienten ellers måtte hente ALLE
 * meldinger og gruppere dem selv.
 */
create or replace function public.dm_threads()
returns table (
  thread_key text,
  other_id uuid,
  other_username text,
  other_avatar_color text,
  other_avatar_icon text,
  last_body text,
  last_at timestamptz,
  last_from_me boolean,
  unread int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select * from public.direct_messages
     where sender_id = auth.uid() or recipient_id = auth.uid()
  ),
  latest as (
    select distinct on (thread_key) *
      from mine
     order by thread_key, created_at desc
  )
  select l.thread_key,
         case when l.sender_id = auth.uid() then l.recipient_id else l.sender_id end as other_id,
         p.username, p.avatar_color, p.avatar_icon,
         l.body, l.created_at,
         l.sender_id = auth.uid() as last_from_me,
         (select count(*)::int from mine m
           where m.thread_key = l.thread_key
             and m.recipient_id = auth.uid()
             and m.read_at is null) as unread
    from latest l
    join public.profiles p
      on p.id = case when l.sender_id = auth.uid() then l.recipient_id else l.sender_id end
   order by l.created_at desc;
$$;

revoke all on function public.dm_threads() from public;
grant execute on function public.dm_threads() to authenticated;

/** Antall uleste meldinger totalt – til prikken i toppmenyen. */
create or replace function public.dm_unread_count()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.direct_messages
   where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.dm_unread_count() from public;
grant execute on function public.dm_unread_count() to authenticated;

/** Marker alle meldinger fra én motpart som lest. */
create or replace function public.dm_mark_read(p_other uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  update public.direct_messages
     set read_at = now()
   where recipient_id = auth.uid() and sender_id = p_other and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.dm_mark_read(uuid) from public;
grant execute on function public.dm_mark_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 53. Ukentlig rangering.
--
--     Den globale totallista er demotiverende for nye spillere: den som har
--     spilt siden mars ligger uoppnåelig langt foran, uansett hvor bra du
--     gjør det i dag. Ukeslista nullstilles hver mandag, så alle starter likt
--     og en fersk spiller kan faktisk vinne noe.
-- ---------------------------------------------------------------------------
create index if not exists game_records_created_idx on public.game_records (created_at);

/**
 * Ukens poeng per spiller: summen av BESTE runde per triks denne uka, ikke
 * summen av alle runder. Ellers vinner den som spiller flest korte runder,
 * ikke den som spiller best.
 *
 * p_week_offset: 0 = denne uka, -1 = forrige uke.
 */
create or replace function public.weekly_leaderboard(p_week_offset int default 0)
returns table (user_id uuid, score numeric, matches int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select date_trunc('week', (now() at time zone 'Europe/Oslo'))
             + make_interval(weeks => coalesce(p_week_offset, 0)) as start_at
  ),
  window_records as (
    select r.user_id, r.game_id, r.score
      from public.game_records r, bounds b
     where r.created_at >= b.start_at at time zone 'Europe/Oslo'
       and r.created_at <  (b.start_at + interval '7 days') at time zone 'Europe/Oslo'
  ),
  best_per_game as (
    select user_id, game_id, max(score) as best, count(*)::int as plays
      from window_records group by user_id, game_id
  )
  select user_id, sum(best) as score, sum(plays)::int as matches
    from best_per_game
   group by user_id;
$$;

revoke all on function public.weekly_leaderboard(int) from public;
grant execute on function public.weekly_leaderboard(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 54. Aktivitetsfeed – hva de du følger har gjort.
--
--     Gir følgingen en grunn til å eksistere utover et tall på profilen: du
--     ser at kompisen slo rekorden sin i går, og vil slå den tilbake.
-- ---------------------------------------------------------------------------
create or replace function public.following_feed(p_limit int default 30)
returns table (
  user_id uuid,
  username text,
  avatar_color text,
  avatar_icon text,
  game_id text,
  score numeric,
  created_at timestamptz,
  is_personal_best boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with followed as (
    select following_id as id from public.follows where follower_id = auth.uid()
  ),
  recent as (
    select r.*, row_number() over (partition by r.user_id, r.game_id order by r.created_at desc) as rn
      from public.game_records r
     where r.user_id in (select id from followed)
       and r.created_at > now() - interval '30 days'
  )
  select r.user_id, p.username, p.avatar_color, p.avatar_icon,
         r.game_id, r.score, r.created_at,
         r.score >= coalesce((select max(x.score) from public.game_records x
                               where x.user_id = r.user_id and x.game_id = r.game_id), 0) as is_personal_best
    from recent r
    join public.profiles p on p.id = r.user_id
   where r.rn <= 3
     and not p.is_hidden
   order by r.created_at desc
   limit least(coalesce(p_limit, 30), 100);
$$;

revoke all on function public.following_feed(int) from public;
grant execute on function public.following_feed(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 55. Rangeringen hentet tidligere ALLE rader i game_records med ett
--     select – som stopper på Supabase sin grense på 1000 rader og gjør at
--     topplista stille begynner å vise feil tall så snart siden har litt
--     trafikk. Aggregeringen flyttes derfor inn i databasen.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard_totals()
returns table (user_id uuid, game_id text, best numeric, matches int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select user_id, game_id, max(score) as best, count(*)::int as matches
    from public.game_records
   group by user_id, game_id;
$$;

revoke all on function public.leaderboard_totals() from public;
grant execute on function public.leaderboard_totals() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 56. Innstillinger for det sosiale laget, på brukernivå.
--     Den som ikke vil ha meldinger fra fremmede skal slippe.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists dm_from_followers_only boolean not null default false;

-- Håndheves i send_direct_message: bygges inn her i stedet for i en egen
-- versjon av funksjonen, slik at det bare finnes ett sted å lese reglene.
create or replace function public.send_direct_message(p_recipient uuid, p_body text)
returns public.direct_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  msg public.direct_messages;
  per_hour int;
  enabled boolean;
  used int;
  clean text;
  followers_only boolean;
begin
  if uid is null then
    raise exception 'Du må være logget inn for å sende meldinger';
  end if;
  if p_recipient is null or p_recipient = uid then
    raise exception 'Ugyldig mottaker';
  end if;

  select dm_from_followers_only into followers_only
    from public.profiles where id = p_recipient;
  if followers_only is null then
    raise exception 'Fant ikke mottakeren';
  end if;

  select coalesce(dm_enabled, true), coalesce(dm_max_per_hour, 60)
    into enabled, per_hour from public.app_settings where id = 1;
  if enabled is false then
    raise exception 'Meldinger er midlertidig slått av.';
  end if;
  per_hour := coalesce(per_hour, 60);

  if public.is_blocked_between(uid, p_recipient) then
    raise exception 'Du kan ikke sende melding til denne spilleren.';
  end if;

  -- «Kun fra dem jeg følger»: mottakeren må følge avsenderen. Har de allerede
  -- en samtale gående, slipper man gjennom – ellers ville innstillingen
  -- kuttet en pågående samtale midt i.
  if followers_only
     and not exists (select 1 from public.follows
                      where follower_id = p_recipient and following_id = uid)
     and not exists (select 1 from public.direct_messages
                      where thread_key = public.dm_thread_key(uid, p_recipient)
                        and sender_id = p_recipient) then
    raise exception 'Denne spilleren tar kun imot meldinger fra dem hen følger.';
  end if;

  clean := btrim(p_body);
  if clean = '' then
    raise exception 'Meldingen er tom';
  end if;

  if per_hour > 0 then
    select count(*) into used from public.direct_messages
     where sender_id = uid and created_at > now() - interval '1 hour';
    if used >= per_hour then
      raise exception 'Du har sendt mange meldinger på kort tid. Prøv igjen om litt.';
    end if;
  end if;

  insert into public.direct_messages (sender_id, recipient_id, thread_key, body)
  values (uid, p_recipient, public.dm_thread_key(uid, p_recipient), left(clean, 1000))
  returning * into msg;

  return msg;
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

/**
 * Slår opp en spiller på brukernavn – trengs for «send melding»-lenker og
 * for å finne noen å følge uten å laste hele brukerlisten.
 */
create or replace function public.find_players(p_query text, p_limit int default 10)
returns table (
  id uuid, username text, avatar_color text, avatar_icon text,
  level int, xp int, streak_current int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, username, avatar_color, avatar_icon, level, xp, streak_current
    from public.profiles
   where is_hidden = false
     and username ilike '%' || coalesce(p_query, '') || '%'
     and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
   order by xp desc
   limit least(coalesce(p_limit, 10), 25);
$$;

revoke all on function public.find_players(text, int) from public;
grant execute on function public.find_players(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 57. Rangering per periode og triks.
--
--     weekly_leaderboard (seksjon 53) dekket bare «denne uka», og bare for
--     alle triks samlet. Rangeringssiden lar deg nå kombinere periode
--     (i dag / denne uka / denne måneden / alle tider) med ett enkelt triks,
--     og da må databasen regne ut summen – henter nettleseren rådataene
--     selv, kutter Supabase svaret på 1 000 rader uten å si fra, og lista
--     begynner å vise feil tall.
--
--     Poengsummen er den samme som ellers på siden: beste runde per triks,
--     summert. p_game_id = null gir alle triks samlet.
-- ---------------------------------------------------------------------------
create or replace function public.period_leaderboard(
  p_period text default 'all',
  p_game_id text default null
)
returns table (user_id uuid, score numeric, matches int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select case lower(coalesce(p_period, 'all'))
             when 'today' then date_trunc('day',   (now() at time zone 'Europe/Oslo'))
             when 'week'  then date_trunc('week',  (now() at time zone 'Europe/Oslo'))
             when 'month' then date_trunc('month', (now() at time zone 'Europe/Oslo'))
             else null
           end as start_at
  ),
  window_records as (
    select r.user_id, r.game_id, r.score
      from public.game_records r, bounds b
     where (b.start_at is null or r.created_at >= b.start_at at time zone 'Europe/Oslo')
       and (p_game_id is null or r.game_id = p_game_id)
  ),
  best_per_game as (
    select user_id, game_id, max(score) as best, count(*)::int as plays
      from window_records group by user_id, game_id
  )
  select user_id, sum(best) as score, sum(plays)::int as matches
    from best_per_game
   group by user_id;
$$;

revoke all on function public.period_leaderboard(text, text) from public;
grant execute on function public.period_leaderboard(text, text) to anon, authenticated;

-- Indeksen gjør periodefiltreringen billig når det begynner å bli mange
-- runder i game_records.
create index if not exists game_records_created_idx on public.game_records (created_at);

-- =============================================================================
-- Bootstrap av første admin (kjør manuelt ETTER at du har registrert din
-- egen bruker via login.html):
--
--   update public.profiles set is_admin = true where lower(username) = lower('dittbrukernavn');
--
-- Etter det kan du gjøre flere til admin direkte fra adminpanelet.
-- =============================================================================
