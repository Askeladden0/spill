# Studilla – spillnettside

Statisk frontend + Supabase-backend for spillnettsiden, basert på designfilen
`Spillnettside.dc.html`. Mørkt tema, grønn aksentfarge (`#2ee87f`), Poppins-font.

## Filstruktur

```
spill/
├── index.html            Forsiden – "Dagens spill" + rutenett med alle spill (ferdig demo)
├── premier.html           Premier-siden – delt layout, plassholderinnhold
├── rangering.html          Rangering-siden – delt layout, plassholderinnhold
├── player.html            Delt spillmal – viser ETT spill basert på ?id=<slug> i URL-en.
│                          Det lages IKKE én fil per spill; alle spill går gjennom denne malen.
├── login.html             Logg inn / registrer deg (brukernavn + passord)
├── profil.html            Profilside – avatar, brukernavn, nivå, rekorder, slett konto
├── admin.html             Adminpanel – eget sidemeny-dashbord (se under), krever admin-status
├── assets/img/favicon.svg  Faviconet (Studilla-logoen), lenket inn fra alle sidene
├── css/
│   └── style.css          Alt av delt CSS (farger, header, footer, kort, skjemaer, adminpanel osv.)
│                          Brukes av alle sider – endringer her slår ut overalt.
├── js/
│   ├── games-data.js      Midlertidig "database" med spillobjekter (se under)
│   ├── layout.js          Delt topp-nav/bunnmeny + markering av aktivt menypunkt
│   ├── main.js            Rendrer heltefelt, spillrutenett og spillside
│   ├── admin.js           All logikk for adminpanelet (admin.html)
│   ├── supabase-config.js Supabase-nøkler (må fylles inn, se SUPABASE_SETUP.md)
│   └── auth.js            Delt innloggingslogikk: header-avatar, admin-lenke, tilgangssjekk
├── supabase/
│   └── schema.sql          Databaseskjema: profiler, avatar-innstillinger, spillrekorder, nivåer,
│                          rabattkoder, RLS
├── SUPABASE_SETUP.md       Steg-for-steg-guide for å koble opp Supabase-prosjektet
└── assets/
    └── img/
        ├── games/          Miniatyrbilder for spill legges her, f.eks. skyfall-tactics.jpg
        └── icons/           Ev. egne ikoner/logoer
```

## Innlogging og profiler

Innlogging kjøres via [Supabase](https://supabase.com) – se
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) for full oppsettsguide (opprette
prosjekt, kjøre `supabase/schema.sql`, skru av e-postbekreftelse, koble
`js/supabase-config.js` til prosjektet, og gjøre deg selv til admin).

Kort oppsummert:
- **Registrering**: brukernavn + passord (brukernavn 5–20 tegn, passord min. 8
  tegn med bokstav+tall). Verken e-post eller Google-innlogging er i bruk, og
  2FA er ikke satt opp. Supabase krever en e-postadresse per konto, så
  `js/auth.js` lager en intern adresse ut fra brukernavnet
  (`brukernavn@brukere.studilla.no`) – den brukes aldri til å sende noe.
- **Glemt passord**: siden vi ikke har e-postadresser, må en admin sette nytt
  passord på brukeren fra Supabase-dashbordet (**Authentication → Users**).
- **Gjestepoeng overføres ved innlogging**: poeng og rekorder samlet uinnlogget
  (lagret i `localStorage`) flyttes automatisk inn på kontoen første gang
  brukeren logger inn/registrerer seg (se `Auth.migrateGuestDataToProfile` i
  `js/auth.js`), i stedet for å bli liggende igjen i nettleseren.
- **Automatisk avatar**: ny bruker får tilfeldig farge + ikon fra listen i
  `avatar_options`-tabellen (redigeres fra `admin.html`). Kan endres når som
  helst fra `profil.html`.
- **Profilsiden** (`profil.html`) viser nivå/XP, lar deg redigere avatar og
  brukernavn, viser dine beste rekorder per spill (tom liste inntil spillene
  faktisk rapporterer poeng), og har en "Slett konto"-knapp som sletter
  brukeren permanent.
- **Adminpanelet** (`admin.html`, lenket i toppmenyen og bunnmenyen kun for admins) er et
  eget sidemeny-dashbord med seksjonene Oversikt, Statistikk, Spill, Nivåer og
  premier, Brukere og Profilbilder (samt "Rabattkoder"/"Drift" som tomme
  plassholdere for fremtidige seksjoner). Alt leser/skriver direkte mot de
  samme Supabase-tabellene som resten av siden bruker, så en endring i
  adminpanelet (nytt dagens spill, nytt nivå, ny farge, admin-tilgang osv.)
  slår ut på forsiden/premier/rangering/profiler med én gang, og omvendt.
  Har en kommandopalett (Ctrl/⌘+K) for å hoppe rett til en seksjon, et spill,
  et nivå eller en bruker.
- **Rabatter** i adminpanelet: hver rabatt kan få bilde (dra bildet rett inn i
  slippsonen, eller klikk for å velge fil), en lenke til tilbudet, en
  utløpsdato (etter den datoen deles rabatten ikke ut lenger og merkes
  «Utgått»), og skrus av/på med en egen «Deaktiver rabatten»-knapp. For
  kodelister kan hver enkelt kode deaktiveres for seg uten å slette den.
- **Nivåer** settes med ett tall: «poeng per nivå». Nivåstigen er lineær –
  nivå N krever `(N - 1) × poeng per nivå` – og regnes om server-side av
  `admin_set_level_config` når du endrer tallet eller antall nivåer.
- **Triks** har en «poeng per skår»-faktor (`games.point_rate`): 1 gir skåren
  1:1, 2 gir dobbelt opp. Rekordene i `game_records` lagres alltid som den rå
  skåren, så bare xp/nivå skaleres.
- **Statistikk** viser retention per triks: hvor stor andel av spillerne som
  kom tilbake til triksen en annen dag, med valgbar periode.
- **Dagens triks roterer automatisk**: hvilket triks som er dagens regnes ut
  fra datoen (døgnnummer i UTC modulo antall synlige triks, i rekkefølgen på
  forsiden), så det bytter seg selv ved midnatt. Rotasjonen kan skrus av under
  «Triks» i adminpanelet (`app_settings.daily_game_rotation`); da blir triksen
  du merker manuelt stående.
- **Lykkehjulet** har en egen seksjon i adminpanelet der du setter hvor mange
  spinn hver spiller får per døgn (`app_settings.wheel_spins_per_day`,
  0 = ingen grense). Grensen håndheves server-side av RPC-en `spin_wheel`, som
  logger hvert spinn i `wheel_spins` – den kan altså ikke omgås fra
  nettleseren. Utloggede gjester telles lokalt i `localStorage`.
- **Kasser åpnes i en pop-up**: «Åpne kassen» på premier-siden åpner en modal
  med kassebåndet og rabatten, i stedet for å skje inne i selve siden.
- **Informasjonskapsler**: samtykkevarselet dukker først opp når en besøkende
  går inn på et triks (`player.html`), og det ligger ingen flytende knapp igjen
  i hjørnet etterpå – valget endres fra `innstillinger.html`.

## Hvordan legge til et nytt spill

Åpne `js/games-data.js` og legg til et nytt objekt i `STUDILLA_GAMES`-listen:

```js
{
  id: "mitt-nye-spill",       // unik slug, brukes i URL-en player.html?id=mitt-nye-spill
  name: "Mitt Nye Spill",
  time: "~15 min",
  thumbnail: null,             // sett til "assets/img/games/mitt-nye-spill.jpg" når bilde finnes
  description: "Kort beskrivelse av spillet.",
  isDailyGame: false,          // styres normalt av den automatiske dagsrotasjonen
  pointsMultiplier: null,
  pointRate: 1                 // poeng per poeng skår (settes i adminpanelet)
}
```

Spillet dukker automatisk opp i rutenettet på forsiden og får en egen side på
`player.html?id=mitt-nye-spill` – uten at noen nye filer trenger å lages.

Når spillene etter hvert kan rapportere poeng, skriv til `game_records`-tabellen
i Supabase (`user_id`, `game_id`, `score`) – de dukker automatisk opp under
"Mine rekorder" på profilsiden.

## Premier-siden (`premier.html`)

Poeng lagres i `profiles.xp` og nivået i `profiles.level`. Nivåstigen (poengkrav
og premier per nivå) ligger i `levels`-tabellen og redigeres fra `admin.html`
(legg til/slett nivå, endre poengkrav, legg til/fjern premier). Admin kan også
sette en brukers poeng og nivå manuelt direkte i brukerlisten.

- **Lykkehjulet**: å trykke "Spinn hjulet" åpner et modalvindu med et stort
  hjul (konkrete verdier 10–1000) og en nedtonet bakgrunn. Et nytt trykk
  spinner hjulet, og resultatet legges til poengsummen via RPC-funksjonen
  `add_points` (som også oppdaterer nivået automatisk). Ikke innloggede
  besøkende samler i stedet poeng lokalt i nettleseren
  (`localStorage`), og ser dette igjen som "poeng du hadde hatt" i headeren
  sammen med en logg inn-knapp. Det er ingen grense på antall spinn ennå.
- **Hent rabattkode**: åpner et modalvindu med nedtonet bakgrunn og en
  tilfeldig generert placeholder-kode, som lagres i `user_codes` og dukker
  opp under "Mine koder".
- Hold musepekeren over nivåhjulet i heltefeltet for å se totalt antall poeng.
- **Kassebåndet** over "Åpne kasse" ruller kontinuerlig med én uendelig
  CSS-animasjon (`.case-reel` i `css/style.css`). Kortene bygges i tilfeldig
  rekkefølge og dupliseres, slik at løkken er sømløs; farten settes i js ut
  fra bredden, så den er lik uansett hvor mange rabatter som finnes.
- Nederst på siden ligger en FAQ med de vanligste spørsmålene om poeng,
  kasser, sjeldenhet og hvordan kodene brukes.

## Lagret spillstilling ("husk spillet man er i")

`js/game-runtime.js` gir hver spillmodul `session.saveState(...)`,
`session.savedState()` og `session.clearState()`. Spillene lagrer stillingen
sin lokalt (`localStorage`, én nøkkel per spill) etter hvert trekk, og
gjenopptar den samme runden neste gang siden åpnes – også etter en refresh.
Stillingen nullstilles når runden er over eller spilleren starter et nytt
spill, og kastes automatisk hvis den er eldre enn en uke.

Alle seks spillene støtter dette. I sanntidsspillene (Snake og Tetris) står
brettet stille til spilleren gjør sitt første trekk, slik at man ikke taper
med en gang siden lastes.

## Cookies og samtykke (statistikk/markedsføring)

Alle sider laster `js/consent.js` og `js/cookie-banner.js` (i den
rekkefølgen) rett før `js/layout.js`/`js/vendor/supabase.js`:

- **`js/consent.js`** setter opp Googles «Consent Mode v2»
  (`gtag('consent', 'default', …)` med alt satt til `denied` inntil
  brukeren har valgt) og eksponerer `window.StudillaConsent` med
  `get()`, `hasChoice()` og `save({ stats, marketing })`. Når brukeren
  godtar statistikk og/eller markedsføring, oppdaterer den samtykket
  hos Google og laster `gtag.js` først da – ingenting lastes før
  brukeren har sagt ja. Måler-ID-ene for Google Analytics
  (`STUDILLA_GA_MEASUREMENT_ID`) og Google Ads
  (`STUDILLA_GOOGLE_ADS_ID`) fylles inn øverst i filen når kontoene er
  klare; til da lastes ingen Google-tagger, selv om brukeren godtar.
  Valget lagres i `localStorage` under nøkkelen `studilla_cookie_consent`.
- **`js/cookie-banner.js`** viser selve banneret (design fra
  `Cookie-banner.dc.html`) første gang en besøkende kommer til siden:
  «Godta alle» / «Tilpass» → egne brytere for Statistikk og
  Markedsføring («Nødvendige» kan ikke skrus av. Etter et valg legges
  det igjen en liten «Informasjonskapsler ↻»-knapp nederst til venstre
  som når som helst åpner innstillingene på nytt.

Egen statistikkinnsamling (f.eks. sidevisninger/bruk i Supabase, hvis
det legges til senere) bør sjekke `StudillaConsent.get()?.stats` – eller
lytte på `window.addEventListener('studilla:consent-changed', …)` – før
noe sendes, av samme grunn som Google-taggene venter på samtykke.

## Spilladministrasjon

Spillistene ligger i Supabase-tabellen `games` (se `supabase/schema.sql`) og
redigeres fra "Spill"-seksjonen i adminpanelet: bytt navn/beskrivelse/bilder,
sett hvilket spill som er "dagens spill", skjul et spill fra lister uten å
slette det (`hidden`-kolonnen – et skjult spill er fortsatt tilgjengelig
direkte via `player.html?id=...`), dra for å endre rekkefølgen, eller slett
det helt. `js/games-data.js` henter denne tabellen ved sidelasting og fyller
`window.STUDILLA_GAMES` i place; den statiske listen øverst i filen er kun en
fallback hvis Supabase er utilgjengelig.
