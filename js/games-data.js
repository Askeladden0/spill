/**
 * Spilldatabase for PixelPlay.
 *
 * Dette er en midlertidig "database" i ren JS, i påvente av backend.
 * Når admin-panelet er klart skal denne filen erstattes av et API-kall,
 * f.eks. `fetch('/api/games').then(r => r.json())`, som returnerer
 * objekter på nøyaktig dette formatet. Da kan main.js beholdes uendret.
 *
 * Felter per spill:
 *   id          - unik slug, brukes i URL: player.html?id=<id>
 *   name        - visningsnavn
 *   genre       - vises som badge på kortet
 *   rating      - tall som streng, f.eks. "4,7"
 *   points      - poeng-tekst, f.eks. "3 750 poeng"
 *   time        - omtrentlig spilletid, f.eks. "~25 min"
 *   thumbnail   - sti til bilde (assets/img/games/<id>.jpg), null = plassholder
 *   description - kort beskrivelse brukt på spillsiden
 *   isDailyGame - true for spillet som vises i "Dagens spill"-heltefeltet
 *   pointsMultiplier - valgfri tekst for badge i heltefeltet, f.eks. "1,5X POENG"
 */

window.PIXELPLAY_GAMES = [
  {
    id: "fruktfusjon",
    name: "Fruktfusjon",
    genre: "Puslespill",
    rating: "4,7",
    points: "Din skår = dine poeng",
    time: "~10 min",
    thumbnail: null,
    description: "Slipp frukt ned i krukken og slå sammen like frukter til større og større frukter, uten at haugen renner over.",
    isDailyGame: false
  },
  {
    id: "2048",
    name: "2048",
    genre: "Puslespill",
    rating: "4,9",
    points: "Din skår = dine poeng",
    time: "~5 min",
    thumbnail: null,
    description: "Slå sammen brikker med like tall og jag den store 2048-brikken. Skåren din legges rett til poengsummen og nivået ditt.",
    isDailyGame: true
  },
  {
    id: "tetris",
    name: "Tetris",
    genre: "Puslespill",
    rating: "4,9",
    points: "Din skår = dine poeng",
    time: "~15 min",
    thumbnail: null,
    description: "Styr de fargerike klossene mens de faller, fyll hele rader for å sprenge dem, og jag din egen rekord i det klassiske puslespillet.",
    isDailyGame: false
  },
  {
    id: "block-blast",
    name: "Block Blast",
    genre: "Puslespill",
    rating: "4,8",
    points: "Din skår = dine poeng",
    time: "~10 min",
    thumbnail: null,
    description: "Dra fargerike klosser fra hånden din over på brettet og fyll hele rader eller kolonner for å sprenge dem og score poeng.",
    isDailyGame: false
  },
  {
    id: "snake",
    name: "Snake",
    genre: "Arkade",
    rating: "4,6",
    points: "Din skår = dine poeng",
    time: "~8 min",
    thumbnail: null,
    description: "Styr slangen rundt brettet, spis prikkene og voks deg lengst mulig uten å treffe deg selv eller veggen."
  },
  {
    id: "bubble-shooter",
    name: "Bubble Shooter",
    genre: "Puslespill",
    rating: "4,7",
    points: "Din skår = dine poeng",
    time: "~10 min",
    thumbnail: null,
    description: "Sikt og skyt kuler for å matche tre eller flere med samme farge. Tøm hele brettet for maks poeng før kulene når bunnen."
  }
];
