---
name: artikkel
description: Skriver en ferdig artikkel (et «tips») om et tema brukeren gir og publiserer den på Studilla – med research fra norske kilder, coverbilde og bilder underveis, minst én tabell, kildeliste og en triks-henvisning til et spill helt til slutt. Bruk denne når brukeren skriver /artikkel, ber om en ny artikkel, et nytt tips eller en guide til Studilla, eller vil ha et tema skrevet om og lagt ut på nettsiden – også når de bare sier «skriv om X og legg det ut».
---

# /artikkel – skriv og publiser et tips på Studilla

Studilla viser artikler som «tips» (tips.html og én statisk side per tips). Innholdet ligger i
Supabase, ikke i repoet: én rad i `public.guides` og én rad per blokk i `public.guide_modules`.
Bildene ligger i repoet under `assets/img/tips/` og går ut på nettet når main pushes.

Supabase-prosjekt: `dtchrzsayskizbhuqdls` (bruk Supabase-MCP-ens `execute_sql`).
Nettsted: `https://studilla.no`.

Argumentet etter /artikkel er temaet. Mangler det, spør kort hva artikkelen skal handle om.

## 1. Research

Målgruppen er elever på ungdomsskole og vgs. Artiklene handler typisk om rettigheter, regler,
eksamen, penger og skolehverdag, så fakta må stemme. Søk (WebSearch, «standard») etter primære
norske kilder: udir.no, lovdata.no, ung.no, statsforvalteren.no, fylkeskommuner og kommuner.
Noter tall, frister og paragrafer nøyaktig, og noter 2–4 kilder du faktisk bygger på.
Er regelverket endret nylig (f.eks. nytt skoleår), sjekk at du har gjeldende versjon.

## 2. Skriv artikkelen

Skriv på norsk bokmål, direkte til leseren med «du». Stilen skal ligne de eksisterende tipsene:

- Ingressen svarer på spørsmålet med en gang i 1–3 setninger («Ja, men bare hvis …»).
- Korte avsnitt, konkrete tall og eksempler, ingen fyllord, ingen tankestreker som pynt.
- Overskriftene er det leseren lurer på («Hva skjer hvis du går over?», «Slik klager du»).
- Steg-for-steg-lister skrives som nummererte linjer i brødteksten («1. …\n2. …»), fordi
  `bullets` blir punktliste uten nummer.
- Ikke juridisk rådgivning-skremsel; vær presis og praktisk.
- 600–1200 ord er passe. Sett `read_time` til et anslag («3 min»).

Skriv aldri ordene spill/game på en måte som får siden til å se ut som en spillnettside for
søkemotorer (se CLAUDE.md). Triks-modulen nederst er greit – den er en etablert del av tipsene.
Ikke sett `category` (la den være tom streng) – brukeren vil ikke ha kategori-tagger.

## 3. Moduler

Modultypene og feltene (rendres av `js/guide-render.js`):

| type | data |
| --- | --- |
| `tekst` | `{heading, headingLevel: 2\|3, body, bullets: [], tip: null\|"tekst"}` – avsnitt skilles med `\n\n`, linjeskift med `\n`. `tip` vises som en «Tips:»-boks. Tom `heading` gir avsnitt uten overskrift. |
| `tabell` | `{title, columns: [a, b, c], rows: [{a, b, c}], source}` – **nøyaktig tre kolonner**, ellers vises «Kolonne 1/2/3». Tredje kolonne er høyrejustert og grønn, så legg det viktigste/resultatet der. |
| `bilde` | `{url, alt, caption}` – fullbredde. `url` er relativ (`assets/img/tips/…`). |
| `triks` | `{gameId, title: "", intro: "", href: null}` – kort som lenker til spillet. |

Rekkefølge: tekstmoduler med 2–3 bilder spredt der de passer (aldri to bilder etter hverandre),
minst én `tabell` der en sammenligning faktisk hjelper leseren, deretter `Kilder`
(tekstmodul med kildenavnene som `bullets` – lenker støttes ikke), og **til slutt én `triks`**.

Velg triks-spill med:

```sql
select id, name, description from games where not hidden order by name;
```

Ta et spill som passer temaet eller stemningen (f.eks. et ordspill til norsk-tips, et tallspill
til matte/penger). Finnes det ikke noe naturlig, ta et populært, kort spill.

## 4. Bilder

Bruk fritt lisensierte bilder fra Unsplash (krever ikke kreditering). Trenger: ett cover
(16:9) og 2–3 bilder i teksten (3:2). Velg motiver som viser situasjonen i artikkelen, gjerne
med ungdom/skole – unngå generiske «stock-smil» der det ikke passer.

Finn kandidater i den innebygde nettleseren: åpn `https://unsplash.com/s/photos/klasserom?license=free`
og kjør dette i siden (bytt søkeord i lista):

```js
const qs=["empty-classroom","exam","doctor-patient"]; const out={};
for (const q of qs){const h=await (await fetch('/s/photos/'+q+'?license=free')).text();
  const d=new DOMParser().parseFromString(h,'text/html');
  out[q]=[...d.querySelectorAll('figure img[src*="images.unsplash.com/photo"]')].slice(0,8)
    .map(i=>i.alt+' | '+i.src.split('?')[0].replace('https://images.unsplash.com/',''));}
out
```

Bare `images.unsplash.com/photo-…` er gratis (`plus.unsplash.com` er betalt – ikke bruk).
Last ned kandidatene til scratchpad (`https://images.unsplash.com/photo-<id>?w=1200&q=80&fm=jpg`),
lag kontaktark og se på dem før du velger:

```bash
python -I .claude/skills/artikkel/scripts/images.py sheet <mappe-med-jpg> <scratchpad>/sheet.png
python -I .claude/skills/artikkel/scripts/images.py prep <kilde.jpg> assets/img/tips/<slug>-cover.webp 16:9
python -I .claude/skills/artikkel/scripts/images.py prep <kilde.jpg> assets/img/tips/<slug>-<motiv>.webp 3:2 [vertikalt-fokus 0-1]
```

Filnavn: `<kort-slug>-cover.webp` og `<kort-slug>-<motiv>.webp`.

## 5. Lagre i Supabase

Skriv artikkelen som JSON i scratchpad og la skriptet lage SQL-en, så slipper du
escaping-feil i norsk tekst med anførselstegn:

```json
{
  "id": "url-slug-uten-aeoeaa",
  "title": "…", "excerpt": "ingressen", "read_time": "4 min",
  "cover": "assets/img/tips/slug-cover.webp",
  "modules": [ {"type": "tekst", "data": {…}}, … , {"type": "triks", "data": {"gameId": "2048", "title": "", "intro": "", "href": null}} ]
}
```

```bash
python -I .claude/skills/artikkel/scripts/to_sql.py <scratchpad>/artikkel.json > <scratchpad>/artikkel.sql
```

Skriptet validerer modulene (tre tabellkolonner, triks til slutt, bildefiler finnes), setter
`cover_url` til absolutt `https://studilla.no/…` (trengs for og:image) og `sort_order` til
neste ledige. Les SQL-en og kjør den med `execute_sql`. `id` blir filnavnet til den statiske
siden og kan ikke endres senere uten å bryte lenker – velg en kort, beskrivende slug.
Finnes id-en fra før, velg en annen i stedet for å overskrive.

## 6. Sjekk, commit og publiser

1. Bygg en kopi av nettstedet og se på artikkelsiden (`node build/build.mjs` lager
   `dist/<id>.html`; er `dist` låst, bygg en kopi i scratchpad). Sjekk at overskrifter,
   tabell, bilder og triks-kortet vises. Coveret peker på studilla.no og vises først etter deploy.
2. Commit bildene (`git add assets/img/tips/<filene>`), merge til main og push – i samme tur,
   uten å spørre (se CLAUDE.md). Bekreft at `git status -sb` viser `main...origin/main`.
3. Vent til coveret svarer 200: `until [ "$(curl -s -o /dev/null -w '%{http_code}' https://studilla.no/assets/img/tips/<slug>-cover.webp)" = 200 ]; do sleep 5; done`
4. Fortell brukeren kort: tittel, hvilke bilder og hvilken tabell som ble med, hvilket spill
   triks-kortet peker på, og at den statiske SEO-siden kommer ved neste automatiske bygg
   (hver 3. time). Tipset vises på tips.html med en gang.

Vil brukeren endre noe etterpå, oppdater radene i `guide_modules` (eller rediger i adminvisningen
på tips-siden) i stedet for å lage tipset på nytt.
