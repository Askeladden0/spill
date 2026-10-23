# Prompt: Helhetlig evaluering av Studilla

Lim inn alt under streken i en ny Claude Code-økt i dette repoet.

---

Gjør en helhetlig evaluering av Studilla i fire steg, alt i denne økten og uten
å stille meg spørsmål underveis. Der noe er uklart: ta et rimelig valg, merk det
som **Antakelse** i dokumentet og gå videre. Skriv på norsk (bokmål).

Resultatet skrives til `EVALUERING.md` i rotmappen, med én seksjon per steg.
Ikke overskriv `VURDERING.md` eller `ADSENSE_AUDIT.md`. Dette er en evaluering:
ikke endre kode, database eller innstillinger.

## Steg 0 – Vurderingskriterier

Før du starter: definer et felles sett med dimensjoner som steg 2 og 3 skal
vurderes langs, slik at de kan sammenlignes direkte. Bruk minst disse, og legg
til flere hvis formålet i steg 1 tilsier det:

- Første besøk og forståelse av hva siden er
- Kjerneflyten (finne og bruke innhold)
- Grunn til å komme tilbake (retensjon)
- Konto, profil og sosiale funksjoner
- Mobil og touch
- Ytelse og lastetid
- SEO og synlighet
- Tilgjengelighet (WCAG)
- Sikkerhet og personvern (RLS, admin, samtykke)
- Inntekter (AdSense)
- Vedlikeholdbarhet for én utvikler

## Steg 1 – Formål og funksjonalitet

Beskriv hva Studilla skal være: hvem målgruppen er, hvilke problemer og
oppgaver den løser for dem, hvilken funksjonalitet den skal ha, og hva
suksess betyr (målbart der det går).

Bruk **bare** disse kildene, og bare tekst som beskriver formål, målgruppe og
rammer, ikke hvordan siden ser ut eller er bygget:

- `README.md` (innledningen)
- `om.html` (selve teksten)
- `documents/Studilla-reisen.pptx` (spesielt «Utgangspunktet» og avslutningen)
- `CLAUDE.md` (rammer)

Ta med rammene eksplisitt:

- Én utvikler
- Statisk frontend uten rammeverk, Supabase som backend og GitHub Pages som hosting
- Gratis å bruke, finansiert med AdSense
- SEO-kravet: siden skal ikke fremstå som en spillnettside i HTML-en
- Ingen kategoritagger på innhold eller rangeringer

Ikke les `VURDERING.md`, `ADSENSE_AUDIT.md`, andre HTML-filer eller kode i
dette steget.

## Steg 2 – Anbefalt løsning (blindt)

Start en subagent som **bare** får teksten fra steg 1 og kriteriene fra
steg 0. Den skal ikke ha tilgang til repoet eller nettsiden, og den skal få
beskjed om ikke å lese filer eller søke etter Studilla på nettet.

Be den beskrive hvordan den ville løst formålet innenfor rammene, langs hver
dimensjon fra steg 0:

- **Teknisk:** arkitektur, datamodell, autentisering, sikkerhet, ytelse, SEO,
  analyse og drift
- **UX:** informasjonsarkitektur, førstegangsopplevelse, kjerneflyt,
  retensjonsløkke, mobil og tilgjengelighet

Lim inn svaret uendret i dokumentet, og legg til en kort kommentar om
eventuelle steder der det bryter med rammene.

## Steg 3 – Dagens løsning

Analyser hvordan Studilla faktisk er løst i dag, langs de samme dimensjonene.
Bygg på observasjoner, ikke bare kodelesing:

- **Kode:** HTML-sidene, `js/`, `css/`, `build/` og `supabase/` (skjema, RLS
  og triggere)
- **Gjennomgang i nettleseren:** kjør `npm run dev` og gå gjennom de viktigste
  flytene på desktop og mobil (375 px bredde). Følg en førstegangsbesøkende,
  en innlogget bruker og en admin så langt det går uten ekte passord.
- **Målinger:** Lighthouse (ytelse, tilgjengelighet, SEO, beste praksis) hvis
  tilgjengelig, ellers manuelle sjekker
- **Bruksdata:** hent analyse- og bruksdata hvis det finnes tilgang
  (Supabase-tabeller, analytics-oppsettet i `build/partials/head.html`). Bare
  les, ikke endre noe. Skriv det hvis data mangler.
- **Tidligere vurderinger:** `VURDERING.md` og `ADSENSE_AUDIT.md` kan brukes som
  innspill, men alle funn derfra skal etterprøves mot dagens kode.

For hver dimensjon: hva fungerer, hva fungerer ikke, og hvilke belegg du har
(fil:linje, skjermbilde-beskrivelse eller måling).

## Steg 4 – Gap og tiltak

1. **Gaptabell:** én rad per dimensjon med anbefalt løsning (steg 2), dagens
   løsning (steg 3) og gapet. Gapet går begge veier: noter også der dagens
   løsning er bedre enn eller like god som anbefalingen, og hvorfor.
2. **Tiltaksliste:** konkrete tiltak for å lukke gapene. For hvert tiltak:
   - hva som skal gjøres og i hvilke filer
   - effekt (høy, middels eller lav) og hvilket mål fra steg 1 det støtter
   - innsats (S, M eller L)
   - risiko eller avhengigheter
3. **Prioritering:** grupper tiltakene i «Raske gevinster», «Neste» og
   «Større løft». Avslutt med de fem tiltakene du ville gjort først, med en
   kort begrunnelse.

## Avslutning

Les gjennom dokumentet én gang for selvmotsigelser og ubegrunnede påstander.
Commit `EVALUERING.md`, merge til main og push, som beskrevet i `CLAUDE.md`.
Svar meg til slutt med en kort oppsummering: de viktigste funnene, de fem
prioriterte tiltakene, og hvilke antakelser du måtte gjøre.
