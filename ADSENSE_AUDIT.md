# AdSense-revisjon (20.10.2026)

| Punkt | Status |
|---|---|
| Uferdige sider | OK. `premier.html` fjernet fra main (ligger på branch `premier-dev`), lenker i meny, level-up-popup og profil fjernet |
| om / personvern / kontakt / vilkår | OK. `om.html` og `personvern.html` lagt til. Footer lenker til Om oss, Kontakt, Personvern, Vilkår |
| Personvern nevner AdSense, Umami, lagrede data, Googles side | OK |
| Kontakt via e-post | Ikke gjort: siden bruker TikTok, ingen e-post oppgitt (manuelt) |
| Forside-intro, unik title/description | OK. Forsidens title oppdatert. Spill/guider-sider får tekst via JS/Supabase (ikke endret) |
| AdSense-script i delt head | OK (`build/partials/head.html`) |
| ads.txt, robots.txt, sitemap.xml | OK, kopieres av build. Antar domenet studilla.no |
| 404.html | OK |
| Annonseplass + data-adtest | Forberedt (`.ad-slot` med 150px avstand, `STUDILLA_ADS.adtest`). Ingen enheter plassert |
| Cookie-samtykke | Eksisterende Consent Mode v2 (default denied) blokkerer ikke en CMP. Sett opp CMP i AdSense |
| 360px-test | OK. Ingen horisontal scroll på forside, om, kontakt, personvern, vilkår, guider, rangering, 404 og spillside |
| Lighthouse (mobil, lokal server uten komprimering) | Forside perf 49 / tilgj. 90 / BP 100 / SEO 100. Om 72/92/100/100. Guider 47/92/100/100. Personvern 56/92/100/100. Spillside 58/92/100/100. Lav ytelse skyldes store spillbilder fra Supabase (200-550 KB, LCP 12 s på throttlet mobil) og ubrukt JS/CSS |
| Bilde-komprimering | Ikke gjort (bildene ligger i Supabase Storage) |
