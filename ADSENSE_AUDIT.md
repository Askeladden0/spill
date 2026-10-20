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
| Lighthouse, 360px-test, bilde-komprimering | Ikke kjørt |
