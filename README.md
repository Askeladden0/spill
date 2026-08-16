# PixelPlay – spillnettside

Statisk demo av spillnettsiden, basert på designfilen `Spillnettside.dc.html`.
Mørkt tema, grønn aksentfarge (`#2ee87f`), Poppins-font.

## Filstruktur

```
spill/
├── index.html          Forsiden – "Dagens spill" + rutenett med alle spill (ferdig demo)
├── premier.html         Premier-siden – delt layout, plassholderinnhold
├── rangering.html        Rangering-siden – delt layout, plassholderinnhold
├── player.html          Delt spillmal – viser ETT spill basert på ?id=<slug> i URL-en.
│                        Det lages IKKE én fil per spill; alle spill går gjennom denne malen.
├── css/
│   └── style.css        Alt av delt CSS (farger, header, footer, kort, knapper osv.)
│                        Brukes av alle sider – endringer her slår ut overalt.
├── js/
│   ├── games-data.js    Midlertidig "database" med spillobjekter (se under)
│   └── main.js          Rendrer heltefelt, spillrutenett, aktiv meny og spillside
└── assets/
    └── img/
        ├── games/        Miniatyrbilder for spill legges her, f.eks. skyfall-tactics.jpg
        └── icons/         Ev. egne ikoner/logoer
```

## Hvordan legge til et nytt spill (før backend/admin-panel finnes)

Åpne `js/games-data.js` og legg til et nytt objekt i `PIXELPLAY_GAMES`-listen:

```js
{
  id: "mitt-nye-spill",       // unik slug, brukes i URL-en player.html?id=mitt-nye-spill
  name: "Mitt Nye Spill",
  genre: "Action",
  rating: "4,5",
  points: "1 000 poeng",
  time: "~15 min",
  thumbnail: null,             // sett til "assets/img/games/mitt-nye-spill.jpg" når bilde finnes
  description: "Kort beskrivelse av spillet.",
  isDailyGame: false,          // sett til true for å vise det som "Dagens spill"
  pointsMultiplier: null
}
```

Spillet dukker automatisk opp i rutenettet på forsiden og får en egen side på
`player.html?id=mitt-nye-spill` – uten at noen nye filer trenger å lages.

## Planlagt admin-panel (fremtidig backend)

Når backenden er klar, er tanken at `js/games-data.js` erstattes av et
API-kall (f.eks. `fetch('/api/games')`) som returnerer spill på nøyaktig
samme format som objektene over. Admin-panelet vil da kunne legge til,
redigere og fjerne spill uten kodeendringer, og resten av siden
(`main.js`, `css/style.css`) fungerer uendret siden de kun er avhengige av
dataformatet – ikke av hvor dataene kommer fra.
