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
    id: "neon-drift",
    name: "Neon Drift",
    genre: "Racing",
    rating: "4,5",
    points: "1 900 poeng",
    time: "~10 min",
    thumbnail: null,
    description: "Driftkjør gjennom neonopplyste gater i høy fart."
  },
  {
    id: "kokkeliv",
    name: "Kokkeliv",
    genre: "Simulator",
    rating: "4,2",
    points: "820 poeng",
    time: "~15 min",
    thumbnail: null,
    description: "Driv din egen restaurant og server sultne kunder."
  },
  {
    id: "dypets-vokter",
    name: "Dypets Vokter",
    genre: "Eventyr",
    rating: "4,8",
    points: "4 100 poeng",
    time: "~40 min",
    thumbnail: null,
    description: "Utforsk havets dyp og avdekk gamle mysterier."
  },
  {
    id: "bricks-bolts",
    name: "Bricks & Bolts",
    genre: "Puslespill",
    rating: "4,1",
    points: "560 poeng",
    time: "~5 min",
    thumbnail: null,
    description: "Rask og knotete klossepuslespill for en rask pause."
  },
  {
    id: "frostmark",
    name: "Frostmark",
    genre: "RPG",
    rating: "4,6",
    points: "2 480 poeng",
    time: "~30 min",
    thumbnail: null,
    description: "Et frossent kongerike venter på sin neste helt."
  },
  {
    id: "skyline-tycoon",
    name: "Skyline Tycoon",
    genre: "Bygging",
    rating: "4,3",
    points: "1 350 poeng",
    time: "~20 min",
    thumbnail: null,
    description: "Bygg din egen skyline fra bunnen av."
  },
  {
    id: "rift-runners",
    name: "Rift Runners",
    genre: "Action",
    rating: "4,4",
    points: "2 050 poeng",
    time: "~18 min",
    thumbnail: null,
    description: "Løp, hopp og slåss deg gjennom sprekker i virkeligheten."
  },
  {
    id: "kortkongen",
    name: "Kortkongen",
    genre: "Kort",
    rating: "4,0",
    points: "430 poeng",
    time: "~8 min",
    thumbnail: null,
    description: "Klassisk kortspill med en vri."
  }
];
