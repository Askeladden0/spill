# Supabase-oppsett for Studilla

Denne siden bruker [Supabase](https://supabase.com) for innlogging (brukernavn
+ passord), brukerprofiler, adminpanel og spillrekorder. Følg disse stegene for
å koble et Supabase-prosjekt til nettsiden.

## 1. Opprett prosjekt

1. Gå til [supabase.com](https://supabase.com) og opprett et nytt prosjekt.
2. Vent til prosjektet er ferdig provisjonert.

## 2. Kjør databaseskjemaet

1. Åpne **SQL Editor** i Supabase-dashbordet.
2. Lim inn hele innholdet i [`supabase/schema.sql`](supabase/schema.sql) og kjør det.
   Dette oppretter:
   - `profiles` – brukernavn, avatar, nivå/xp, admin-flagg
   - `avatar_options` – fargene/ikonene som tildeles tilfeldig ved registrering
   - `game_records` – tabell klar for fremtidige spillpoeng
   - `levels` – nivåstigen på premier.html (poengkrav + premier/rabattkoder per nivå)
   - `user_codes` – rabattkodene en bruker har hentet ut ("Mine koder")
   - `add_points`-funksjonen som spillene bruker til å legge poeng til innlogget
     bruker og oppdatere nivået automatisk
   - `wheel_spins` + `spin_wheel`/`wheel_spins_left` – lykkehjulet på
     premier.html, med dagsgrensen admin setter i adminpanelet
   - `app_settings.wheel_spins_per_day` (spinn per døgn) og
     `app_settings.daily_game_rotation` (automatisk rotasjon av dagens triks)
   - Triggere som auto-oppretter en profil med tilfeldig avatar når noen registrerer seg
   - Row Level Security-regler som sikrer at brukere kun kan endre sin egen data,
     og at kun admins kan endre `avatar_options`, `levels`, eller andres `level`/`xp`/`is_admin`

   Filen er skrevet slik at den er trygg å kjøre på nytt (bruker `if not exists`,
   `on conflict do nothing` osv.) – kjør den gjerne igjen etter at nye tabeller
   som `levels`/`user_codes` er lagt til, selv om prosjektet allerede er satt opp.

## 3. Skru på innlogging med brukernavn

Studilla logger inn med **brukernavn og passord** – ingen e-post og ingen
Google-innlogging. Supabase Auth krever teknisk sett en e-postadresse per
konto, så `js/auth.js` lager en intern adresse ut fra brukernavnet
(`brukernavn@brukere.studilla.no`). Adressen brukes aldri til å sende noe, og
den vises ikke for brukeren.

Derfor **må e-postbekreftelse være av**, ellers vil Supabase forsøke å sende en
bekreftelse til en adresse som ikke finnes, og kontoen blir aldri aktiv:

1. Supabase-dashbordet → **Authentication → Providers → Email**: la
   «Email» stå på, men skru **av** «Confirm email».
2. Samme sted: skru **av** eventuelle andre providere (Google osv.) – de brukes
   ikke lenger av `login.html`.

En bruker kan likevel be om å tilbakestille passordet sitt selv, hvis de har
lagt inn en valgfri gjenopprettings-e-post ved registrering (se «Glemt
passord?» i punkt 7 under). Uten en slik e-post byttes passordet fortsatt
manuelt av en admin i Supabase-dashbordet (**Authentication → Users**).

## 4. Koble nettsiden til prosjektet

Åpne [`js/supabase-config.js`](js/supabase-config.js) og bytt ut:

```js
window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";
```

med verdiene fra **Project Settings → API** i Supabase-dashbordet
(`Project URL` og `anon public`-nøkkelen). Denne nøkkelen er trygg å ha i
klientkoden – tilgangskontroll håndteres av RLS-reglene i `schema.sql`, ikke
av å holde nøkkelen hemmelig.

## 5. Registrer din første bruker og gjør deg selv til admin

1. Åpne `login.html` på nettsiden og registrer en konto med brukernavn og passord.
2. I Supabase **SQL Editor**, kjør (bytt ut med ditt eget brukernavn):

   ```sql
   update public.profiles set is_admin = true where lower(username) = lower('dittbrukernavn');
   ```

3. Logg inn på nytt (eller last siden på nytt) – nå vises "Admin"-lenken både i
   toppmenyen og nederst på siden, og du får tilgang til `admin.html`.

Etter dette kan du gjøre flere brukere til admin direkte fra adminpanelet –
SQL-kommandoen trengs kun for den aller første.

`schema.sql` legger også til `games.hidden` (lar admin skjule et spill fra
lister uten å slette det) og RPC-funksjonen `admin_delete_user` (lar en admin
slette andre brukere fra "Brukere"-seksjonen i adminpanelet). Har du kjørt
filen tidligere, kjør den bare på nytt – den er skrevet slik at det er trygt
(se punktet under).

## 6b. «Glemt passord?» – gjenopprettingsmail (valgfritt, men anbefalt)

`login.html` har en «Glemt passord?»-lenke som lar en bruker be om en
tilbakestillingslenke, HVIS de har lagt inn en gjenopprettings-e-post ved
registrering (`profiles.recovery_email`). Selve utsendingen skjer i en
Supabase Edge Function (`supabase/functions/request-password-reset`), fordi
det å generere en gyldig tilbakestillingslenke krever service role-nøkkelen,
som aldri skal ligge i nettsidens JavaScript.

1. Installer [Supabase CLI](https://supabase.com/docs/guides/cli) hvis du
   ikke har den, og logg inn: `supabase login`.
2. Koble mappen til prosjektet ditt: `supabase link --project-ref DITT-PROSJEKT-REF`
   (project ref finner du i URL-en til dashbordet, eller under
   **Project Settings → General**).
3. Opprett en gratis konto på [resend.com](https://resend.com), verifiser et
   avsenderdomene der (kreves for å kunne sende til andre enn din egen
   konto-e-post), og hent en API-nøkkel.
4. Sett secrets for funksjonen:

   ```
   supabase secrets set RESEND_API_KEY=din_resend_nøkkel
   supabase secrets set SITE_URL=https://studilla.no
   ```

   (`SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` settes automatisk av
   Supabase og trenger ikke legges inn manuelt.)
5. Deploy funksjonen: `supabase functions deploy request-password-reset`

Uten dette oppsettet vil «Glemt passord?» fortsatt vise en pen feilmelding i
stedet for å krasje, men ingen e-post blir faktisk sendt – brukeren må da
kontakte admin som i dag.

Merk: gjenopprettings-e-posten er kun en leveringsadresse for
tilbakestillingslenken. Den er ALDRI innloggings-e-posten til kontoen (den er
og blir `brukernavn@brukere.studilla.no`, se punkt 3), så innlogging med
brukernavn fungerer helt uendret.

## 6. Valgfritt: skru av e-postbekreftelse for testing

Under **Authentication → Providers → Email**, kan du skru av "Confirm email"
mens du utvikler lokalt, slik at nye kontoer logges rett inn uten å måtte
bekrefte e-post først. Anbefales skrudd på igjen i produksjon.

## Hvordan innloggingen henger sammen med resten av siden

- `js/auth.js` er lastet på alle sider og fyller `[data-auth-slot]` i headeren
  med enten en "Registrer deg"-knapp (lenker til `login.html?mode=register`,
  som åpner registrerings-fanen direkte) eller avatar + nivå, avhengig av om
  noen er innlogget. Innloggingsfanen er fortsatt standard når man kommer til
  `login.html` uten `?mode=register` (f.eks. via `Auth.requireAuth()`-redirect).
- `[data-admin-only]`-lenkene (Admin i toppmenyen og i bunnmenyen) vises kun for
  administratorer.
- `profil.html` krever innlogging (redirigerer til `login.html` ellers).
- `admin.html` krever innlogging og admin-status (redirigerer til `login.html`
  hvis ingen er innlogget, ellers til `index.html` hvis brukeren ikke er
  admin) – håndhevet av `Auth.requireAdmin()` i `js/admin.js`.
- Passordregler: minst 8 tegn, med minst én bokstav og ett tall.
- Brukernavnregler: 5–20 tegn, kun bokstaver/tall/understrek, unikt.
- Brukere som (av en eller annen grunn) er opprettet uten brukernavn får et
  automatisk generert et (`username_is_default = true`) og blir oppfordret til å
  velge sitt eget på profilsiden.
