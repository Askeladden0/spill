# Supabase-oppsett for PixelPlay

Denne siden bruker [Supabase](https://supabase.com) for innlogging (e-post +
Google), brukerprofiler, adminpanel og fremtidige spillrekorder. Følg disse
stegene for å koble et Supabase-prosjekt til nettsiden.

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
   - `add_points`-funksjonen som lykkehjulet på premier.html bruker til å legge
     poeng til innlogget bruker og oppdatere nivået automatisk
   - Triggere som auto-oppretter en profil med tilfeldig avatar når noen registrerer seg
   - Row Level Security-regler som sikrer at brukere kun kan endre sin egen data,
     og at kun admins kan endre `avatar_options`, `levels`, eller andres `level`/`xp`/`is_admin`

   Filen er skrevet slik at den er trygg å kjøre på nytt (bruker `if not exists`,
   `on conflict do nothing` osv.) – kjør den gjerne igjen etter at nye tabeller
   som `levels`/`user_codes` er lagt til, selv om prosjektet allerede er satt opp.

## 3. Skru på Google-innlogging

1. I Supabase-dashbordet: **Authentication → Providers → Google**, skru den på.
2. I [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   opprett en OAuth Client ID (type "Web application").
   - **Authorized redirect URI**: bruk URL-en Supabase viser deg på Google-siden
     (ser ut som `https://<ditt-prosjekt>.supabase.co/auth/v1/callback`).
3. Lim inn Client ID og Client Secret fra Google inn i Supabase sitt Google-provider-skjema, lagre.
4. Under **Authentication → URL Configuration**, legg til nettsidens URL(er)
   (f.eks. `http://localhost:8080` under utvikling, og produksjons-URL-en senere)
   i **Redirect URLs**, siden `login.html` ber Supabase sende brukeren til
   `index.html` etter Google-innlogging.

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

1. Åpne `login.html` på nettsiden og registrer en konto med e-post/passord (eller Google).
2. Hvis "Confirm email" er skrudd på i Supabase (standard), bekreft e-posten via lenken du får tilsendt.
3. I Supabase **SQL Editor**, kjør (bytt ut med ditt eget brukernavn):

   ```sql
   update public.profiles set is_admin = true where lower(username) = lower('dittbrukernavn');
   ```

4. Logg inn på nytt (eller last siden på nytt) – nå vises "Admin"-lenken nederst
   på siden, og du får tilgang til `admin.html`.

Etter dette kan du gjøre flere brukere til admin direkte fra adminpanelet –
SQL-kommandoen trengs kun for den aller første.

## 6. Valgfritt: skru av e-postbekreftelse for testing

Under **Authentication → Providers → Email**, kan du skru av "Confirm email"
mens du utvikler lokalt, slik at nye kontoer logges rett inn uten å måtte
bekrefte e-post først. Anbefales skrudd på igjen i produksjon.

## Hvordan innloggingen henger sammen med resten av siden

- `js/auth.js` er lastet på alle sider og fyller `[data-auth-slot]` i headeren
  med enten en "Logg inn"-knapp eller avatar + nivå, avhengig av om noen er
  innlogget.
- `[data-admin-only]`-lenken i bunnmenyen vises kun for administratorer.
- `profil.html` krever innlogging (redirigerer til `login.html` ellers).
- `admin.html` krever admin-status (redirigerer til `index.html` ellers).
- Passordregler: minst 8 tegn, med minst én bokstav og ett tall.
- Brukernavnregler: 5–20 tegn, kun bokstaver/tall/understrek, unikt.
- Google-innlogging kan ikke spørre om brukernavn før kontoen opprettes, så
  disse brukerne får et automatisk generert brukernavn
  (`username_is_default = true`) og blir oppfordret til å velge sitt eget på
  profilsiden.
