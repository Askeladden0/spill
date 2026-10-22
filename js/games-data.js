/**
 * Spilldatabase for Studilla.
 *
 * window.STUDILLA_GAMES starter som en statisk fallback-liste (samme format
 * som før), men fylles umiddelbart om med ekte data fra Supabase-tabellen
 * `games` når den er tilgjengelig – arrayet muteres i stedet for å byttes ut,
 * slik at kode som har lagret en referanse til det (main.js, leaderboard-data.js
 * osv.) automatisk ser oppdaterte verdier.
 *
 * Vent på window.STUDILLA_GAMES_READY før du render noe som er avhengig av
 * spilldata, slik at siden ikke rekker å tegne fallback-dataene først.
 *
 * Felter per spill:
 *   id               - unik slug, brukes i URL: player.html?id=<id>, og som
 *                       filnavn for bilder: assets/img/games/<id>.svg / icons/<id>.svg
 *   name             - visningsnavn
 *   time             - omtrentlig spilletid, f.eks. "~25 min"
 *   thumbnail        - sti/URL til coverbilde (vises på hovedsiden og i "dagens spill")
 *   icon             - sti/URL til ikon (vises til venstre for spillnavn i rangering/rekorder)
 *   description      - kort beskrivelse brukt på spillsiden
 *   isDailyGame      - true for spillet som vises i "Dagens spill"-heltefeltet
 *   pointsMultiplier - valgfri tekst for badge i heltefeltet, f.eks. "1,5X POENG"
 *   pointRate        - hvor mange poeng spilleren får per poeng skår i spillet
 *                       (1 = 1:1, 2 = dobbelt opp). Settes per spill i adminpanelet.
 */

window.STUDILLA_GAMES = [
  {
    id: "fruktfusjon",
    name: "Fruktfusjon",
    time: "~10 min",
    thumbnail: "assets/img/games/fruktfusjon.svg",
    icon: "assets/img/icons/fruktfusjon.svg",
    description: "Slipp frukt ned i krukken og slå sammen like frukter til større og større frukter, uten at haugen renner over.",
    isDailyGame: false
  },
  {
    id: "tallkombo",
    name: "Tallkombo",
    time: "~5 min",
    thumbnail: "assets/img/games/tallkombo.svg",
    icon: "assets/img/icons/tallkombo.svg",
    description: "Slå sammen brikker med like tall og jag den store 2048-brikken. Skåren din legges rett til poengsummen og nivået ditt.",
    isDailyGame: true
  },
  {
    id: "puslespill",
    name: "Puslespill",
    time: "~15 min",
    thumbnail: "assets/img/games/puslespill.svg",
    icon: "assets/img/icons/puslespill.svg",
    description: "Styr de fargerike klossene mens de faller, fyll hele rader for å fjerne dem, og jag din egen rekord i det klassiske puslespillet.",
    isDailyGame: false
  },
  {
    id: "blokksprenging",
    name: "Blokksprenging",
    time: "~10 min",
    thumbnail: "assets/img/games/blokksprenging.svg",
    icon: "assets/img/icons/blokksprenging.svg",
    description: "Dra fargerike klosser fra hånden din over på brettet og fyll hele rader eller kolonner for å sprenge dem og score poeng.",
    isDailyGame: false
  },
  {
    id: "slangen",
    name: "Slangen",
    time: "~8 min",
    thumbnail: "assets/img/games/slangen.svg",
    icon: "assets/img/icons/slangen.svg",
    description: "Styr slangen rundt brettet, spis maten og voks deg lengst mulig uten å treffe deg selv eller veggen.",
    isDailyGame: false
  },
  {
    id: "boblekanonen",
    name: "Boblekanonen",
    time: "~10 min",
    thumbnail: "assets/img/games/boblekanonen.svg",
    icon: "assets/img/icons/boblekanonen.svg",
    description: "Sikt og skyt bobler for å matche tre eller flere med samme farge. Tøm brettet for maks poeng før boblene når bunnen.",
    isDailyGame: false
  },
  {
    id: "minesveiper",
    name: "Minesveiper",
    time: "~5 min",
    thumbnail: "assets/img/games/minesveiper.svg",
    icon: "assets/img/icons/minesveiper.svg",
    description: "Avdekk alle rutene uten miner. Åpne ruter, sett flagg der du tror det ligger en mine, og bruk tallene til å resonnere deg frem.",
    isDailyGame: false
  },
  {
    id: "fire-pa-rad",
    name: "Fire på rad",
    time: "~5 min",
    thumbnail: "assets/img/games/fire-pa-rad.svg",
    icon: "assets/img/icons/fire-pa-rad.svg",
    description: "Slipp brikker i kolonnene og få fire på rad før AI-motstanderen gjør det. Jo raskere du vinner, jo flere poeng.",
    isDailyGame: false
  },
  {
    id: "papirkomet",
    name: "Papirkomet",
    time: "~3 min",
    thumbnail: "assets/img/games/papirkomet.svg",
    icon: "assets/img/icons/papirkomet.svg",
    description: "Trykk for å tenne motoren og fly romskipet Polaris gjennom åpningene mellom asteroidene. Ett feiltrykk og det er over.",
    isDailyGame: false
  }
];

/**
 * Henter spill fra Supabase-tabellen `games` og oppdaterer
 * window.STUDILLA_GAMES i place (samme array-referanse). Feiler stille og
 * beholder fallback-listen over hvis Supabase ikke er tilgjengelig ennå.
 */
/**
 * "Dagens triks" roterer automatisk: hvilket triks som er dagens regnes ut
 * fra datoen, slik at det bytter seg selv ved midnatt uten at noen må inn i
 * adminpanelet. Rekkefølgen på forsiden (sort_order) brukes som runde, så
 * alle triks får tur etter tur.
 *
 * Admin kan skru rotasjonen av i adminpanelet
 * (app_settings.daily_game_rotation); da blir triksen som er merket manuelt
 * med is_daily_game stående til den byttes.
 */
window.STUDILLA_DAILY_ROTATION = true;

// Døgnnummer i UTC – samme tall for alle besøkende hele døgnet, og +1 ved
// midnatt.
function studillaDayIndex(now) {
  return Math.floor((now || Date.now()) / 86400000);
}

window.studillaApplyDailyRotation = function applyDailyRotation(games) {
  if (!games || !games.length) return games;
  if (!window.STUDILLA_DAILY_ROTATION) return games;
  const index = studillaDayIndex() % games.length;
  games.forEach((g, i) => { g.isDailyGame = i === index; });
  return games;
};

/**
 * Millisekunder til neste rotasjon (midnatt UTC). Brukes av nedtellingen på
 * forsiden.
 */
window.studillaMsUntilNextDailyGame = function msUntilNextDailyGame() {
  const now = Date.now();
  return (studillaDayIndex(now) + 1) * 86400000 - now;
};

window.STUDILLA_GAMES_READY = (async function loadGames() {
  const sb = window.supabaseClient;
  if (!sb) return window.studillaApplyDailyRotation(window.STUDILLA_GAMES);

  // Ikke la et treigt/utilgjengelig nettverk blokkere siden i det uendelige –
  // etter 5 sekunder gir vi opp og viser fallback-listen i stedet.
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 5000));

  const BASE_COLUMNS = "id, name, points, time_estimate, description, thumbnail_url, icon_url, points_multiplier, is_daily_game";

  // point_rate kom inn i schema.sql seksjon 35. Databaser som ikke har kjørt
  // migrasjonen ennå svarer med en feil på den kolonnen – da henter vi resten
  // og lar alle spill ligge på faktor 1, i stedet for å falle helt tilbake til
  // den statiske listen.
  async function fetchGames() {
    const withRate = await sb
      .from("games")
      .select(`${BASE_COLUMNS}, point_rate`)
      .eq("hidden", false)
      .order("sort_order", { ascending: true });
    if (!withRate.error) return withRate;
    return sb
      .from("games")
      .select(BASE_COLUMNS)
      .eq("hidden", false)
      .order("sort_order", { ascending: true });
  }

  // Rotasjonen kan skrus av i adminpanelet. Feiler oppslaget (eller mangler
  // kolonnen fordi migrasjonen ikke er kjørt), lar vi rotasjonen stå på.
  async function fetchRotationSetting() {
    const { data, error } = await sb.from("app_settings").select("daily_game_rotation").eq("id", 1).maybeSingle();
    if (error || !data || data.daily_game_rotation == null) return true;
    return !!data.daily_game_rotation;
  }

  const [result, rotation] = await Promise.all([
    Promise.race([fetchGames(), timeout]),
    Promise.race([fetchRotationSetting(), timeout.then(() => true)]),
  ]);
  window.STUDILLA_DAILY_ROTATION = rotation !== false;

  if (result.timedOut) {
    console.error("[Studilla] Tidsavbrudd ved henting av spill, bruker fallback-liste.");
    return window.studillaApplyDailyRotation(window.STUDILLA_GAMES);
  }

  const { data, error } = result;
  if (error || !data || !data.length) {
    if (error) console.error("[Studilla] Klarte ikke hente spill, bruker fallback-liste:", error.message);
    return window.studillaApplyDailyRotation(window.STUDILLA_GAMES);
  }

  const mapped = data.map((g) => ({
    id: g.id,
    name: g.name,
    points: g.points,
    time: g.time_estimate,
    thumbnail: g.thumbnail_url,
    icon: g.icon_url,
    description: g.description,
    isDailyGame: g.is_daily_game,
    pointsMultiplier: g.points_multiplier || undefined,
    // Hvor mange poeng spilleren får per poeng skår (redigeres i adminpanelet).
    pointRate: g.point_rate == null ? 1 : Number(g.point_rate)
  }));

  window.STUDILLA_GAMES.length = 0;
  window.STUDILLA_GAMES.push(...mapped);
  return window.studillaApplyDailyRotation(window.STUDILLA_GAMES);
})();

/**
 * HTML for et lite spillikon, brukt til venstre for spillnavn i rangering,
 * "mine rekorder" osv. Faller tilbake til en tom plassholder hvis spillet
 * ikke har noe ikon satt ennå.
 */
window.gameIconHTML = function gameIconHTML(game, size) {
  const px = size || 22;
  if (!game || !game.icon) {
    return `<span class="game-icon-badge" style="width:${px}px;height:${px}px"></span>`;
  }
  return `<img class="game-icon-badge" src="${game.icon}" alt="" width="${px}" height="${px}" style="width:${px}px;height:${px}px">`;
};
