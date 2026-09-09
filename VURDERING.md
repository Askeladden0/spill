# Helhetlig vurdering av Studilla

**Dato:** 9. september 2026
**Metode:** Kodegjennomgang + faktisk gjennomspilling i Chromium (Playwright) på
desktop (1440×900) og mobil (390×844, touch). Alle seks triks er lastet og
spilt, 2048 til game over, og nybegynnerflyten er gått gjennom fra en helt
tom nettleserprofil. All ny SQL er kjørt og testet mot en ekte PostgreSQL 16
lokalt, med en liten etterligning av Supabase (`auth.users`, `auth.uid()`,
rollene `anon`/`authenticated`, `storage`-skjemaet).

**Kontekst for tallene:** testmiljøet har ikke nettverkstilgang til Supabase.
Det er ikke bare en begrensning – det er en nyttig test, for det viser
nøyaktig hva som skjer på en treig skolenettverk-forbindelse. Der det er
relevant er dette markert.

---

## Kort oppsummering

Studilla er lengre framme enn den framstår. Trikene er gode og går i 60 fps,
databasen er gjennomtenkt, og adminpanelet er reelt nyttig. Problemene lå
ikke i håndverket, men i tre ting:

1. **Rangeringen kunne forfalskes med én linje i konsollen.** Det er det
   alvorligste funnet, og det undergraver alt annet konkurransepreget.
2. **Ingenting ga en grunn til å komme tilbake i morgen.** Byggeklossene fantes,
   men var ikke koblet sammen til en løkke.
3. **Førstegangsbesøkende fikk et cookie-skjema på en mørklagt side, uten en
   eneste setning om hva Studilla er.**

Alle tre er utbedret i denne endringen. Under følger funn per punkt, med
skille mellom *hva som var galt*, *hva som er gjort*, og *hva som gjenstår*.

---

## 1. Førstegangsopplevelsen

### Hva en ny besøkende faktisk så

Dette er skjermbildet fra første sekund i en tom nettleser, før endringene:

- Hele siden mørklagt bak et modalt cookie-skjema med bakgrunnsuskarphet.
- Bak skjemaet: overskriften «Dagens triks», en nedtelling, og «Alle triks».
- **Ingen setning noe sted om hva Studilla er.**
- Cookie-skjemaets førstevisning hadde to knapper: «Tilpass» (nedtonet) og
  «Godta alle» (grønn). «Avvis alle» lå gjemt bak «Tilpass».

Det siste er verdt å merke seg utover UX: Datatilsynet krever at det er like
enkelt å avvise som å godta. Slik det var, var det ett klikk å godta og to å
avvise, med ulik visuell vekt. Det var en reell etterlevelsesrisiko, ikke bare
en designsmak.

### Time-to-first-interaction (målt)

| Steg | Før | Etter |
|---|---|---|
| Klikk for å komme forbi cookie-veggen | 1 (obligatorisk) | 0 (linja stenger ingenting) |
| Klikk til noe skjer på skjermen | 2 (kort → ny sidelasting) | 1 |
| Tid fra klikk til spillbart brett | full sidelasting + modullasting | **2,8 s, uten sidelasting** |

### Registreringsfriksjon

Brukernavn + passord uten e-post er riktig valg for målgruppen. Men
konsekvensen briefen peker på er reell og undervurdert: **det finnes ingen
gjenopprettingsvei.** `tilbakestill-passord.html` finnes, men uten e-post kan
den ikke sende noe. En elev som glemmer passordet mister kontoen, streaken og
rekordene sine, permanent, med mindre en admin griper inn manuelt i Supabase.

Dette er ikke fikset her, fordi det krever et produktvalg (se «Gjenstår»).

### Modal-stabling

Undersøkt: `new-site-welcome-modal.js` lastes kun på `player.html` og
`guide.html`, og vises kun med `?ny-side=` i URL-en. Cookie-varselet vises på
forsiden og triks-siden. `levelup-modal.js` er avhengig av nivåsystemet, som
er avslått (`js/feature-flags.js`).

**Konklusjon: stablingen er teoretisk mulig, men i praksis lite sannsynlig.**
Verste tilfelle er en besøkende som kommer fra skolesaus.no rett til et triks
og får velkomstpopup + cookie-skjema samtidig. Etter endringen er det ikke
lenger et problem, siden cookie-varselet er en linje nederst og ikke en
dialog. En generell modal-kø er derfor ikke bygget – den ville vært
infrastruktur for et problem som ikke lenger finnes.

### Gjort

- Verdiløfte som `<h1>`: «Nye triks hver dag» + en ledetekst som sier hva det
  er, hvem det er for og hvorfor man skal komme tilbake.
- Dagens triks starter **i heltefeltet**. Modulen lastes på klikk, brettet
  erstatter bildet, ingen sidelasting.
- Cookie-varselet er en linje nederst med tre likestilte valg: Tilpass,
  Avvis alle, Godta alle. Innholdet er lesbart og brukbart hele tiden.
- Konto-stripe for utloggede som sier hva de går glipp av, uten å stenge dem
  ute.

---

## 2. Retensjonsløkken

### Funn

Briefen har rett i at byggeklossene ikke hang sammen. Konkret:

- **Dagens triks** roterte på UTC-døgnnummer. For en norsk elev betyr det at
  trikset byttet klokka 02:00 om sommeren – midt på natta, men ikke ved
  «deres» midnatt. Ingen streak, ingen dagsbonus, ingen påminnelse.
- **Nivå/XP** var skrudd helt av på den live siden. Hele progresjonen –
  nivåstige, lykkehjul, kasser, `premier.html` (916 linjer), `levelup-modal.js`
  – lå der uten å vises for noen. Spørsmålet om lineær nivåstige er derfor
  hypotetisk i dag; det som betyr noe er at *ingen* progresjon var synlig.
- **Rangeringen** hadde kun én global totalliste over all tid. For en ny
  spiller er den demotiverende på nøyaktig den måten briefen beskriver: den
  som begynte i mars ligger uoppnåelig foran, og det finnes ingen liste du kan
  vinne. Ingen ukesnullstilling, ingen venneliste, ingen skoleliste.

### Gjort

- **Streak** (`schema.sql` seksjon 49): teller sammenhengende dager med minst
  én fullført runde, med dagsbonus som vokser med lengden. Døgnet følger
  `Europe/Oslo`, ikke UTC, slik at en runde 23:30 og en 00:30 teller som to
  dager slik spilleren selv opplever det. Vises som en flamme i toppmenyen
  (kun når man faktisk har en rekke – en «0 dager»-teller er bare et nederlag
  å se på) og på game over-kortet, med tekst når en rekke ryker.
- **Ukesrangering** (seksjon 53): mandag–søndag, norsk tid. Poengsummen er
  summen av *beste runde per triks* denne uka, ikke summen av alle runder –
  ellers vinner den som spiller flest korte runder, ikke den som spiller best.
- **Vennerangering**: rangering blant deg og de du følger, med plasseringer
  regnet på nytt innenfor gruppen. «#2 av 6» er en konkurranse du kan vinne;
  «#412 av 3 000» er det ikke.

### Vurdering av lykkehjul og kasser

Rabattkoder er tørt for målgruppen, ja – men det virkelige problemet er at
belønningen ikke eksisterer ennå: nivåsystemet er avslått, så ingen ser
premiene uansett. Anbefalingen min er derfor ikke «bytt ut rabattkodene», men
å avgjøre om premiesystemet skal leve i det hele tatt. Streak og
ukesrangering gir nå en retensjonsløkke som ikke er avhengig av at det finnes
partnere med rabattkoder.

---

## 3. Trikene

### Målt, ikke gjettet

Alle seks lastet og kjørte. Bildefrekvens målt over to sekunder:

| Triks | FPS | Teknikk | Berøring |
|---|---|---|---|
| Fruktfusjon | 60 | canvas + Matter.js | ja |
| 2048 | 61 | DOM | ja |
| Tetris | 59 | DOM | ja |
| Block Blast | 60 | DOM | ja |
| Snake | 60 | DOM | ja |
| Bubble Shooter | 60 | canvas | ja |

**Ytelsen er ikke et problem.** Brettene er stort sett rene DOM-elementer og
skalerer knivskarpt; de to canvas-baserte tegner om i faktisk oppløsning ved
skalaendring. `game-runtime.js` gjør dette riktig, og kommentarene i filen
viser at det er tenkt grundig gjennom. Bekymringen for frame drops på
Chromebook er ubegrunnet ut fra det jeg kan måle her.

Berøringshåndteringen er også på plass i alle seks, med `preventDefault` på
`touchmove` der det trengs, så det er ingen scroll-hopp under spilling.

### Game over-flyten – dette var den svake delen

Kortet inneholdt nøyaktig dette:

```
Spillet er over
Du fikk 8 460 poeng.
Rekord: 8 460 poeng.
[Spill igjen]
```

Ingen XP-gevinst (nivåer er av), ingen rekke, ingen plassering, ingen vei
videre annet enn tilbake, ingenting å dele. Briefen kaller det antiklimaks;
det er en presis beskrivelse.

I tillegg lå kortet som ren tekst på et uskarpt bakteppe, uten eget underlag,
så brettet leste gjennom teksten.

### Gjort

Nytt game over-kort med eget underlag og:

- Skåren stor og tydelig, med rekorden ved siden av
- Dagsrekke og bonuspoeng
- Konfetti ved ny rekord (hoppes helt over ved `prefers-reduced-motion`)
- **«Én runde til» er forhåndsvalgt** – Enter starter en ny runde uten å
  treffe knappen med musa
- Lenke til *neste* triks i lista, ikke tilbake til menyen: ett klikk videre
  i stedet for to
- «Utfordre en venn» som deler lenke + skår via nettleserens delefunksjon på
  mobil, eller kopierer lenken på desktop
- For utloggede: én linje om at rekorden bare ligger i denne nettleseren

---

## 4. Innhold utenom trikene

**Guidene** (`js/guides.js`, 1 472 linjer) er et fullt redigeringssystem med
moduler, bilder, tabeller og filer, drevet fra adminpanelet. Det er solid
arbeid. Men de henger ikke sammen med resten: ingen XP for å lese, ingen
kobling til trikene, ingen inngang fra forsiden.

**documents/** var det tydeligste funnet i denne kategorien.
Nynorskordliste, matteskjema og hjelpehefte lå i repoet og ble kopiert til
`dist/` av byggesteget – men **var ikke lenket fra en eneste side.**
Nynorskordlista var delvis eksponert som en modul inne i én guide; de andre
var praktisk talt usynlige. Dette er noe av det mest konkret nyttige på
Studilla, og det lå og støvet ned.

### Gjort

- Ressursrad på forsiden med guider + de tre dokumentene.
- Egen «Maler og filer»-seksjon på `guider.html` med alle fire filene
  (hjelpeheftet både som PDF og Word).

Å koble guidene til XP er *ikke* gjort – se «Gjenstår».

---

## 5. Kodehelse

### Funn

- `css/style.css`: 4 424 linjer i én fil.
- `js/admin.js`: 2 366 linjer.
- `Premier (kasser).dc.html` og `Premier (kasser) NY.dc.html` var
  **byte-identiske** (samme md5).
- Rot i rota: `2048Cover` (1,4 MB, uten filendelse), en Google-Snake-skjermdump,
  `Spillcover og ikoner design.zip`.

### En reell feil funnet underveis

`js/leaderboard-data.js` hentet **alle rader** i `game_records` med ett
`select`, uten grense, for så å gruppere dem i nettleseren. Supabase kutter
et slikt svar på 1 000 rader **uten å si fra**. Med dagens trafikk går det
bra. Så snart siden har litt aktivitet begynner topplista stille å vise feil
tall, og spillere forsvinner helt fra den, uten noen feilmelding å feilsøke
etter. Det er den typen feil som er vond å finne i ettertid.

### Gjort

- `style.css` delt i `style.css` (kjerne), `admin.css`, `pages.css` og
  `social.css` (nytt). Verifisert at ikke én CSS-regel er tapt: 1 299
  klammeparenteser før og etter, og sortert linjediff er tom.
- Aggregeringen flyttet til databasen (`leaderboard_totals`, seksjon 55). Én
  rad per spiller og triks i stedet for én rad per runde. Faller tilbake til
  gammel oppførsel med eksplisitt grense hvis migrasjonen ikke er kjørt.
- Det eksakte duplikatet slettet.
- Rotfilene er **ikke** slettet – de kan være kildefiler du vil ha. De er
  listet her i stedet.

### «Spill» vs. «triks»

Sjekket alle sider. Konsekvensen er bedre enn briefen antar: de synlige
sidene bruker «triks» gjennomgående. Restene er:

- `js/admin.js` bruker «spill» overalt – men det er adminpanelet, som ikke
  indekseres og ikke har SEO-konsekvens.
- `game-runtime.js` sa «Spillet er over» og «Spill igjen». Dette settes inn av
  JavaScript, så det påvirker ikke SEO, men det leste rart. Nå «Runden er
  over» og «Én runde til».
- Heltefeltets knapp sa «Spill nå». Nå «Start her».

---

## 6. Tilgjengelighet og teknisk

### Kontrast – ikke et problem

Målt med WCAG-formelen:

| Kombinasjon | Ratio | Krav AA |
|---|---|---|
| `#2ee87f` på `#0d1117` | **11,68:1** | 4,5 ✓ |
| `#0d1117` på `#2ee87f` (knapp) | **11,68:1** | 4,5 ✓ |
| `#96a3b8` på `#0d1117` | 7,41:1 | 4,5 ✓ |
| `#7c8aa0` på `#131a25` (svakest) | 4,99:1 | 4,5 ✓ |

Aksentfargen er trygg. Dette punktet i briefen kan legges bort.

### Der det faktisk sviktet

- **`prefers-reduced-motion` fantes én gang i hele stilarket**, på en side
  som er full av animasjoner (nivåstolper, konfetti, kassebånd, pulser).
- **Ingen skip-lenke.** Tabulator-rekkefølgen begynte på logoen, så gjennom
  hele toppmenyen, på hver eneste sidevisning.
- **`<a href><button></button></a>`** brukt flere steder. Det er ugyldig HTML
  (klikkbart element inni et klikkbart element) og ga to tabulator-stopp for
  samme mål – synlig i den målte tab-rekkefølgen som «A: Spill nå» etterfulgt
  av «BUTTON: Spill nå».
- Søkefelt uten `<label>`, dialoger uten `role="dialog"`/`aria-modal`.

### Gjort

Alt over er utbedret: gjennomført `prefers-reduced-motion` som slår av
animasjoner og transisjoner globalt, skip-lenke som første tabulator-stopp
på alle sider (verifisert), `:focus-visible` med aksentfarge og god
kontrast, alle nøstede knapper erstattet med lenker stylet som knapper,
etiketter på søkefelt, `role="dialog"` + `aria-modal` på game over-kortet og
samtalevinduet, Escape lukker dialoger.

### Lastetid

Poppins fra Google Fonts lastes blokkerende via `<link rel="stylesheet">`.
Med `preconnect` på plass er det håndterbart, men det er fortsatt en ekstern
avhengighet i den kritiske stien.

Mer interessant er hva som skjer når Supabase er treig: `games-data.js` har
et tidsavbrudd på 5 sekunder før den faller tilbake til den statiske lista.
I testmiljøet, der Supabase er utilgjengelig, betydde det at forsiden brukte
**13,6 sekunder** til `networkidle`. På et fungerende nett er dette ikke et
problem, men på et skolenettverk med pakketap er 5 sekunder med tomt
rutenett en lang tid. Dette er **ikke endret** – se «Gjenstår».

### Sikkerhet – det alvorligste funnet

Briefen spør om rekorder kan forfalskes fra konsollen. **Ja, trivielt.**

Slik var det:

```js
// Alt som skulle til, fra konsollen på hvilken som helst side:
supabaseClient.rpc('add_points', { p_delta: 10000000 })
```

`add_points` var `grant execute ... to authenticated` og tok et fritt
heltall. I tillegg skrev klienten rekorder rett inn i `game_records` med
RLS-regelen `auth.uid() = user_id` – altså «du kan skrive hva som helst, så
lenge det er på din egen bruker». `spin_wheel(p_delta)` fikk også premien
sendt inn fra klienten.

Det var to andre veier inn i det samme:

- `studilla_guest_best_2048` i localStorage kunne settes til hva som helst,
  og ble overført til kontoen ved innlogging uten validering.
- Streak-feltene ville vært skrivbare direkte, siden RLS lar deg oppdatere
  din egen profilrad og triggeren bare beskyttet `level`/`xp`/`is_admin`.

**Gjort** (seksjon 48–49): all poenggivning går gjennom
`submit_game_score()`, som regner ut poengene server-side fra `point_rate`,
håndhever et tak per triks (`games.max_score`, standard 250 000) og en
fartsgrense (120 runder/time). `add_points` er trukket tilbake fra klienten.
Direkte innsetting i `game_records` er stengt. Gjesterekorder går gjennom
samme validering. Lykkehjulets premie er begrenset til `wheel_max_prize`.
Streak-feltene er lagt inn i den samme beskyttelsestriggeren.

Dette gjør det ikke *umulig* å jukse – all klientkode kan manipuleres, og en
tålmodig person kan fortsatt sende inn en troverdig, men uekte skår. Men det
flytter jukset fra «én linje i konsollen» til «du må jobbe for det, og du kan
ikke få mer enn taket per runde». Det er forskjellen på at topplista er
meningsløs og at den er verdt å konkurrere om.

**Verifisert lokalt** mot PostgreSQL 16: en gyldig runde går gjennom og gir
riktig xp og nivå; en skår over taket avvises; et ukjent triks avvises;
streaken teller opp én gang per dag og gir bonus; et forsøk på å sette
`streak_current = 365` direkte på egen profilrad blir stille reversert av
triggeren; blokkering stopper meldinger og fjerner følging begge veier; uke-
og totalrangeringen gir riktige tall.

Underveis i den valideringen fant jeg en feil jeg selv hadde innført:
`schema.sql` skal kunne kjøres på nytt fra topp til bunn (det er slik
migrasjoner gjøres her), men `create or replace view` kan ikke fjerne
kolonner fra en view som allerede finnes med flere. Andre gangs kjøring
stoppet derfor på `profiles_public`. Rettet ved å slippe viewen først begge
steder; verifisert med tre kjøringer på rad uten feil.

---

## 7. Data dere allerede har

Adminpanelet har retention-statistikk per triks (`js/admin.js` ca. linje
649–760), basert på `game_records` for innloggede og `guest_game_plays` for
gjester.

**Jeg kan ikke lese de tallene herfra** – testmiljøet har ikke tilgang til
Supabase-prosjektet, og adminpanelet krever en admin-innlogging jeg ikke har.
Briefens råd om å starte der er riktig, og det er du som må gjøre det.

To ting å være klar over når du leser dem:

1. **Gjesterunder kan ikke kobles til en besøkende.** `guest_game_plays`
   lagrer kun triks og skår, uten noen id. Retention-tallene dekker derfor
   kun innloggede. Hvis mesteparten av trafikken er utlogget, er tallene et
   utsnitt, ikke helheten.
2. **Tallene fra før denne endringen er upålitelige oppover**, i den grad
   noen har utnyttet `add_points`. Verdt en kikk etter urimelige xp-verdier
   før du konkluderer på noe.

---

## 8. Modernisering og wow-effekt

Det som faktisk gir «wow» her er ikke flere animasjoner – siden har allerede
en gjennomført visuell identitet som holder. Det som manglet var at
*ingenting skjedde av seg selv*.

Gjort:

- **Trikset starter i heltefeltet.** Å komme til en forside og ha et
  spillbart brett 2,8 sekunder senere, uten sidelasting, er den enkeltvise
  endringen som endrer inntrykket mest.
- Verdiløfte i stor, stram typografi (`clamp(32px, 5vw, 52px)`), pulserende
  status-prikk på nedtellingen, USP-linje.
- Mørkere og høyere forløp over heltebildet – navnet lå tidligere oppå
  motivet og var vanskelig å lese på de fargerike trikene (Bubble Shooter,
  Fruktfusjon).
- Konfetti på ny rekord, tallanimasjon på game over-kortet.
- Streak-flamme i toppmenyen.
- Alt respekterer `prefers-reduced-motion`.

---

## 9. Det sosiale laget

Bygget fra bunnen, med schema, RLS og UI.

| Del | Hvor |
|---|---|
| Følging (ensidig, som TikTok) | `follows`, seksjon 51 |
| Blokkering | `user_blocks`, seksjon 50 |
| Direktemeldinger | `direct_messages`, seksjon 52 |
| Aktivitetsfeed | `following_feed()`, seksjon 54 |
| Vennerangering | `leaderboard-data.js` |
| Ny side | `meldinger.html` |
| Klientlag | `js/social.js` |

### Sikkerhets- og trygghetsvalg (målgruppen er skoleelever)

Dette er ikke en teknisk detalj – et sosialt lag for mindreårige uten
moderering er en fremtidig sak for den som drifter siden. Derfor:

- **Blokkering fra dag én.** Stopper meldinger og følging begge veier, og en
  trigger fjerner eksisterende følging automatisk ved blokkering, slik at man
  ikke blir stående i hverandres lister.
- **Meldinger kan ikke skrives direkte til tabellen.** All sending går
  gjennom `send_direct_message()`, som håndhever blokkering, fartsgrense (60
  i timen) og lengdegrense (1 000 tegn).
- **«Kun fra dem jeg følger»** (`profiles.dm_from_followers_only`) for den som
  ikke vil ha meldinger fra fremmede. Pågående samtaler kuttes ikke.
- **Global av-bryter** (`app_settings.dm_enabled`) hvis funksjonen misbrukes.
- **Mottakeren kan ikke redigere meldingen hen har fått.** En egen trigger
  låser alt annet enn lesetidspunktet – uten den ville RLS-regelen som lar
  mottakeren markere som lest også latt hen skrive om innholdet.
- **All brukerskrevet tekst escapes** før den settes inn som HTML
  (`Social.escapeHTML`).

### Bevisst utelatt

- **Sanntid.** Samtalevinduet poller hvert 8. sekund mens det er åpent, og
  stopper når det lukkes. Supabase Realtime ville vært riktig på sikt, men er
  en avhengighet til som ikke trengs for å komme i gang.
- **Gruppechat.** Én tabell, to parter. Enklere å moderere.
- **Rapportering til admin.** Se «Gjenstår» – dette bør på plass før DM-ene
  markedsføres bredt.

---

## Hva som gjenstår – prioritert

### 1. Kjør `supabase/schema.sql` på nytt

**Ingenting av det nye virker før dette er gjort.** All ny klientkode faller
tilbake til gammel oppførsel hvis funksjonene mangler, og sier fra i
konsollen, så utrullingen er trygg – men siden er ikke sikret, og det sosiale
laget er skjult, til migrasjonen er kjørt.

Jeg har med vilje **ikke** kjørt den mot produksjonsdatabasen. Det er en
endring på levende data som du bør utløse selv.

### 2. Passordgjenoppretting

Den største enkeltrisikoen for retensjon som gjenstår. Tre veier:

- **Valgfri e-post** ved registrering, kun for gjenoppretting. Bevarer lav
  friksjon (feltet kan hoppes over) og gir en vei tilbake for dem som fyller
  det ut.
- **Gjenopprettingskode** vist én gang ved registrering. Ingen e-post, men
  folk mister lapper.
- **Status quo** – admin fikser manuelt. Fungerer på 200 brukere, ikke på
  2 000.

Min anbefaling: valgfri e-post.

### 3. Rapportering av meldinger

`user_blocks` dekker den som blir plaget, men admin ser ingenting. En
`message_reports`-tabell med en «Rapporter»-knapp i samtalevinduet og en
liste i adminpanelet bør på plass før DM-er markedsføres bredt.

### 4. Avgjør premiesystemets skjebne

`premier.html` (916 linjer), nivåstigen, kassene, lykkehjulet og
`levelup-modal.js` ligger avslått. Enten skru det på med ekte partnere, eller
fjern det. Å la det ligge halvveis koster vedlikehold uten å gi noe.

### 5. Mindre ting

- **Fonten**: last Poppins lokalt (`@font-face` + `font-display: swap`) i
  stedet for fra Google Fonts. Fjerner en ekstern avhengighet fra kritisk sti.
- **5-sekunders-tidsavbruddet** i `games-data.js`: vurder å rendre
  fallback-lista med én gang og oppdatere når Supabase svarer, i stedet for å
  vente. Da får en treig forbindelse innhold umiddelbart.
- **Guider ↔ triks**: gi XP for å lese en guide, eller vis en relevant guide
  på game over-kortet. Guidene er en øy i dag.
- **`js/admin.js`** (2 366 linjer) bør deles opp neste gang noen skal jobbe
  der.
- **Rot i rota**: `2048Cover` (1,4 MB uten filendelse), Google-Snake-skjermdumpen
  og `Spillcover og ikoner design.zip`. Ikke slettet – de kan være kildefiler
  du vil beholde, men de hører ikke hjemme i rota.
- **Klasselister**: en skolebasert rangering ville truffet målgruppen bedre
  enn en global. Nå som følging finnes, er en «klasse»-gruppe et lite steg
  videre.

---

## Andre spørsmål jeg vil foreslå at dere undersøker

Briefen ba om dette. Dette er spørsmålene jeg mener er viktigere enn flere
UX-detaljer:

1. **Hvor stor andel av trafikken er utlogget?** Dette avgjør nesten alt
   annet. Hvis 90 % aldri logger inn, er streak, rangering og det sosiale
   laget bygget for 10 %, og innsatsen bør heller gå i gjeste-opplevelsen.
   Tallet finnes i `site_visits` (som lagrer `user_id` når det finnes).

2. **Hvor mange runder spiller folk per økt?** Én runde og ut betyr at
   trikene ikke er vanedannende nok, uansett hvor bra game over-kortet er.
   To–tre runder betyr at løkken virker og at retensjon er riktig sted å
   investere. `game_records` har tidsstempler.

3. **Kommer trafikken fra TikTok, og i så fall til hvilken side?** Hele
   siden er bygget rundt en forside, men hvis folk lander direkte på et triks
   fra en TikTok-lenke, er det *den* siden som må gjøre førsteinntrykket.

4. **Hvem er guidene til?** De er 1 472 linjer kode og betydelig
   redaksjonelt arbeid. Hvis ingen leser dem, er det den dyreste ubrukte
   funksjonen på siden. Umami bør ha sidevisningene.

5. **Hvor mange kontoer er «døde» etter glemt passord?** Kontoer uten
   aktivitet siden opprettelsen, sammenholdt med hvor mange som har
   registrert seg to ganger med lignende brukernavn. Det gir et anslag på hva
   punkt 2 i «Gjenstår» faktisk koster dere.

6. **Er det spor av utnyttet `add_points` i dataene?** Se etter xp som ikke
   står i forhold til antall runder i `game_records`. Verdt å vite før du
   stoler på historiske retention-tall.

---

## Filer endret

| Område | Filer |
|---|---|
| Database | `supabase/schema.sql` (seksjon 48–56) |
| Sikkerhet | `js/game-runtime.js`, `js/auth.js` |
| Sosialt | `js/social.js` (ny), `meldinger.html` (ny), `spillerprofil.html` |
| Retensjon | `js/leaderboard-data.js`, `rangering.html`, `js/auth.js` |
| Forside | `index.html`, `js/main.js` |
| Layout | `js/layout-markup.js` |
| Cookie | `js/cookie-banner.js` |
| Stil | `css/style.css` (delt), `css/admin.css`, `css/pages.css`, `css/social.css` |
| Innhold | `guider.html` |
| Opprydding | `Premier (kasser).dc.html` slettet |

**Sikkerhetskopi av versjonen før endringene:**
tag `pre-modernisering-2026-09-08` og gren
`backup/pre-modernisering-2026-09-08`, begge pushet til origin.
