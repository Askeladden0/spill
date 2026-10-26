# Evaluering av Studilla

**Dato:** 26. oktober 2026
**Omfang:** Formål (steg 1), en blind anbefalt løsning (steg 2), dagens løsning (steg 3) og gap med tiltak (steg 4), vurdert langs de samme dimensjonene (steg 0).
**Metode i korte trekk:** Kodegjennomgang av HTML-sidene, `js/`, `css/`, `build/` og `supabase/schema.sql`. Gjennomgang i nettleser med `npm run dev` på 375 px, ca. 1000 px og 1366 px bredde. Lighthouse 13.5 (mobilprofil) mot den lokale serveren. Bruksdata og sikkerhetsrådgiveren er lest direkte fra Supabase-prosjektet «spill», kun med lesing. `VURDERING.md` og `ADSENSE_AUDIT.md` er brukt som innspill, og funnene derfra er etterprøvd mot dagens kode (se 3.3).
**Ingenting er endret** i kode, database eller innstillinger. Under testingen ble innsetting av gjesterunder til `guest_game_plays` stoppet i nettleseren, slik at testspill ikke havnet i produksjonsdataene. Umami ble blokkert under Lighthouse-kjøringene.

> **Kort oppsummert:** Studilla brukes, og den brukes mye: rundt 7 500 spilte runder de siste 30 dagene, og 92 % av gjesterundene skjer på hverdager mellom kl. 08 og 16. Den brukes nesten bare som spillside. Guidene, som formålet og SEO-kravet bygger på, er lite brukt og står ikke i sitemapen. De største hullene er ytelse (forsiden veier 7,2 MB, mest på grunn av spillbilder på opptil 1,5 MB hver), trygghet for unge brukere (16-årsgrense mot en elevmålgruppe, åpne meldinger fra fremmede, kasser med rabattkoder fra merkevarer) og spillkvalitet i detaljene (ingen pause, tre spill uten tastaturstyring, Slangen som bare starter på «høyre»). Sikkerheten i databasen er grunnleggende god. Den felles malen for spill og guider og byggesteget er bedre enn det mange enmannsprosjekter har.

---

## Steg 0 – Vurderingskriterier

Steg 2 (anbefalt løsning) og steg 3 (dagens løsning) vurderes langs de samme 15 dimensjonene. D1–D11 er de obligatoriske. D12–D14 er lagt til fordi formålet i steg 1 krever dem: målgruppen er elever (som ofte er mindreårige), siden skal gi læringsnytte og ikke bare underholdning, og suksessmålene kan ikke følges opp uten måling. D15 (spillkvalitet) er lagt til etter ønske fra eieren underveis: spillene er grunnen til å komme tilbake hver dag (M1), så kvaliteten på hvert enkelt spill avgjør retensjonen.

Hver dimensjon har et kontrollspørsmål og et kjennetegn på god løsning. I steg 3 får hver dimensjon en karakter fra 1 til 5 (1 = mangler eller er til hinder, 3 = fungerer med tydelige hull, 5 = på nivå med anbefalingen eller bedre). Karakteren er skjønnsmessig og begrunnes med belegg.

| # | Dimensjon | Kontrollspørsmål | God løsning kjennetegnes av |
|---|---|---|---|
| D1 | Første besøk og forståelse av hva siden er | Forstår en ny elev innen fem sekunder hva siden er og hva de kan gjøre? | Tydelig verdiløfte over bretten, én åpenbar første handling, ingen hindringer (popup-kø, innloggingskrav) før første verdi |
| D2 | Kjerneflyten (finne og bruke innhold) | Hvor mange steg er det fra forsiden til at man spiller eller leser en guide, og fungerer det uten konto? | Ett til to klikk til innhold, innhold uten innlogging, rask start, lett å finne neste ting |
| D3 | Grunn til å komme tilbake (retensjon) | Hva får eleven til å komme tilbake i morgen? | Daglig hook (dagens spill/utfordring), synlig egen fremgang, lagret tilstand, uten mørke mønstre |
| D4 | Konto, profil og sosiale funksjoner | Gir kontoen merverdi som står i forhold til friksjonen og risikoen? | Valgfri konto, enkel registrering, rekorder og venner som gir mening, trygge sosiale funksjoner |
| D5 | Mobil og touch | Fungerer alt på en 375 px telefon med touch, inkludert spillene? | Ingen horisontal scroll, touch-kontroller i spillene, store nok trykkflater, ingen zoom-feller |
| D6 | Ytelse og lastetid | Laster siden raskt på et skolenettverk eller mobilnett? | God LCP/CLS/INP, lite blokkerende JS, ingen unødvendige tredjepartsskript, effektiv caching |
| D7 | SEO og synlighet | Kan søkemotorer finne, forstå og rangere innholdet – uten at HTML-en ser ut som en spillnettside? | Unike titler og beskrivelser, indekserbar tekst, sitemap, kanoniske URL-er, strukturerte data, innhold med søkeverdi |
| D8 | Tilgjengelighet (WCAG) | Kan elever med nedsatt syn, motorikk eller som bruker tastatur/skjermleser bruke siden? | WCAG 2.1 AA: kontrast, fokus, landemerker, alt-tekst, etiketter, tastaturstyring, redusert bevegelse |
| D9 | Sikkerhet og personvern (RLS, admin, samtykke) | Er data og admin beskyttet på serversiden, og er samtykke og personvern korrekt håndtert? | RLS på alle tabeller, adminrettigheter håndhevet i databasen, minimal datainnsamling, gyldig samtykke før sporing og annonser |
| D10 | Inntekter (AdSense) | Kan siden tjene penger uten å bryte retningslinjer eller ødelegge opplevelsen? | Godkjent AdSense, ads.txt, samtykkeløsning (CMP) for EØS, annonser adskilt fra spill, nok innhold til godkjenning |
| D11 | Vedlikeholdbarhet for én utvikler | Kan én person legge til innhold, rette feil og rulle ut trygt? | Data fremfor filer, få avhengigheter, automatisk bygg/utrulling, sporbar database (migrasjoner), lite død kode |
| D12 | Læringsinnhold og nytteverdi | Gir siden reell nytte for skolehverdagen, ikke bare tidsfordriv? | Guider og ressurser som er lette å finne, oppdaterte, knyttet til skolefag, og som gir søketrafikk |
| D13 | Trygghet for unge brukere | Er siden trygg for elever, også under 16 år? | Aldersbevisst design, moderering og rapportering i meldinger, blokkering, ingen personlig sporing av barn uten gyldig grunnlag |
| D14 | Måling og læring | Kan utvikleren se om suksessmålene nås? | Personvernvennlig analyse med definerte hendelser (spill startet, guide lest, retur), et lite dashboard, ingen gjetting |
| D15 | Spillkvalitet for brukeren | Er hvert spill morsomt, forståelig, feilfritt og behagelig å spille – på tastatur, mus og touch? | Starter raskt, tydelige regler, presise og responsive kontroller, rettferdig vanskelighetskurve, god game over/restart-flyt, ingen feil eller hakking, skalerer riktig på alle skjermer, pause/fortsett, lagret rekord |

---

## Steg 1 – Formål og funksjonalitet

Kilder: innledningen i `README.md`, teksten i `om.html`, `documents/Studilla-reisen.pptx` (spesielt lysbilde 2 «Utgangspunktet», lysbilde 11 «Fra spillside til ressursside» og avslutningen på lysbilde 13–14 med notater) og `CLAUDE.md`. Andre filer er ikke brukt i dette steget.

### Hva Studilla skal være

Kildene beskriver Studilla på to måter som ikke helt sier det samme:

- **Spillside for elever.** I «Utgangspunktet» står det at Studilla skal være «én side der elever kan spille enkle, kjente nettleserspill – med egen konto, rekorder og etter hvert læringsressurser». I notatet til lysbilde 1 kalles den «en norsk spillnettside for elever». README-overskriften sier også «spillnettside».
- **Hverdagshjelp med tips og guider.** `om.html` beskriver den som «en norsk nettside lagd for å gjøre hverdagen din enklere», der skaperen har «samlet opp alle mine tips og triks på et sted». Hensikten er «et sted som er morsomt å komme tilbake til hver dag, og som samtidig har nyttige guider». Lysbilde 11 beskriver utviklingen «fra spillside til ressursside».

**Antakelse:** Formålet er nå todelt. Spillene er grunnen til å komme tilbake hver dag, og guidene og ressursene er nytten, det som gir søketrafikk og det siden presenterer seg som utad. SEO-kravet i `CLAUDE.md` (siden skal ikke se ut som en spillnettside i HTML-en) peker samme vei: utad skal Studilla fremstå som en ressurs- og hverdagsside, mens spillene er en del av opplevelsen.

### Målgruppe

- **Primært:** norske elever («elever» i «Utgangspunktet» og i notatet til lysbilde 1).
- **Antakelse om alder:** omtrent 13–19 år, altså ungdomsskole og videregående. Grunnlaget er at ressursene som nevnes (norsk-/nynorskmal, P-matte-snarveier og nynorsk-oversetter på lysbilde 11) passer for ungdomsskole og vg1, og at en egen velkomst for besøkende fra skolesaus.no tyder på en skoleelevkanal. Kildene oppgir ikke alder. Det får konsekvenser for personvern, samtykke og annonser (D9, D10, D13), fordi en del av målgruppen trolig er under 16 år.
- **Sekundært:** følgere av skaperen på TikTok (`om.html`, lysbilde 11 «Kreditering»).

### Problemer og oppgaver Studilla løser

| Brukerbehov | Kilde |
|---|---|
| Ha et kjent, enkelt og gratis sted å spille korte nettleserspill i pauser, uten installasjon | «Utgangspunktet», `om.html` |
| Få konkrete tips, maler og snarveier til skolearbeid (norsk/nynorsk, matte) samlet ett sted | `om.html` («tips og triks på et sted», «steg-for-steg-råd og maler»), lysbilde 11 |
| Se egne rekorder og sammenligne seg med andre | «Utgangspunktet» (konto, rekorder), `om.html` (rangering) |
| Holde kontakt med andre brukere | `om.html` («Logger du inn, vil du også få tilgang på rangering og meldinger») |
| Gi tilbakemelding til skaperen | `om.html` (kontakt-siden) |

### Funksjonalitet siden skal ha

1. **Innhold uten konto:** spill, tips og guider skal kunne brukes uten innlogging (`om.html`).
2. **Spill:** enkle, kjente nettleserspill. Lysbilde 13 nevner seks spill i én felles mal og et «dagens spill».
3. **Guider og ressurser:** steg-for-steg-råd, maler og nedlastbare dokumenter (`om.html`, lysbilde 11).
4. **Konto (valgfri):** brukernavn og passord uten e-post (lysbilde 13). Kontoen gir tilgang til rangering og meldinger (`om.html`).
5. **Rangering:** topplister og personlige rekorder («Utgangspunktet», lysbilde 13).
6. **Meldinger:** meldinger mellom innloggede brukere (`om.html`).
7. **Administrasjon:** én administrator som kan følge med på statistikk og styre brukere, spill og guider (lysbilde 13).
8. **Personvern:** vilkår, cookie-samtykke og RLS i databasen (lysbilde 13, «Utgangspunktet»).
9. **Inntekter:** annonser fra Google AdSense, tydelig adskilt fra innholdet (`om.html`).

### Rammer

| Ramme | Kilde |
|---|---|
| **Én utvikler.** Siden er laget av én person alene (Snorre Saus); omtrent 80 timer på 18 dager i første versjon. | `om.html`, lysbilde 1 og 12 |
| **Statisk frontend uten rammeverk.** Ren HTML, CSS og JavaScript, ingen npm-avhengigheter i frontend. README beskriver et lite byggesteg i ren Node for felles head/meny og cache-busting. | README, lysbilde 2 med notat, lysbilde 13 med notat |
| **Supabase som backend.** Innlogging, profiler, rekorder og nivåer i Postgres med RLS på alle tabeller. | README, lysbilde 2 |
| **GitHub Pages som hosting.** `dist/` publiseres via GitHub Actions. | README |
| **Gratis å bruke, finansiert med AdSense.** | `om.html` |
| **SEO-krav:** HTML-en skal ikke få siden til å se ut som en spillnettside for søkemotorer. Gjelder ikke det som ikke påvirker SEO. | `CLAUDE.md` |
| **Ingen kategoritagger** på spill eller rangeringer. | `CLAUDE.md` |
| **Én mal per innholdstype:** ett spill og én guide legges til som data, ikke som nye filer. | Lysbilde 2 og 8 |
| **Bygg for å kunne skru av:** funksjoner skjules med funksjonsbrytere i stedet for å slettes. | Lysbilde 6 og 14 |
| **Arbeidsflyt:** endringer merges til main og pushes umiddelbart. Admin-tilgang settes på en bestemt måte på grunn av en trigger. | `CLAUDE.md` |

### Hva suksess betyr

Kildene gir retning («morsomt å komme tilbake til hver dag», «nyttige guider», «gratis», «finansiert med AdSense»), men ingen tall. Målene og tallene nedenfor er derfor **antakelser**, valgt for å være målbare og realistiske for et enmannsprosjekt i tidlig fase.

| Mål | Måles som | Foreslått terskel (Antakelse) | Støtter |
|---|---|---|---|
| M1 Daglig retur | Andel besøkende som kommer tilbake innen 7 dager | ≥ 25 % | «morsomt å komme tilbake til hver dag» |
| M2 Rask vei til verdi | Andel førstegangsbesøk som starter et spill eller åpner en guide | ≥ 60 % | Kjerneflyt uten konto |
| M3 Nytte | Visninger av guider/ressurser per uke, og andel trafikk fra organisk søk | Voksende måned for måned; ≥ 30 % organisk etter 6 måneder | «nyttige guider», SEO-krav |
| M4 Konto med mening | Andel aktive brukere som oppretter konto | 5–15 % (konto er valgfri) | Rangering, meldinger |
| M5 Inntekter | AdSense godkjent og RPM/månedsinntekt som dekker driftskostnader | Godkjent; inntekt ≥ driftskostnad | Gratis, finansiert med AdSense |
| M6 Teknisk kvalitet | Lighthouse mobil: ytelse, tilgjengelighet, SEO og beste praksis | ≥ 90 på alle fire | Elever på mobil og skolenett |
| M7 Trygghet | Ingen kritiske RLS-/sikkerhetsfunn; samtykke før sporing og annonser | 0 kritiske funn | RLS «på alle tabeller», cookie-samtykke |
| M8 Bærekraft for én utvikler | Tid fra idé til publisert nytt spill eller ny guide | Spill < 1 dag, guide < 1 time | «Én mal per innholdstype» |

---

## Steg 2 – Anbefalt løsning (blindt)

**Slik ble svaret laget:** En subagent fikk bare teksten fra steg 1 og kriteriene fra steg 0, limt inn i oppgaven. Den fikk beskjed om ikke å bruke verktøy, ikke lese filer og ikke søke etter Studilla eller noe annet på nettet. Den skulle beskrive hvordan den selv ville løst formålet innenfor rammene, langs hver dimensjon. D15 (spillkvalitet) ble lagt til i steg 0 etter at subagenten var startet, så den fikk en oppfølgingsmelding med D15-kriteriet og leverte deretter et komplett svar på nytt. Teksten under er det komplette svaret, limt inn uendret.

---

### Overordnet konsept

Utad er Studilla en **ressursside for skolehverdagen**: guider, maler og små verktøy til norsk, nynorsk og matte, skrevet av en elev for elever. Pausene, altså de enkle nettleserspillene, er grunnen til å komme tilbake, men de er ikke identiteten. De bruker én felles mal og én felles kjøretid under `/pause/`, er `noindex` og nevnes aldri i titler, metadata, H1 eller strukturerte data. Forsiden har ett «I dag»-kort med dagens tips og dagens pause. Ellers består den av søk og populære guider. Alt innhold fungerer uten konto. Kontoen (brukernavn og passord, uten e-post) gir synk mellom enheter, topplister og venner, med meldinger bak funksjonsbryter og opt-in. Guidene ligger som data i Supabase og forhåndsrendres til statisk HTML av et lite byggesteg i ren Node i GitHub Actions. Et nytt spill er én logikkmodul pluss én rad i databasen, ingen ny side. AdSense bruker manuelle annonseenheter, bare på innholdssider og etter samtykke. Byggesteget håndhever reglene: det feiler hvis «spill/game/play» havner i SEO-felt, hvis titler er like, eller hvis noe rendrer kategoritagger.

```
/                     Forside: verdiløfte, søk, «I dag», populære og nye guider
/guider/              Alle guider, søk, samlesider (håndskrevne, én per fag)
/guider/<slug>/       Guidemal (forhåndsrendret, indeksert)
/pause/               Oversikt over pauser (noindex)
/pause/?id=<id>       Felles pausemal (noindex)
/topplister/          Dag, uke og alle tider per pause (noindex)
/meg/                 Rekorder, dagsrekke, lagrede guider, konto
/meldinger/           Venner og meldinger (flagg, noindex)
/om/ /kontakt/ /personvern/ /vilkar/ /trygg-pa-nett/
/admin/               Adminpanel (noindex, ikke i sitemap, ingen tredjepartsskript)
```

### D1 – Første besøk og forståelse av hva siden er

- H1 over bretten: «Tips, maler og snarveier for skolehverdagen», med undertekst «Gratis. Ingen konto nødvendig.»
- Én primær handling: søkefeltet «Hva trenger du hjelp med?». Under det står tre lenker til de mest leste guidene, ikke tagger.
- Rett under ligger «I dag»-kortet: dagens tips (én setning og en lenke) og knappen «Dagens pause – ca. 2 min». Kortet har `data-nosnippet`.
- Lenken i TikTok-bioen har `?fra=tt`. Da flyttes pausekortet først. Standardrekkefølgen, som er den søkemotorer ser, har ressursene først.
- Ingen popup-kø. Eneste overlegg er samtykkemeldingen i den minst påtrengende varianten. Ingen modaler som ber om konto, og ingen nyhetsbrev.

Kjennetegn på at det er løst: I en femsekunderstest med fem elever kan minst fire si «tips til skolen + små pauser» og peke på første klikk.

### D2 – Kjerneflyten (finne og bruke innhold)

- Guide: ett klikk fra forsiden, eller søk. Søket kjører i nettleseren mot en `search-index.json` (ca. 20 kB) som bygget lager.
- Pause: ett klikk fra «I dag». Pausesiden viser en kort instruksjon og en stor Start-knapp. Spillmodulen lastes med `import()` mens instruksjonen vises.
- Ingenting krever innlogging. Det gjelder lesing, nedlasting av maler og pauser. Rekorder lagres lokalt.
- Etter en runde vises «Prøv igjen», «Neste pause» og én relatert guide (`games.related_guide_id`). Etter en guide vises «Neste guide» (`next_slug`) og «Ta en pause på 2 min».
- Guidemalen åpner med «Kort svar» i 3–5 punkter.

Kjennetegn på at det er løst: Median tid fra forsiden lastes til `guide_open` eller `pause_start` er under 10 s, og M2 er minst 60 %.

### D3 – Grunn til å komme tilbake (retensjon)

- Dagens pause: Alle får samme pause og samme frø (dato som seed) hele dagen. «Dagens topp» blir sammenlignbar og noe å snakke om i friminuttet.
- Dagens tips roterer fra en kø av korte tips. Hvert tips lenker til en guide.
- Dagsrekke: Den teller dager med dagens pause eller dagens tips. Du får én automatisk fridag per uke. Et brudd vises nøytralt («Ny rekke i dag»), uten skam og uten nedtelling.
- `/meg/` viser rekorder, rekken, lagrede guider og «Fortsett der du slapp». Dette ligger i localStorage og synkes ved innlogging (`user_state`).
- Ukelisten nullstilles hver mandag. Nye guider kommer før tentamen (nov.–des.) og eksamen (mai–juni), og det finnes en seksjon «Nytt denne uken».
- Ingen push, e-post, tapsaversjon, kunstige nedtellinger eller belønningsøkonomi.

Kjennetegn på at det er løst: Dashbordet viser M1 (7-dagers retur) på minst 25 %, og andelen returbesøk som starter i «I dag»-kortet.

### D4 – Konto, profil og sosiale funksjoner

- Kontoen er valgfri. Den foreslås bare i en relevant situasjon, for eksempel etter ny rekord: «Lag konto for å komme på topplisten». Forslaget kan lukkes og vises maks én gang per økt.
- Registrering: brukernavn (3–20 tegn, a–z, 0–9 og _, med ordfilter og reserverte navn), passord på minst 10 tegn, avkrysning for «13 år eller eldre» og vilkår, og Turnstile bare på registreringssiden.
- Teknisk: Supabase Auth med syntetisk e-post `brukernavn@u.<domene>`, uten MX og med e-postbekreftelse av. Brukernavnet kan bare endres av admin.
- Glemt passord: En gjenopprettingskode vises én gang ved registrering og lagres som bcrypt-hash. Edge Function `gjenopprett` bytter passordet.
- Lokale rekorder importeres som personlige rekorder, men aldri til topplisten.
- Venner legges til bare med eksakt brukernavn. Det finnes ingen brukerkatalog, og begge må godkjenne. Topplister viser bare brukernavn, avatar og poeng.
- «Slett konto» ligger i `/meg/`. Det er en RPC som kaskaderer slettingen.

Kjennetegn på at det er løst: Registrering tar under 30 sekunder, sletting av konto fungerer, og M4 ligger på 5–15 %.

### D5 – Mobil og touch

- Mobil først, testet på 375×667. Ingen faste bredder. Tabeller ligger i en egen scroll-beholder.
- Spillflaten skaleres av den felles kjøretiden (se D15). Kontrollene ligger under flaten, i tommelsonen.
- `touch-action: none` og `overscroll-behavior: contain` brukes bare på spillflaten. `touch-action: manipulation` brukes på knapper. Knipezoom slås aldri av.
- Skjemafelt har 16 px skrift, så iOS ikke zoomer ved fokus. Trykkflater er minst 44×44 px.
- Ingen fast- eller ankerannonser og ingen interstitials.

Kjennetegn på at det er løst: `scrollWidth === 375` på alle maler, og alle pauser kan fullføres med bare touch.

### D6 – Ytelse og lastetid

- Systemfonter. Én CSS-fil under 20 kB og én kjernemodul under 15 kB gzip. Spillmodul og Supabase-klient lastes bare når de trengs.
- Supabase-klienten ligger som en vendret, versjonslåst kopi i `/vendor/` og lastes lazy, bare for kontofunksjoner. Offentlige lesinger går via `fetch` mot PostgREST.
- Guidene er forhåndsrendret, så LCP er tekst. Bygget lager `flags.json` og `daily.json`, så forsiden trenger ingen databasekall.
- Filnavn får hash (`app.3f9a2c.js`) mot gammel JS etter utrulling. Bildene er AVIF/WebP med `width`/`height` og `loading="lazy"`.
- `adsbygoogle.js` lastes først etter samtykke og ved `requestIdleCallback`. Annonseplassene har fast `min-height`. Bygget feiler hvis en side passerer 100 kB før annonser.

Kjennetegn på at det er løst: Lighthouse mobil ≥90 på forside, guide og pausemal, og LCP under 2,5 s, CLS under 0,1 og INP under 200 ms.

### D7 – SEO og synlighet

- Bare guider, samlesider og faste sider indekseres. `/pause/`, `/topplister/`, `/meg/`, `/meldinger/` og `/admin/` har `noindex` og står ikke i `sitemap.xml`.
- Tittelmal: `<Konkret nytte> – <presisering> | Studilla`, maks 60 tegn. Unik metabeskrivelse på 120–155 tegn, én H1 og kanonisk URL med avsluttende skråstrek.
- Strukturerte data: `WebSite` og `Organization` på forsiden, `Article` og `BreadcrumbList` på guider. Aldri `VideoGame` eller `Game`.
- «Pause» brukes i URL, meny og lenketekst. Pausene får generiske navn, ikke varemerker.
- Byggelinten feiler ved forbudte ord i title, meta, H1–H2, OG og JSON-LD, ved dupliserte titler eller beskrivelser, ved mer enn én H1 og ved brutte interne lenker.
- `sitemap.xml` får `lastmod` fra `updated_at`. Google Search Console verifiseres. Samlesidene er selv guider, ikke tagger, og lenker til underguidene.

Kjennetegn på at det er løst: Search Console viser bare guider og faste sider som indeksert, null duplikater uten kanonisk URL, og M3 er minst 30 % etter seks måneder.

### D8 – Tilgjengelighet (WCAG)

- Landemerker, lenken «Hopp til innhold» og logisk overskriftshierarki.
- Kontrast på minst 4,5:1 for tekst og 3:1 for UI. Tydelig `:focus-visible`.
- Alle felt har `<label>`. Feilmeldinger kobles med `aria-describedby` og leses opp med `aria-live`.
- Pauser: full tastaturstyring, poengsum i en strupet `aria-live`, tekstlige regler og ingen blinking over 3 per sekund. Tilstand vises med både form og farge, og man kan velge lavere hastighet.
- `prefers-reduced-motion` slår av animasjoner. Topplister er ekte `<table>`. Nedlastingslenker oppgir format og størrelse. Bygget feiler hvis alt-tekst mangler.

Kjennetegn på at det er løst: Lighthouse tilgjengelighet ≥95, ingen kritiske funn i axe, og en manuell runde med tastatur og VoiceOver per mal er dokumentert.

### D9 – Sikkerhet og personvern (RLS, admin, samtykke)

- RLS er på for alle tabeller. CI kjører en SQL-sjekk som feiler hvis noen tabell i `public` har `rowsecurity = false`.
- Admin styres av `is_admin()` (`security definer`, `set search_path = ''`) i policyene. En trigger hindrer brukere i å endre `is_admin` og `is_banned`. Adminpanelet er bare et grensesnitt.
- Skriving som har regler går via RPC (`submit_score`, `send_message`, `log_event`), ikke via direkte `insert`.
- Frontend har bare anon-nøkkelen. Service-nøkkelen finnes kun i Edge Function-secrets.
- XSS: Brukerdata settes med `textContent`, og Markdown rendres i bygget med escaping. `/admin/`, `/meg/` og `/meldinger/` har streng CSP og ingen tredjepartsskript.
- Ingen e-post, ekte navn, fødselsdato, IP-adresser eller bilder lagres. `pg_cron` sletter meldinger og rå hendelser etter 90 dager og inaktive kontoer etter 24 måneder.
- Samtykke håndteres av Googles sertifiserte CMP (TCF 2.2). Ingen annonse- eller statistikklagring skjer før brukeren har svart.

Kjennetegn på at det er løst: Security Advisor viser ingen feil. pgTAP-tester bekrefter at anon ikke kan lese `messages` eller `events`, og at ingen kan gjøre seg selv til admin. Nettverksfanen viser ingen Google-kall før samtykke.

### D10 – Inntekter (AdSense)

- Eget domene med `ads.txt` i roten: `google.com, pub-…, DIRECT, f08c47fec0942fa0`.
- Før søknad: minst 25 originale guider på 600+ ord, pluss sidene om, kontakt, personvern og vilkår.
- Manuelle annonseenheter, auto ads av. Guide: én etter seksjon 2 og én til slutt. Guideoversikt: én. Forside: én under bretten.
- Ingen annonser på pause-, `/meg/`-, `/meldinger/`- eller `/admin/`-sider. Alle annonser merkes «Annonse».
- Ikke-personaliserte annonser er standard, og sensitive kategorier blokkeres. Flagget `ads` er en global kill-switch.

Kjennetegn på at det er løst: ads.txt har status «Autorisert», det finnes ingen policybrudd, og inntekten er minst like stor som driftskostnaden (M5).

### D11 – Vedlikeholdbarhet for én utvikler

```
src/partials/  src/pages/  src/templates/{guide,pause}.html
src/js/core.js  src/js/runtime/  src/js/pauser/<id>.js  src/css/site.css
build.mjs  supabase/migrations/  supabase/tests/  test/
```

- `build.mjs` er ca. 400 linjer ren Node uten avhengigheter. Det setter sammen partials, henter publiserte guider, pauser og flagg, rendrer og hasher filer, lager sitemap og søkeindeks, og kjører lint.
- GitHub Actions bygger, tester (`node --test`) og ruller ut ved push, hver natt kl. 00.10 og ved manuell kjøring.
- Nytt spill: én logikkmodul mot kjøretidens grensesnitt (se D15) pluss én rad i `games`. En variant er bare `config`-JSON. Ny guide skrives i admin og publiseres med bygget.
- Funksjonsbrytere: `feature_flags`, `games.is_active` og `guides.status`. Standardverdiene bakes inn i bygget, så siden virker selv om Supabase er nede.
- Alle databaseendringer går gjennom migrasjoner i Supabase CLI. Et skript lister JS-filer som ikke importeres noe sted.

Kjennetegn på at det er løst: En ny guide publiseres på under en time uten kodeendring, og databasen kan gjenskapes fra `migrations/`.

### D12 – Læringsinnhold og nytteverdi

- Guidemal: «Kort svar» → steg for steg → eksempel → mal til nedlasting → «Vanlige feil» → «Sist oppdatert» og hvem guiden passer for, som tekst og ikke tagg.
- Startpakke: maler for kronikk, leserinnlegg og novelle, sjekkliste for nynorsk sidemål, kildeføring, prosent og vekstfaktor, GeoGebra CAS-kommandoer og eksamenssjekklister for 1P/2P.
- Verktøy bygges inn med kortkode (`{{verktøy:nynorsk}}`), ikke som egne maler.
- Hver guide har en `review_after`-dato, og admin får en liste over guider som må sjekkes mot LK20.
- «Var dette nyttig?» (ja/nei). Søk uten treff legges i innholdsbackloggen.

Kjennetegn på at det er løst: Det finnes minst 25 guider, alle oppdatert de siste 12 månedene, og Search Console viser visninger på minst 50 søkeord.

### D13 – Trygghet for unge brukere

- 13-årsgrense, som er norsk samtykkealder for informasjonssamfunnstjenester. Ingen fritekstprofil, ekte navn, bilder eller lokasjon. Bare forhåndsdefinerte avatarer.
- Meldinger har globalt flagg og opt-in per bruker, avslått som standard. De går bare mellom gjensidige venner og er ren tekst på maks 500 tegn. Lenker og telefonnumre maskeres, det er ordfilter, og grensen er 20 meldinger i timen.
- Blokkering virker med en gang. «Rapporter» sender til en adminkø, og admin kan bare lese rapporterte meldinger med kort kontekst.
- Man kan slå av mottak av venneforespørsler. `/trygg-pa-nett/` lenker til Kors på halsen og slettmeg.no.
- Ved en hendelse slår admin av `messages` på sekunder.

Kjennetegn på at det er løst: En test viser at en som ikke er venn ikke kan sende melding, og rapporter behandles innen 48 timer.

### D14 – Måling og læring

- Egen hendelsestabell i Supabase (EU-region), ikke Google Analytics. Hendelser sendes via `log_event`, som bare godtar navn på en hviteliste.
- Hendelser: `page_view` (sti og henvisningstype), `guide_open`, `guide_read`, `download`, `pause_start`, `pause_end` (varighet og årsak), `pause_restart`, `pause_error`, `daily_done`, `search_no_result`, `signup` og `return`.
- Uten samtykke sendes bare anonyme tellinger, og ingenting lagres på enheten. Med TCF-formål 1 og 8 lagres første besøksdato og en øktnøkkel, slik at M1 og M2 kan beregnes.
- `pg_cron` aggregerer til `daily_stats`. Admin-dashbordet har åtte tall med trend over 30 dager, topp 10 guider, søk uten treff og en spilltabell (se D15).
- Rutine: 15 minutter hver mandag, og én beslutning skrives i loggen.

Kjennetegn på at det er løst: M1–M4 kan leses av dashbordet uten manuell SQL, og ingen hendelse inneholder en ID uten samtykke.

### D15 – Spillkvalitet for brukeren

**Felles kjøretid (`src/js/runtime/`, ca. 500 linjer).** Hvert spill leverer bare logikk og tegning:

```js
export default {
  meta: { grid: [20, 20], tick: 120 },  // logisk oppløsning, ms per steg
  init(cfg, rng) { return state },      // rng = seedet PRNG (mulberry32)
  step(state, actions) { return state },// ren funksjon, ingen DOM
  render(ctx, state, alpha) {},
  isOver(state), score(state)
}
```

- Kjøretiden eier løkken: fast tidssteg med akkumulator, `requestAnimationFrame` til tegning og maks 5 steg per frame, så en treg frame aldri gir «teleportering».
- Den eier også tilstandsmaskinen: klar → 3-2-1 → spiller → pause → slutt.
- Pause og fortsett skjer automatisk ved `blur`, `visibilitychange` og rotasjon, og manuelt med P, Esc eller knapp.
- Kjøretiden lagrer rekorden (localStorage, og via `submit_score` når man er innlogget) og viser game over-skjermen med poeng, rekord og «Ny rekord!». Restart tar ett trykk (Enter, R eller knapp), uten å laste siden på nytt.
- Lyd er av som standard og slås på med en bryter.

**Input.** All input oversettes til abstrakte handlinger: `left/right/up/down/action/pause`.
- Tastatur: piler og WASD. `preventDefault` brukes bare når spillflaten har fokus, så siden ikke scroller.
- Pointer Events dekker mus og touch samlet. Sveip har en terskel på 24 px og låser retningen, og det finnes skjermknapper.
- Inputbuffer på to handlinger, så raske svinger ikke forsvinner. Ugyldige handlinger filtreres, for eksempel 180 graders vending.
- Tastrepetisjon (forsinkelse og så fast takt) for spill der man holder inne en tast. `pointercancel` håndteres.

**Skalering.** Spillene tegner i logiske enheter.
- Kjøretiden regner ut et heltall for cellestørrelse fra tilgjengelig plass (`ResizeObserver`), multipliserer med `devicePixelRatio`, sentrerer flaten med kantbånd ved behov og slår av bildeutjevning.
- DOM-baserte spill bruker CSS grid og `aspect-ratio`. Spillene testes fra 320 til 1920 px og i både stående og liggende modus.

**Vanskelighetskurve som data.** `games.config` inneholder startfart, økning per nivå, maksfart og en «snill start» på ca. 20 s. Kurven justeres i admin uten kodeendring.

**Kvalitetssjekkliste per spill.** Et spill må bestå alt før `is_active = true`. Datoen lagres i `games.qa_passed_at`.
1. Reglene står i maks tre linjer, med et statisk eksempelbilde.
2. Under 3 s fra side til første trekk.
3. Respons innen samme frame og jevn 60 fps på en billig Android (ingen frame over 50 ms i Performance-panelet).
4. Fullt spillbart med tastatur, mus og touch hver for seg.
5. Pause og fortsett, restart med ett trykk, og rekorden overlever omlasting.
6. Riktig skalering i stående og liggende modus og ved endret vindusstørrelse.
7. Ingen konsollfeil. Etter 20 restarter skal antall lyttere og minnebruk være uendret (`destroy` rydder).
8. Fungerer med redusert bevegelse og lav hastighet.

**Testing.** Fordi `step` er ren og seedet, kan logikken testes i Node uten nettleser:
- Enhetstester av reglene (`node --test`).
- Replay-tester: seed pluss inputsekvens skal gi forventet poeng. De fanger regresjoner når kjøretiden endres.
- Fuzz-test: 10 000 tilfeldige steg skal gå uten unntak eller ugyldig tilstand.
- Manuell enhetsrunde før aktivering: billig Android, iPhone SE, skole-Chromebook og PC med mus.
- `?debug=1` viser fps, steg per frame og siste handlinger.
- `window.onerror` sender `pause_error` med spill-ID og melding.

**Velge og forbedre spill.**
- Utvalgskriterier: kjent mekanikk, regler forstås på 10 s, runder på 1–3 min, fungerer godt med touch, og ingen varemerkenavn.
- Admin får en spilltabell med starter, andel tidlige avbrudd (under 10 s), median rundetid, restartrate (`pause_restart/pause_end`), feilrate og 👍/👎 etter runden.
- Hver måned forbedres spillet med svakest tall. Et spill som ikke kan løftes, skrus av med `is_active`, det slettes ikke.
- Nye spill legges til bare når de seks eksisterende består sjekklisten.

Kjennetegn på at det er løst: Alle aktive spill har `qa_passed_at` og grønne replay- og fuzz-tester i CI. `pause_error` er 0 over en uke. Restartraten er minst 40 %, og tidlige avbrudd er under 15 % per spill.

### Datamodell

| Tabell | Viktigste kolonner | RLS i ord |
|---|---|---|
| `profiles` | id (= auth.uid), username (citext, unik), avatar, is_admin, is_banned, messages_opt_in, requests_open | Alle leser offentlige felt via viewet `public_profiles`. Eier endrer ufarlige felt. Admin- og ban-felt endres kun av admin (trigger). |
| `user_state` | user_id, streak, last_daily, saved_guides jsonb, local_records jsonb | Bare eieren kan lese og skrive. |
| `account_recovery` | user_id, code_hash | Ingen klienttilgang. Brukes bare av Edge Function. |
| `games` | id, title, instructions, module, config jsonb, score_order, max_rate, related_guide_id, is_active, qa_passed_at | Alle leser aktive rader. Admin skriver. |
| `guides` | id, slug, title, meta_description, body_md, next_slug, files jsonb, status, review_after, updated_at | Alle leser publiserte. Admin har full tilgang. |
| `daily` | date, game_id, seed, tip_text, tip_guide_id | Alle leser. Admin skriver. |
| `scores` / `best_scores` | user_id, game_id, score, duration_ms, seed, period | Skrives kun via `submit_score` (ban, rate og plausibilitet sjekkes). Alle leser beste resultater. |
| `friendships` | user_a, user_b, status, requested_by | Bare de to partene leser. Mottakeren godtar. |
| `blocks` | blocker_id, blocked_id | Bare den som blokkerer. |
| `messages` | id, sender_id, recipient_id, body (maks 500), created_at, read_at | Avsender og mottaker leser. Skrives via `send_message`. Admin leser bare rapporterte. |
| `reports` | id, reporter_id, message_id/user_id, reason, status | Innloggede oppretter. Rapportøren ser egne. Admin har full tilgang. |
| `feedback` | page_or_game, helpful, comment (maks 500) | Alle kan sette inn. Bare admin leser. |
| `feature_flags` | key, enabled, note | Alle leser. Admin skriver. |
| `events` / `daily_stats` | name, path, ref_type, props, consented / day, metric, value | Settes inn via `log_event`. Bare admin leser. |

### Hva jeg bevisst ville latt være

- Rammeverk, SPA, spillmotorbiblioteker og serverrendring utover byggesteget
- E-post, nyhetsbrev, push-varsler og «glemt passord» via e-post
- Bilder, filer og grupper i meldinger, sanntidschat, offentlig brukersøk og profilbilder
- Kommentarfelt på guider og brukergenerert innhold
- Flerspiller i sanntid og anti-juks utover plausibilitetssjekk og admin-sletting
- Fysikkmotorer, lyd som standard, gamepad og spill som krever lengre økter
- PWA og service worker i første versjon
- Auto ads, personaliserte annonser, Google Analytics og A/B-rammeverk
- Merker, poengøkonomi, native app, flere språk og AI-generert masseinnhold

### Antakelser

- Siden har eget domene (nødvendig for `ads.txt`), og GitHub Actions er tilgjengelig.
- Supabase kjører i EU-region på gratisnivå. Edge Functions og `pg_cron` er tillatt innenfor rammen «Supabase».
- Aldersgrensen er 13 år. En myndig person eier AdSense-kontoen.
- Googles CMP er tilstrekkelig samtykkeløsning, og den kan leses via `__tcfapi`.
- De seks spillene er enkle rutenett- eller canvas-spill som passer i en kjøretid med fast tidssteg, og de kan få generiske navn.
- «Data, ikke filer» betyr ingen nye HTML-sider. En ny spillmodul er derfor tillatt som JS-fil.
- Nynorsk-oversetteren kan kjøre som ordlisteoppslag på klienten.
- Skaperen skriver guidene selv, i 1–2 økter i uken.
- Trafikken holder seg godt innenfor gratisgrensene til Supabase og GitHub Pages, og annonser bryter ikke vilkårene til GitHub Pages.

---

### Kommentar: der anbefalingen bryter med eller strekker rammene

Anbefalingen holder seg i hovedsak innenfor rammene: statisk frontend uten rammeverk, Supabase, GitHub Pages, AdSense, ingen kategoritagger («som tekst, ikke tagg», «samlesider … ikke tagger») og SEO-kravet (pausene er `noindex` og nevnes ikke i SEO-felt). Disse punktene strekker eller bryter rammene:

1. **Byggesteget blir mye større enn «lite».** I dag setter `build/build.mjs` sammen felles head og meny og legger på cache-busting. Anbefalingen lar bygget hente guider fra Supabase, forhåndsrendre dem, lage søkeindeks og sitemap, kjøre lint og bygge hver natt via cron. Det er fortsatt ren Node uten avhengigheter, men utrullingen blir avhengig av at Supabase svarer under bygget, og byggesteget får et ansvar rammen ikke beskriver.
2. **Én HTML-fil per guide i utdataene.** Rammen «én mal per innholdstype … aldri én fil per element» holdes i kildekoden, siden guidene fortsatt er data. Den forhåndsrendrede `dist/guider/<slug>/` er likevel én fil per guide. Det bryter med bokstaven i rammen, men ikke med hensikten.
3. **Flere driftsflater for én utvikler.** Edge Functions (gjenoppretting av konto), `pg_cron`, Supabase CLI-migrasjoner, pgTAP, `node --test` og Cloudflare Turnstile (en ny tredjepart) er hver for seg innenfor «Supabase som backend», men til sammen er det mye å vedlikeholde for én person.
4. **Ny spillkjøretid betyr omskriving av alle spill.** Kravet om ren, seedet `step`-funksjon og felles løkke i D15 er innenfor rammene, men det betyr i praksis at alle sju synlige spillene må skrives om. Det er en stor jobb for én utvikler.
5. **Ingen belønningsøkonomi.** Anbefalingen dropper nivåer, kasser og merker. Det bryter ingen ramme, men går mot et produktvalg eieren har tatt (nivåsystemet er slått på igjen, se D3 og D13 i steg 3). Rammen «bygg for å kunne skru av» peker mot at dette løses med funksjonsbryteren, ikke ved sletting.
6. **Faktagrunnlag.** Subagenten antar «de seks spillene». I dag er sju spill synlige og to skjult. Den antar også at domenet ikke er avklart. Det er det: studilla.no med `ads.txt` i roten.


---

## Steg 3 – Dagens løsning

### 3.1 Grunnlag og begrensninger

| Kilde | Hva som ble gjort |
|---|---|
| Kode | Gikk gjennom alle HTML-sider, `js/` (inkludert alle ni spillmodulene i `js/games/` og `game-runtime.js`), `css/`, `build/build.mjs` og `build/partials/head.html`, og `supabase/schema.sql` (5 123 linjer: tabeller, RLS, triggere og SECURITY DEFINER-funksjoner). |
| Nettleser | `npm run dev` (bygget 17 sider til `dist/`) og den innebygde nettleseren på 375 × 812 (mobil), ca. 1000 px og 1366 × 768. Fulgte en førstegangsbesøkende fra forsiden til spill, guider, rangering og registrering. Spilte Slangen, Tallkombo, Puslespill, Blokksprenging, Fruktfusjon, Papirkomet og Boblekanonen. |
| Innlogget bruker og admin | **Ikke testet i nettleseren.** Det finnes ingen testkonto, og oppgaven tillot ikke ekte passord. Flytene er vurdert fra koden. `admin.html` sender en utlogget besøkende til `login.html`, og alle admin-RPC-er sjekker `is_admin()` på serveren. |
| Målinger | Lighthouse 13.5, mobilprofil, mot `http://localhost:8000` (Python `http.server` uten komprimering). Tekstfiler blir derfor større enn i produksjon, men bildene, som er det største problemet, påvirkes ikke. |
| Bruksdata | Lest fra Supabase med SELECT: `profiles`, `game_records`, `guest_game_plays`, `site_visits`, `guides`, `direct_messages`, `user_codes`, `rewards`, `games` og `levels`. Ingen personopplysninger er tatt med her, bare tall. Umami-dataene var ikke tilgjengelige (ingen API-tilgang), og AdSense-status og -inntekt var heller ikke tilgjengelige. |
| Sikkerhetsrådgiver | Supabase Security Advisor er lest i sin helhet (1 feil, 5 + 75 + 74 + 1 advarsler, 2 informasjonspunkter). |
| Begrensning | Nettleserpanelet var skjult under testen, så animasjonene kan ha vært strupet. FPS er derfor ikke målt på nytt (se Fruktfusjon under D15). Touch-hendelser kunne ikke sendes, bare mus og tastatur. Touch er derfor vurdert fra koden. `tip.html` ble ikke åpnet i nettleseren, fordi hver visning skriver til `guides.view_count` i produksjon. |

**Bruksdata (per 26.10.2026)**

| Mål | Verdi |
|---|---|
| Kontoer | 106, hvorav 96 opprettet siste 30 dager og 41 siste 7 dager |
| Spilte runder siste 30 dager | 2 417 innlogget (79 spillere) + 5 137 som gjest |
| Når det spilles | 92 % av gjesterundene skjer på hverdager kl. 08–16 (4 923 av 5 327). Helgene er nesten tomme (f.eks. 27 og 78 runder 24.–25.10 mot 1 061 mandag 19.10). |
| Runder per spill, 30 dager (innlogget + gjest) | Slangen 3 413 · Tallkombo 1 333 · Puslespill 966 · Blokksprenging 645 · Fruktfusjon 545 · Papirkomet 249 · Boblekanonen 82 · (skjult: Minesveiper 311, Fire på rad 3) |
| Retur (bare innloggede) | 31 av 46 spillere som startet for minst 7 dager siden, spilte igjen innen 7 dager (67 %). 49 av 84 har spilt på 2 eller flere dager. Bare 3 har en dagsrekke på 2 eller mer nå. |
| Guidevisninger (totalt, all tid) | 245 på 7 guider (Nynorsk-oversetter 122, Mal norsk/nynorsk 51, P-matte 28, Elevråd 27, Standpunktklage 11, Lærer 6, Ungdomsråd 0) |
| Besøksmåling i `site_visits` | 21 rader fra 4 unike besøkende siden 05.09.2026. Den teller bare besøkende som har godtatt statistikk-cookies, så tallet er i praksis ubrukelig. |
| Sosialt | 290 direktemeldinger fra 24 avsendere (53 av dem til admin), 53 gruppemeldinger, 76 venne-/følgerader, 0 blokkeringer |
| Belønninger | 72 rabattkoder tatt ut fra 13 rabatter og 12 merkevarer (flest Adidas og Domino's, men også Temu, Kron og HoneyGain). 3 klikk på «Bruk koden». 31 brukere på nivå 2 eller høyere. |

**Lighthouse, mobil (lokal server)**

| Side | Ytelse | Tilgjengelighet | Beste praksis | SEO | LCP | CLS | Total vekt |
|---|---|---|---|---|---|---|---|
| Forside | **35** | 90 | 100 | 100 | 29,0 s | **0,973** | **7,2 MB** |
| Spillside (Slangen) | 54 | 92 | 100 | 100 | 9,6 s | 0 | 1,0 MB |
| Tips | **41** | 92 | 100 | 100 | 8,2 s | **0,919** | **7,3 MB** |
| Rangering | 55 | 92 | 96 | 100 | 14,0 s | 0 | 5,3 MB |
| Logg inn | 64 | 88 | 100 | 66* | 6,3 s | 0,196 | 0,8 MB |

\* SEO 66 på innlogging skyldes `Disallow: /login.html` i `robots.txt`. Det er et bevisst valg.

De tyngste ressursene på forsiden er spillbildene fra Supabase Storage: `block-blast` 1 539 KiB, `2048` 1 505 KiB, `snake` 1 425 KiB og `tetris` 910 KiB (alle PNG). På tips-siden er det guidebildene: 2 692 KiB, 1 827 KiB og 1 673 KiB. `ADSENSE_AUDIT.md` (20.10) oppga 200–550 KB per bilde. Bildene er altså blitt tyngre siden da.

### 3.2 Vurdering per dimensjon

Karakter 1–5 som definert i steg 0.

#### D1 – Første besøk og forståelse (2/5)

**Fungerer**
- «Start her» starter dagens spill rett i heltefeltet, uten sidelasting (`js/main.js`, `startHeroGame`).
- Cookie-linjen ligger nederst og har tre likestilte valg (Tilpass / Avvis alle / Godta alle). Siden er brukbar mens linjen vises. Sett på både 375 px og 1366 px.

**Fungerer ikke**
- H1 er «Hellu:) Hyggelig å se deg!» (`index.html:38`) og sier ikke hva siden er. `VURDERING.md` nevner et tidligere verdiløfte («Nye triks hver dag») som H1. Det finnes nå bare i `<title>`.
- Første skjerm er et spill (dagens spill i full bredde). Utad skal siden være en ressursside (steg 1). Guidene kommer først etter hele spillrutenettet.
- På 375 px er navnet på dagens spill klippet bort øverst i heltekortet. Målt: kortet begynner på y = 92, H2 på y = 71 og slutter på y = 100, med `overflow: hidden` (`.hero-content` i `css/style.css:377` og `css/social.css:1137`). Det skjer når beskrivelsen er lang, som for Boblekanonen i dag.
- Toppmenyen for utloggede viser «NIVÅ 1 0/10000», «Logg inn med Google» og «Registrer deg» (`js/auth.js`). Ved ca. 1000 px CSS-bredde flyter `.header-right-group` ut av skjermen (`scrollWidth` 1157 mot 1009), og knappen «Registrer deg» havner utenfor. Det gir horisontal scroll på nettbrett og små bærbare.

#### D2 – Kjerneflyten (4/5)

**Fungerer**
- Ett klikk fra forsiden til spill (kort → `player.html?id=…`), og null klikk for dagens spill.
- Alt innhold fungerer uten konto. Gjesterekorder lagres lokalt (`js/game-runtime.js:85–91`), og en påbegynt runde gjenopptas etter omlasting (`savedState`, `js/game-runtime.js:38–80`).
- Game over-kortet har «Spill på nytt» med fokus, så Enter starter ny runde (sett i Slangen, Fruktfusjon og Papirkomet).
- Tips-siden lister seks guider og fire nedlastbare filer. Dokumentene i `documents/` er lenket (`tips.html`), slik `VURDERING.md` sa.

**Fungerer ikke**
- Det finnes ingen søk, og guidene er bare synlige via ett fremhevet kort nederst på forsiden og menypunktet «Tips».
- Hvis Supabase svarer tregt, venter forsiden i opptil 5 s før den bruker reservelisten (`js/games-data.js`, `timeout` 5000 ms). Dette er uendret siden `VURDERING.md`.
- Game over-kortet lenker ikke videre til et annet spill eller en guide. Knappen `data-game-over-next` er nå «Se rangering» (`js/game-runtime.js:297`).

#### D3 – Grunn til å komme tilbake (3/5)

**Fungerer**
- Dagens spill roterer automatisk (`js/games-data.js:116–145`).
- Dagsrekke med Oslo-tid (`schema.sql` seksjon 49), ukesrangering (seksjon 53), vennerangering og rangering per periode og spill (seksjon 57). Filtrene «Triks / Periode / Hvem» vises på `rangering.html`.
- Målt retur blant innloggede er høy: 67 % kom tilbake innen 7 dager.

**Fungerer ikke**
- Rotasjonen bruker UTC-døgn (`studillaDayIndex`, `js/games-data.js:130–132`). Dagens spill bytter derfor kl. 01/02 norsk tid, ikke ved midnatt. Dette er uendret siden `VURDERING.md`.
- Dagsrekken når nesten ingen. Bare 3 brukere har en rekke på 2 eller mer, selv om bruken er daglig på skoledager. **Antakelse:** Rekken ryker i helgene, når elevene ikke spiller.
- Nivåsystemet er skjevt. `point_rate` gjør at en snittrunde gir svært ulik uttelling: Slangen ≈ 70 poeng, Tallkombo ≈ 890, Puslespill ≈ 3 400 og Boblekanonen ≈ 4 900. Det mest spilte spillet gir minst, og nivå 2 krever 10 000 poeng, som er rundt 140 Slangen-runder.
- Retur blant gjester kan ikke måles (se D14).

#### D4 – Konto, profil og sosiale funksjoner (3/5)

**Fungerer**
- Brukernavn og passord uten e-post, eller Google (`js/auth.js:16–31`, `login.html`).
- Venneforespørsler med godkjenning (`schema.sql` seksjon 58), grupper bare med venner (`add_group_members`, seksjon 60), blokkering, sletting av egen konto (`delete_own_account`), og varsel til admin ved blokkering (seksjon 62).

**Fungerer ikke**
- Det finnes ingen måte å få tilbake kontoen hvis man glemmer passordet. `tilbakestill-passord.html:84–117` venter på en e-postlenke fra Supabase, men kontoene har bare en intern adresse (`@brukere.studilla.no`). Dette er uendret siden `VURDERING.md`.
- Hvem som helst med konto kan sende melding til hvem som helst. `dm_from_followers_only` er `false` som standard (`schema.sql:2863`), og innstillingen finnes ikke i grensesnittet (søk i `*.html` og `js/` gir ingen treff).
- Alle spillere kan søkes opp offentlig på `rangering.html` («Søk etter en spiller», også for utloggede, via viewet `profiles_public`).
- Meldinger kan ikke rapporteres. Man kan bare blokkere.

#### D5 – Mobil og touch (3/5)

**Fungerer**
- Ingen horisontal scroll på 375 px (`scrollWidth` 375). Menyen er en hamburgermeny.
- Spillflaten fyller bredden (Slangen og Tallkombo 359 × 359, Blokksprenging 359 × 461, Fruktfusjon 359 × 449). Puslespill har skjermknapper (Venstre/Roter/Høyre/Ned, med `aria-label`). Blokksprenging løfter brikken over fingeren (`offsetY`, `game-blokksprenging.js:393`).

**Fungerer ikke**
- Dagens spill klippes på 375 px, og menyen flyter over ved ca. 1000 px (D1).
- Boblekanonen i heltefeltet blir bare 302 × 266 px inne i en 580 px høy ramme på mobil, så boblene er svært små å sikte på.
- `touch-action` er `auto` på spillflaten. Slangen registrerer sveip først når fingeren slippes (`touchend`, `game-slangen.js:338`).
- Lenkene i bunnmenyen er 21 px høye (Kontakt/Personvern/Vilkår), under anbefalt trykkflate.

#### D6 – Ytelse og lastetid (1/5)

**Fungerer**
- Cache-busting med innholdshash (`build/build.mjs`).
- Spillmoduler og Matter.js lastes bare for det spillet som åpnes (`player.html`, `MODULE_BY_ID`/`EXTRA_SCRIPTS_BY_ID`).
- Bilder i rutenettet har `loading="lazy"` (`js/main.js:17`).

**Fungerer ikke**
- Ytelsesscore 35–64 i Lighthouse mobil. Forsiden er på **7,2 MB** og tips-siden på **7,3 MB**, nesten bare på grunn av PNG-bilder på 0,9–2,7 MB fra Supabase Storage (3.1). Det gir LCP på 29 s (simulert mobilnett) og belaster også egress-kvoten i Supabase.
- CLS 0,97 på forsiden og 0,92 på tips-siden. Heltefeltet, rutenettet og guidekortet settes inn av JavaScript etter Supabase-kallet og dytter innholdet nedover.
- Fire stilark og Google Fonts blokkerer rendering. `supabase.js` (207 KiB ukomprimert) lastes på alle sider. AdSense laster ca. 230 KiB også på spillsidene.

#### D7 – SEO og synlighet (2/5)

**Fungerer**
- Ingen «spill», «game» eller «play» i `<title>`, meta, H1/H2, alt-tekst eller JSON-LD i de bygde sidene (søk i `dist/*.html`). Spill kalles «triks» utad, i tråd med `CLAUDE.md`.
- Unike titler på de fleste sidene, `robots.txt` med sitemap, `noindex` på private sider, JSON-LD `WebSite` på forsiden og Lighthouse SEO 100 på de offentlige sidene. Menyen ligger i HTML-kilden (byggesteget).

**Fungerer ikke**
- `sitemap.xml` lister ni spillsider (`player.html?id=…`), også de to skjulte spillene, men **ingen guider**. Det er det motsatte av formålet og SEO-kravet: Søkemotorene blir pekt mot spillene, ikke mot ressursene.
- `player.html` har samme statiske tittel («Studilla · Dagens triks») og beskrivelse for alle spill: «… tjen poeng du kan bytte inn i rabattkoder» (`player.html:6–7`). Den har heller ingen H1.
- `tip.html` har bare den generelle tittelen «Studilla · Guide» i HTML-en og to `<h1>`. Guideinnholdet rendres bare med JavaScript.
- Ingen side har `rel="canonical"`, og `?id=`-URL-ene kan derfor indekseres i flere varianter.
- Beskrivelsen av `tips.html` handler om å «tjene og spare mer penger … rett fra møtet», mens innholdet stort sett er norsk, nynorsk og matte.
- Spillbeskrivelser som rendres med JavaScript, som «det klassiske puslespillet», blir også indeksert av Google, som kjører JS. SEO-kravet gjelder strengt tatt HTML-en, men effekten er den samme.

#### D8 – Tilgjengelighet (3/5)

**Fungerer**
- Skip-lenke (`js/layout-markup.js`), `:focus-visible`, global `prefers-reduced-motion`, `role="dialog"` og `aria-modal` på game over-kortet og dialogene, etiketter på søkefelt, og `aria-label` på Puslespill-knappene. Lighthouse tilgjengelighet 88–92.

**Fungerer ikke**
- Logolenken har ikke noe tilgjengelig navn på mobil, fordi teksten skjules og bildet har `alt=""` (Lighthouse `link-name` på alle sider).
- Overskriftsrekkefølgen hopper fra H1 til H3 (`.game-title`). Lenker i løpende tekst skilles bare med farge, og finskriften på innloggingssiden har for lav kontrast.
- Tre av de sju synlige spillene kan ikke spilles med tastatur: Blokksprenging, Fruktfusjon og Boblekanonen har ingen `keydown`-håndtering (`grep` i `js/games/`).
- Ingen spill kan pauses (D15).

#### D9 – Sikkerhet og personvern (3/5)

**Fungerer**
- RLS er slått på for alle 27 tabellene i `schema.sql`. Admin håndheves på serveren via `is_admin()` (`schema.sql:102–113`), i minst 10 admin-RPC-er og i RLS-policyene (f.eks. `games_admin_write`).
- Triggeren `guard_privileged_profile_fields` hindrer brukere i å endre `is_admin`, `xp`, `level` og rekkefeltene.
- Poeng gis bare av serveren: `submit_game_score` (`schema.sql:2017–2137`) har tak og fartsgrense, og direkte `insert` i `game_records` er stengt (`schema.sql:2188`). Meldinger går via RPC med blokkering og fartsgrense.
- Meldingstekst escapes før visning (`esc()` i `meldinger.html:790`), og vedleggslenker bygges med `encodeURIComponent`.

**Fungerer ikke**
- Security Advisor: **1 feil.** `profiles_public` er et SECURITY DEFINER-view. Det er bevisst, men det gjør at alle profiler kan leses av alle.
- **75 SECURITY DEFINER-funksjoner kan kjøres av `anon`**, også `admin_delete_user` og `add_points`. `revoke … from public` fjerner ikke Supabase sin standardtilgang for `anon`. I dag stoppes dette av sjekkene inne i funksjonene (`auth.uid()` / `is_admin()`), men det finnes ikke noe ekstra lag hvis én funksjon mangler sjekken.
- 5 funksjoner har ikke låst `search_path`, og beskyttelse mot lekkede passord er slått av.
- To backup-tabeller med personopplysninger ligger i `public`: `backup_profiles_20261013` og `backup_game_records_20261013` (RLS på, ingen policy).
- `guest_game_plays` tar imot innsetting fra hvem som helst, uten fartsgrense (`with check (true)`, `schema.sql:1656–1658`). Statistikken kan derfor fylles med falske tall.
- Samtykke: AdSense og Umami lastes fast i `<head>` før noe valg (`build/partials/head.html:28–31`). Sidens eget banner styrer bare Google Consent Mode og Supabase-besøksmålingen, mens AdSense skal håndteres av Googles CMP. Brukeren møter altså to ulike samtykkeløsninger. **Antakelse:** Googles CMP er satt opp i AdSense. Det kunne ikke verifiseres på localhost. `ADSENSE_AUDIT.md` sier bare at den bør settes opp.

#### D10 – Inntekter (2/5)

**Fungerer**
- `ads.txt` er riktig (`google.com, pub-8465850027811409, DIRECT, f08c47fec0942fa0`). AdSense-taggen ligger i felles head (commit `9ce8898`).
- Om-, kontakt- (nå med e-post), personvern- og vilkårssidene finnes. `STUDILLA_ADS.adtest` er forberedt.

**Fungerer ikke**
- Automatiske annonser er på overalt, også på spillsidene, der fingre og mus er i full aktivitet nær spillflaten. Det gir risiko for utilsiktede klikk og «ugyldig trafikk».
- Lite innhold med søkeverdi: seks synlige guider, og ingen av dem i sitemapen.
- Målgruppen er elever, men det er ikke gjort noe for at annonser skal tilpasses mindreårige (f.eks. ikke-personaliserte annonser som standard). **Antakelse:** AdSense er ikke godkjent ennå. Det finnes ingen manuelle annonseenheter, og taggen ble lagt fast i head i dag (`9ce8898`, 26.10), etter at den 21.10 var gjort avhengig av samtykke (`e34de9a`). Løsningen er altså i bevegelse.
- Ytelsen (D6) trekker både rangering og annonseinntekt ned.

#### D11 – Vedlikeholdbarhet for én utvikler (3/5)

**Fungerer**
- Én mal per innholdstype: `player.html?id=` og `tip.html?id=`. Spill og guider er data i `games` og `guides`.
- Byggesteget er lite og forståelig (231 linjer), med kontroll av manglende filer. GitHub Actions publiserer `dist/`. Funksjonsbryter i `js/feature-flags.js`. Kommentarene i koden er grundige og forklarer hvorfor.

**Fungerer ikke**
- Databasen er én fil på 5 123 linjer med 74 seksjoner som kjøres på nytt fra topp til bunn. Det finnes ingen migrasjoner, seksjonsnummeret «36» er brukt to ganger, og det ligger ett-gangs-oppdateringer inne (f.eks. `update … set game_id = 'papirkomet' where game_id = 'flappy'`).
- Ingen automatiske tester av spill eller database.
- Store enkeltfiler: `js/admin.js` 2 969 linjer, `css/style.css` 2 994, `js/guides.js` 1 851.
- Hvert spill har sin egen løkke og input-håndtering, noen med `setInterval` og noen med `requestAnimationFrame`, og ingen felles pause. Spesialtilfellet `fruktfusjon` → `game-fruit-merge.js` er hardkodet to steder (`player.html` og `js/main.js`). En gammel reservevei til `add_points` ligger igjen i `js/game-runtime.js:168–172`.
- Rot i rotmappen: 11 `.dc.html`-designfiler, `2048Cover` (1,4 MB uten filendelse), en zip og en PNG. Disse kopieres ikke til `dist/`.

#### D12 – Læringsinnhold og nytteverdi (2/5)

**Fungerer**
- Guidene er konkrete og nyttige for målgruppen: Nynorsk-oversetter (122 visninger), maler til norsk og nynorsk, P-matte-snarveier og klage på standpunktkarakter. Fire nedlastbare dokumenter, og et fullt redigeringssystem i admin.

**Fungerer ikke**
- Nytten blir lite brukt: 245 guidevisninger totalt mot rundt 7 500 spilte runder bare siste 30 dager.
- Guidene står ikke i sitemapen (D7) og har ingen kobling fra spillflyten (D2).
- Temaene spriker (elevråd og penger, lov, klage, nynorsk, matte), og tips-siden presenteres som «tjene og spare mer».

#### D13 – Trygghet for unge brukere (2/5)

**Fungerer**
- Blokkering, grupper bare med venner, venneforespørsler som må godtas, fartsgrenser på meldinger, varsel til admin ved blokkering, og en global bryter for meldinger (`app_settings.dm_enabled`).

**Fungerer ikke**
- Aldersgrensen er 16 år (`vilkar.html:42`, avkrysning i `login.html:63`), men målgruppen er elever, og bruken skjer i skoletiden. **Antakelse:** En betydelig andel er under 16. De må da krysse av for noe som ikke stemmer. Den som velger «Fortsett med Google», blir aldri spurt om alder.
- Meldinger fra fremmede er åpne som standard, alle kan søkes opp offentlig, og meldinger kan ikke rapporteres (D4).
- Kasser med «sjeldenhet», lykkehjul og «sjansen bygges opp» (`schema.sql` seksjon 27, 30, 44 og 67) deler ut rabattkoder fra kommersielle merkevarer, blant annet Temu, HoneyGain (app som deler nettverkstilkobling mot betaling) og Kron (investeringsapp). Dette er spillmekanikk av loot box-typen og markedsføring rettet mot en ung målgruppe. **Antakelse:** Dette bør vurderes opp mot markedsføringsloven og Forbrukertilsynets veiledning om markedsføring mot barn. Det er ikke en juridisk vurdering.
- Meldinger lagres så lenge kontoen finnes (`personvern.html:37`), uten sletting etter en viss tid.

#### D14 – Måling og læring (2/5)

**Fungerer**
- `game_records` og `guest_game_plays` gir volum per spill, time og dag. `guides.view_count` teller guidevisninger. Adminpanelet viser statistikk per spill (`js/admin.js`). Umami (uten cookies) er på alle sider.

**Fungerer ikke**
- «Aktive personer i dag» bygger på `site_visits`, som krever samtykke til statistikk. Resultatet er 21 rader fra 4 besøkende på 7 uker, så tallet er misvisende.
- Det finnes ingen hendelser for «startet, men ikke fullført», hvor lenge en runde varer, restart eller feil. Retur blant gjester kan ikke måles.
- Umami har ikke `data-domains`, så lokale utviklingsbesøk telles som ekte trafikk (`build/partials/head.html:28`). Data fra Umami og AdSense manglet i denne evalueringen.

#### D15 – Spillkvalitet for brukeren (3/5)

**Fungerer**
- Sju synlige spill med egen visuell identitet. Alle lastet og kunne spilles uten konsollfeil.
- Felles game over-kort med poeng, rekord og «Spill på nytt» (fokus, Enter), «Utfordre en venn» og en tydelig melding om at rekorden bare ligger lokalt for gjester. Påbegynte runder gjenopptas.
- Gode detaljer i flere spill: Puslespill har skyggebrikke, «Neste»-forhåndsvisning og skjermknapper. Papirkomet har tydelig startskjerm («Trykk for å fly»). Blokksprenging løfter brikken over fingeren. Fruktfusjon har lyd med av/på-bryter.
- Bruken bekrefter at spillene treffer: Slangen hadde 3 413 runder på 30 dager, og median-runden i Tallkombo gir 7 700 poeng.

**Fungerer ikke**
- **Slangen starter bare på «høyre».** Pil opp, ned og venstre ignoreres stille til spilleren trykker eller sveiper høyre (`game-slangen.js:38–41` og `302–309`). «Hvordan spille» sier ikke dette (`js/game-howto.js:43–49`). Sett i testen: pil opp gjorde ingenting. Dette er det mest spilte spillet.
- **Ingen pause.** Ingen spill og heller ikke `game-runtime.js` lytter på `visibilitychange` eller `blur`, og det finnes ingen pauseknapp. En elev som bytter fane i timen, kommer tilbake til en tapt runde. Papirkomet begrenser tidssteget slik at fanebytte ikke gir et hopp (`game-papirkomet.js:416`), men har heller ingen pause.
- **Fruktfusjon kan ende for tidlig.** Faregrensen måles i veggklokketid (`Date.now()`, `game-fruit-merge.js:441–456`), mens fysikken går i `requestAnimationFrame`-takt (Matter.Runner). Når bildene strupes, får en frukt i fall ikke passert grensen innen 1 s målt i veggklokketid. I testen, der panelet var skjult, ble resultatet «Krukken rant over!» med 0 poeng etter to frukter. **Antakelse:** På vanlige maskiner skjer dette sjelden (median-runden er 1 538 poeng), men det kan skje på trege skole-PC-er og ved bytte av fane.
- Tre spill kan ikke spilles med tastatur (D8).
- Ujevn poengøkonomi mellom spillene (D3).
- Puslespill har median-skår 102 mot snitt 1 139. Mange runder ender altså nesten med en gang. **Antakelse:** Navnet «Puslespill» (som på norsk betyr puslespill med brikker) gir feil forventning til et spill med fallende klosser, og starten kan være for brå.
- Boblekanonen har lavest engasjement (82 runder på 30 dager) og blir liten på mobil.
- Ingen felles vanskelighetskurve og ingen spillspesifikk statistikk for frafall.

### 3.3 Etterprøving av tidligere vurderinger

| Funn i `VURDERING.md` / `ADSENSE_AUDIT.md` | Status i dag | Belegg |
|---|---|---|
| Rekorder kunne forfalskes med `add_points` | **Rettet.** Poeng gis bare via `submit_game_score`, og `add_points` er trukket tilbake fra `authenticated`. Men `anon` kan fortsatt kjøre funksjonen (stoppes av `auth.uid()`). | `schema.sql:2017–2193`, Security Advisor |
| Ingen retensjonsløkke | **Delvis rettet.** Dagsrekke, ukesrangering og vennerangering finnes, men nesten ingen har en rekke. | `schema.sql` seksjon 49 og 53, bruksdata |
| Verdiløfte som H1 | **Gått tilbake.** H1 er nå «Hellu:) Hyggelig å se deg!». | `index.html:38` |
| Cookie-valg likestilt | **Bekreftet.** | Nettleser, `js/cookie-banner.js` |
| Ingen gjenoppretting av passord | **Uendret.** | `tilbakestill-passord.html:84–117` |
| 5 s tidsavbrudd ved treg Supabase | **Uendret.** | `js/games-data.js` |
| Nivåsystemet er av | **Utdatert.** Det er slått på igjen (commit `f1ea0d7`). | `js/feature-flags.js:12` |
| `premier.html` fjernet | **Bekreftet**, men kasser og koder vises fortsatt på profilen. | `profil.html:294` |
| Dokumentene i `documents/` ikke lenket | **Rettet.** | `tips.html` (nettleser) |
| Rangeringen kuttet på 1 000 rader | **Rettet** (`leaderboard_totals`). | `schema.sql` seksjon 55 |
| Rot i rotmappen | **Uendret.** | `ls` |
| Kontrast «ikke et problem» | **Stort sett riktig**, men Lighthouse finner lav kontrast i finskrift. | Lighthouse logg inn og rangering |
| Ytelse «ikke et problem» (fps) | Ikke målt på nytt. **Lastetiden er et stort problem**, og bildene er tyngre enn i `ADSENSE_AUDIT.md` (0,9–2,7 MB mot 200–550 KB). | Lighthouse |
| Game over lenker til neste spill | **Endret.** Lenken går nå til «Se rangering». | `js/game-runtime.js:297` |
| Kontakt via e-post mangler | **Rettet.** | `kontakt.html:35` |
| CMP må settes opp i AdSense | **Kan ikke verifiseres.** | `build/partials/head.html` |
| UTC-rotasjon av dagens spill | **Uendret.** | `js/games-data.js:130` |


---

## Steg 4 – Gap og tiltak

### 4.1 Gaptabell

Tallet i parentes er karakteren fra steg 3. «Gap» går begge veier: ↑ betyr at dagens løsning er like god som eller bedre enn anbefalingen.

| Dim. | Anbefalt løsning (steg 2) | Dagens løsning (steg 3) | Gap |
|---|---|---|---|
| D1 Første besøk | H1 med verdiløfte for skolehverdagen, søk først, «I dag»-kort med tips og pause, ingen popup-kø | (2) H1 «Hellu:)», spillet først, spillnavnet klippes på 375 px, menyen flyter over ved ~1000 px, likestilt cookie-linje | Mangler verdiløfte og ressursene først. ↑ Start rett i heltefeltet gir verdi raskere enn anbefalingens lenke til en egen pauseside. |
| D2 Kjerneflyt | Ett klikk, søk, «Neste pause» og relatert guide etter runden | (4) Ett eller null klikk, ingen konto, runden gjenopptas, ingen søk eller kobling videre | Mangler søk og kobling fra spill til guide. ↑ Gjenopptak av runden etter omlasting er like godt som anbefalingens «Fortsett der du slapp». |
| D3 Retensjon | Felles dagsfrø, dagsrekke med fridag, ukeliste, ingen belønningsøkonomi | (3) Rotasjon i UTC, dagsrekke uten fridager (3 med rekke), uke-, venne- og periodelister, nivåer og kasser, 67 % retur blant innloggede | Oslo-tid, fridager i helgen og poengbalanse mangler. ↑ Vennerangering og periodefiltre går lenger enn anbefalingen. |
| D4 Konto og sosialt | Konto valgfri, 13+, gjenopprettingskode, venner bare via eksakt brukernavn, ingen brukerkatalog | (3) Brukernavn/passord eller Google, venneforespørsler, grupper, ingen gjenoppretting, offentlig søk etter spillere | Gjenoppretting mangler, og det offentlige søket bør strammes inn. ↑ Google-innlogging og gruppechat gir lavere terskel enn anbefalingen (men mer risiko, se D13). |
| D5 Mobil og touch | Felles skalering, `touch-action: none` på flaten, 44 px trykkflater, kontroller i tommelsonen | (3) Ingen horisontal scroll på 375 px, brett i full bredde, skjermknapper i Puslespill, men klipping, overflyt og små lenker | Små feil i CSS. ↑ DOM-brettene skalerer skarpt, like godt som anbefalingens canvas-skalering. |
| D6 Ytelse | Under 100 kB før annonser, forhåndsrendret tekst-LCP, annonser etter samtykke | (1) 7,2 MB forside, LCP 29 s, CLS 0,97, fire blokkerende stilark | Størst gap. Bildene alene står for over 80 % av vekten. |
| D7 SEO | Bare guider indeksert, spill `noindex`, kanonisk URL, `Article`-JSON-LD, byggelint | (2) Ingen spillord i SEO-felt, men sitemapen peker på spill, ingen guider, ingen kanonisk URL, generisk tittel på guider | Sitemapen må snus, spillsidene `noindex`, og guidene trenger metadata i HTML. ↑ «Triks» oppfyller SEO-kravet like godt som «pause». |
| D8 Tilgjengelighet | WCAG AA, alle spill med tastatur, `aria-live`, valg av lavere tempo | (3) Skip-lenke, fokus og redusert bevegelse er på plass. Tre spill uten tastatur, logolenke uten navn | Tastatur i spillene og små rettinger. ↑ Grunnmuren er på nivå med anbefalingen. |
| D9 Sikkerhet og personvern | RLS-sjekk i CI, `search_path=''`, all skriving via RPC, TCF-CMP, ingen tredjepart før samtykke, sletting etter 90 dager | (3) RLS overalt, admin og poeng håndhevet på serveren. `anon` kan kjøre 75 SECURITY DEFINER-funksjoner, backup-tabeller ligger i `public`, to samtykkeløsninger, ingen sletting etter en viss tid | Herding og samtykke må ryddes. ↑ Poeng- og admin-modellen på serveren er like god som anbefalingen. |
| D10 Inntekter | Manuelle enheter bare på innholdssider, ikke på pauser, minst 25 guider før søknad, ikke-personalisert som standard | (2) Automatiske annonser overalt, også i spill, seks guider. `ads.txt` og domene er på plass | Plassering og innhold mangler. ↑ Domene og `ads.txt` er allerede ordnet. |
| D11 Vedlikehold | Migrasjoner, tester, nattbygg, kjøretid med grensesnitt, flagg i databasen | (3) Én mal per type, lite bygg, flagg i JS, én SQL-fil på 5 123 linjer, ingen tester | Migrasjoner og noen tester mangler. ↑ Dagens bygg på 231 linjer er enklere å eie for én person enn anbefalingens. |
| D12 Læringsinnhold | Fast guidemal med «Kort svar», 25 guider, gjennomgangsdato, «Var dette nyttig?» | (2) Seks synlige guider, rikt redigeringssystem (moduler, tabeller, filer, avstemning), 245 visninger totalt | Mengde, synlighet og kobling til spillene mangler. ↑ Redigeringsverktøyet er bedre enn anbefalingens Markdown. |
| D13 Trygghet for unge | 13+, meldinger med opt-in og bare mellom venner, rapportering, ingen belønningsøkonomi | (2) 16+ mot en elevmålgruppe, meldinger fra alle som standard, ingen rapportering, kasser med merkevarekoder | Stort gap. ↑ Blokkering og grupper bare med venner er på plass. |
| D14 Måling | Egne hendelser, dashbord med M1–M4, ukentlig rutine | (2) Volum per spill og time (avslørte skolebruken), `site_visits` ubrukelig, ingen hendelser for start, avbrudd og retur | Hendelser og gjesteretur mangler. ↑ Gjesterunder per time er et godt grunnlag. |
| D15 Spillkvalitet | Felles kjøretid med fast tidssteg, pause, abstrakt input, sjekkliste, replay-tester, statistikk per spill | (3) Felles game over, rekord og gjenopptak, sterk identitet per spill. Ingen pause, ujevn input, Slangen-start, Fruktfusjon-timer, skjev poengbalanse | Pause, input og en sjekkliste trengs. Full omskriving er ikke nødvendig. ↑ Spillenes særpreg og detaljer er bedre enn en generisk motor ville gitt. |

### 4.2 Tiltaksliste

Effekt: høy, middels eller lav, med målet fra steg 1 (M1–M8) i parentes. Innsats: S (inntil en dag), M (2–5 dager), L (mer enn en uke eller løpende arbeid).

| # | Tiltak | Filer | Effekt (mål) | Innsats | Risiko og avhengigheter |
|---|---|---|---|---|---|
| T1 | **Lettere bilder og reservert plass.** Skaler og konverter spill- og guidebilder til WebP med maks ca. 800 px bredde og under 150 KB, gjort i nettleseren før opplasting i admin. Last opp de eksisterende på nytt. Gi heltefelt, kort og guidekort fast `aspect-ratio`, og bruk `fetchpriority` og `width`/`height`. | `js/admin.js` (opplasting), `js/guides.js`, `js/main.js`, `css/style.css`, bilder i Supabase Storage | Høy (M6, M2, M5) | S–M | Lav. De gamle bildene må lastes opp på nytt manuelt. Bildetransformasjon i Supabase er ikke forutsatt. |
| T2 | **Mobil- og menyfeil.** La heltekortet vokse med innholdet på smale skjermer, så spillnavnet ikke klippes. Skjul nivåmåleren for utloggede, eller gjør Google-knappen til et ikon under ~1100 px. Gi logolenken `aria-label`. Gjør bunnlenkene minst 44 px høye. | `css/style.css` (`.hero-content`, `.header-right-group`), `css/social.css`, `js/layout-markup.js` | Middels (M2, M6) | S | Lav |
| T3 | **Slangen starter på alle retninger.** Godta alle retninger unntatt rett inn i halen som start, og vis «Trykk en piltast eller sveip for å starte» over brettet. Oppdater «Hvordan spille». | `js/games/game-slangen.js`, `js/game-howto.js` | Høy (M1, M2). Det mest spilte spillet. | S | Lav |
| T4 | **Pause ved fanebytte.** Legg til `session.onPause/onResume` i den felles kjøretiden, utløst av `visibilitychange` og `blur`, med en pauseknapp i topplinjen og P/Esc. Hvert spill stopper sin egen løkke (`setInterval`, rAF eller Matter.Runner). | `js/game-runtime.js`, `player.html`, alle `js/games/*.js` | Høy (M1) | M | Middels: berører alle spill. Test ett spill om gangen. |
| T5 | **Faregrensen i Fruktfusjon i fysikktid.** Mål tiden over linjen med `engine.timing.timestamp` eller summert `delta`, ikke `Date.now()`. Stopp Runner når siden er skjult (henger sammen med T4). | `js/games/game-fruit-merge.js` | Middels (M1) | S | Lav |
| T6 | **Tastatur i tre spill.** Blokksprenging: tall eller Tab velger brikke, piltaster flytter markøren, Enter plasserer. Fruktfusjon: piltaster flytter og mellomrom slipper. Boblekanonen: piltaster sikter og mellomrom skyter. | `js/games/game-blokksprenging.js`, `game-fruit-merge.js`, `game-boblekanonen.js`, `js/game-howto.js` | Middels (M6, D8) | M | Lav |
| T7 | **Poengbalanse.** Sett `point_rate` slik at en median-runde gir omtrent like mange poeng i alle spill (se medianene i 3.1). Vurder om nivå 2 bør komme tidligere. | Adminpanelet (data), ev. `schema.sql` | Middels (M1) | S | Middels: sjekk om seksjon 66 regner om `score` bakover med ny rate (`schema.sql:4342`). Si ifra til spillerne hvis rangeringen endres. |
| T8 | **SEO i tråd med formålet.** Sitemapen skal liste forsiden, tips-siden og hver synlige guide (`tip.html?id=…`), og ingen spillsider. Gi `player.html` `noindex` og en nøytral beskrivelse uten «rabattkoder». Legg til `rel="canonical"`. Gi `tip.html` én H1, og la bygget skrive tittel og beskrivelse per guide, eller i det minste sette dem tidlig i JS. Gi forsiden en H1 som sier hva siden er. Rett beskrivelsen av `tips.html`. | `sitemap.xml` (ev. generert i `build/build.mjs`), `player.html`, `tip.html`, `index.html`, `tips.html` | Høy (M3, SEO-kravet) | S–M | Lav. `noindex` på spill er i tråd med `CLAUDE.md`. Et generert sitemap krever Supabase-kall under bygget. |
| T9 | **Trygghet i meldinger og alder.** (a) Meldinger bare mellom venner som standard (`are_friends` i `send_direct_message`), med valget i innstillingene. (b) «Rapporter» på meldinger og profiler, som legger saken i `admin_notifications` (ny `kind`). (c) Fjern det offentlige spillersøket for utloggede. (d) Avklar aldersgrensen: enten 13 år med vilkår tilpasset det, eller 16 år håndhevet også ved Google-innlogging. Vilkårene, påloggingen og målgruppen må si det samme. (e) Slett meldinger etter en fast periode (f.eks. 12 måneder). | `supabase/schema.sql` (ny seksjon), `meldinger.html`, `innstillinger.html`, `rangering.html`, `login.html`, `vilkar.html`, `personvern.html` | Høy (M7) | M | Middels: færre meldinger og litt mer friksjon. Krever databaseendring. Aldersvalget er en eiervurdering. |
| T10 | **Kasser og rabattkoder.** Skru av med den eksisterende bryteren (`levelsEnabled: false`) til ordningen er vurdert. Hvis den skal tilbake: faste belønninger per nivå i stedet for tilfeldige kasser, ingen merkevarer som er upassende for mindreårige (f.eks. Temu, HoneyGain, Kron), og tydelig merking som reklame. | `js/feature-flags.js`, rabattdata i adminpanelet | Høy (M7, M5) | S (bryter) / M (omlegging) | Middels: 31 brukere på nivå 2 eller høyere mister en synlig gulrot. **Antakelse:** Det finnes ingen avtaler med merkevarene som krever at kodene vises. |
| T11 | **Herding av databasen.** Trekk tilbake `EXECUTE` fra `anon` på alle SECURITY DEFINER-funksjoner, bortsett fra en eksplisitt liste (f.eks. `guide_add_view`, `guide_vote_poll`, `follow_stats`, `weekly_leaderboard`, `user_codes_count` og rangeringsfunksjonene). Sett `search_path` på de fem funksjonene. Slett backup-tabellene etter kontroll. Flytt gjesterunder til en RPC som sjekker spill-ID og tak. Slå på beskyttelse mot lekkede passord. | `supabase/schema.sql` (ny seksjon), Supabase-dashbordet | Middels (M7) | S | Middels: en funksjon som mangler på listen, slutter å virke for utloggede. Test forside, rangering og tips utlogget etterpå. |
| T12 | **Én samtykkeløsning.** Bekreft at Googles CMP vises på studilla.no for EØS. La eget banner bare gjelde det Google-CMP-en ikke dekker, eller fjern det hvis Umami (uten cookies) er alt som er igjen. Sett annonser som ikke-personaliserte eller tilpasset mindreårige. | `build/partials/head.html`, `js/consent.js`, `js/cookie-banner.js`, `personvern.html`, AdSense-innstillinger | Middels (M5, M7) | S–M | Middels: juridisk vurdering av samtykke for mindreårige. |
| T13 | **Ingen annonser i spillene.** Unnta `player.html` fra automatiske annonser (sideunntak i AdSense, eller ikke last taggen der). Bruk manuelle enheter på `tips.html` og `tip.html`. | `build/partials/head.html` eller `build/build.mjs`, AdSense-kontoen | Middels (M5, D15) | S | Lav: noe færre visninger, men mindre risiko for ugyldig trafikk. |
| T14 | **Måling som svarer på målene.** Legg `data-domains="studilla.no"` på Umami. Send Umami-hendelser (`runde_start`, `runde_slutt` med varighet, `restart`, `guide_lest`, `nedlasting`). Erstatt «aktive i dag» fra `site_visits` med Umami eller en anonym dagsteller som ikke krever samtykke. | `build/partials/head.html`, `js/game-runtime.js`, `js/guides.js`, `js/admin.js` | Høy (M1–M4 blir målbare) | S | Lav. **Antakelse:** Umami uten cookies krever ikke samtykke. |
| T15 | **Dagens spill og dagsrekke for skoleuka.** Roter dagens spill etter Oslo-tid. La lørdag og søndag være fridager i dagsrekken. | `js/games-data.js`, `supabase/schema.sql` (seksjon 49, `touch_daily_streak`) | Middels (M1) | S | Lav |
| T16 | **Gjenoppretting av konto.** Vis en gjenopprettingskode én gang ved registrering (lagres som hash), og la en Edge Function bytte passord mot koden. Alternativt: tilbakestilling fra adminpanelet via Edge Function. | `login.html`, `tilbakestill-passord.html`, ny Supabase Edge Function, `schema.sql` | Middels (M4) | M | Middels: en ny driftsflate (Edge Function med service-nøkkel). |
| T17 | **Nytten fram i lyset.** Etter hver runde vises én relatert guide (`games.related_guide_id`). Guidekortet flyttes over spillrutenettet på forsiden. Målet er 20–25 guider om skolehverdagen, med «Kort svar» øverst. Søk på tips-siden. | `js/game-runtime.js`, `index.html`, `js/main.js`, `tips.html`, `js/guides.js`, innhold | Høy (M3, M5) | L (innhold) | Lav teknisk risiko. Krever jevn skrivetid. |
| T18 | **Spillenes navn og plass på mobil.** Vurder et mer treffende navn enn «Puslespill» for spillet med fallende klosser. Åpne canvas-spill (Boblekanonen) på spillsiden i stedet for i heltefeltet på mobil. | `games`-data (admin), `js/main.js` | Lav–middels (M2) | S | Lav. ID-en kan beholdes, så rekorder og lenker ikke brytes. |
| T19 | **Sporbar database og noen tester.** Fremover kommer nye databaseendringer som nummererte filer i `supabase/migrations/`, mens `schema.sql` holdes som øyeblikksbilde. Legg til `node --test` for ren spillogikk der det er enkelt (f.eks. sammenslåing i Tallkombo og radtømming i Puslespill). Fjern reserveveien til `add_points`. Samle `MODULE_BY_ID` på ett sted. Flytt `.dc.html`-filene og løse filer til `design/`. | `supabase/`, `js/game-runtime.js`, `player.html`, `js/main.js`, `package.json`, rotmappen | Middels (M8) | M | Lav–middels: overgangen til migrasjoner må gjøres nøye én gang. |
| T20 | **Felles spillstandard over tid.** Bygg ut kjøretiden til å eie input (taster, peker, sveip), pause, skalering og hendelser. Skriv en kvalitetssjekkliste per spill etter mønster fra steg 2 (D15), og ta spillene inn ett for ett, uten full omskriving. | `js/game-runtime.js`, `js/games/*.js` | Høy på sikt (M1, M6) | L | Middels: regresjoner i populære spill. Start med de minst spilte. |

### 4.3 Prioritering

**Raske gevinster** (S, middels til høy effekt): T1 bilder og plass · T2 mobil- og menyfeil · T3 Slangen-start · T5 Fruktfusjon-timer · T7 poengbalanse · T8 SEO og sitemap · T10 skru av kasser med bryteren · T11 databaseherding · T13 ingen annonser i spill · T14 måling · T15 Oslo-tid og fridager · T18 navn og plass på mobil

**Neste** (M): T4 pause · T6 tastatur i tre spill · T9 trygghet i meldinger og alder · T12 én samtykkeløsning · T16 gjenoppretting av konto · T19 migrasjoner og tester

**Større løft** (L): T17 innholdsløft for guidene · T20 felles spillstandard · eventuell omlegging av belønningssystemet (T10, del 2)

#### De fem tiltakene jeg ville gjort først

1. **T1 – Lettere bilder og reservert plass.** Dette er det største målbare gapet (ytelse 1/5). Bildene utgjør 6,2 av forsidens 7,2 MB. Med bilder på rundt 100 KB faller forsiden til omtrent 1–1,5 MB, og CLS-rettingen fjerner hoppingen. Bruken skjer på skolenett og telefoner, og det løfter både M6, M2 og AdSense. Innsatsen er liten, og risikoen nesten ingen.
2. **T9 – Trygghet i meldinger og alder.** Siden brukes av elever i skoletiden, men tillater meldinger fra fremmede, offentlig søk og har ingen rapportering. Å begrense meldinger til venner og legge inn rapportering lukker den mest alvorlige risikoen i D13. Aldersgrensen må samtidig avklares, fordi den styrer både vilkår, samtykke og annonser.
3. **T10 – Skru av kasser og rabattkoder med bryteren.** Det er én linje i `js/feature-flags.js` og fjerner tilfeldige belønninger med merkevarekoder rettet mot unge, inntil ordningen er vurdert. Prosjektet er bygget for nettopp dette («bygg for å kunne skru av»).
4. **T3 – Slangen starter på alle retninger.** Det mest spilte spillet (3 413 runder på 30 dager) ignorerer i dag alle taster unntatt «høyre» ved start, uten å si det. Det er en liten endring med stor virkning på førsteinntrykket, akkurat den spillkvaliteten eieren ba om å få vurdert.
5. **T4 – Pause ved fanebytte.** Når 92 % av bruken skjer i skoletiden, byttes det ofte fane, og i dag går runden tapt hver gang. En felles pause i kjøretiden er det enkelttiltaket som løfter flest spill samtidig. Det legger også grunnlaget for T20.

Rett etter disse kommer **T8 (SEO og sitemap)** og **T14 (måling)**. Begge er små, og de avgjør om ressursdelen av formålet (M3) kan nå fram og om fremgangen kan måles.

---

## Antakelser

| # | Antakelse | Hvor |
|---|---|---|
| A1 | Formålet er todelt: spillene er grunnen til å komme tilbake, og guidene er nytten og SEO-grunnlaget. | Steg 1 |
| A2 | Målgruppen er omtrent 13–19 år. Bruksdata (92 % på hverdager kl. 08–16) støtter at det er elever i skoletiden, men ikke alderen. | Steg 1, D13 |
| A3 | Suksessmålene M1–M8 og tersklene er satt av evaluator. Kildene gir ingen tall. | Steg 1 |
| A4 | Googles CMP er satt opp i AdSense. Det kunne ikke verifiseres lokalt. | D9, T12 |
| A5 | AdSense er ikke godkjent ennå. | D10 |
| A6 | Dagsrekkene ryker i helgene fordi bruken er knyttet til skoledager. | D3 |
| A7 | Falsk game over i Fruktfusjon skjer sjelden på vanlige maskiner, men kan skje på trege maskiner og ved fanebytte. Observert i et skjult testpanel. | D15 |
| A8 | Navnet «Puslespill» gir feil forventning og bidrar til mange korte runder. | D15 |
| A9 | Det finnes ingen avtaler med merkevarene som krever at rabattkodene vises. | T10 |
| A10 | Umami uten cookies krever ikke samtykke. | T14 |
| A11 | Kasser og merkevarekoder bør vurderes mot regler for markedsføring mot barn. Dette er ikke en juridisk vurdering. | D13 |

## Begrensninger

- Ingen innlogget bruker eller admin ble testet i nettleseren, fordi det ikke fantes testkonto. Disse flytene er vurdert fra koden.
- Touch ble vurdert fra koden. Testverktøyet sender bare mus- og tastaturhendelser.
- Lighthouse kjørte mot en lokal server uten komprimering. Tekstressurser er derfor tyngre enn i produksjon, men bildene, som dominerer, er like.
- FPS ble ikke målt på nytt, fordi nettleserpanelet var skjult.
- Data fra Umami og AdSense manglet.
