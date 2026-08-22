/**
 * Studilla – delt rangeringslogikk.
 *
 * Bygger total-rangering (basert på xp/poeng, samme tall som premier.html
 * bruker til nivå) og per-spill-rangering (basert på beste enkeltrunde i
 * game_records) fra ekte data i Supabase. Brukes av rangering.html og
 * spillerprofil.html slik at forsiden, profilsiden, premier-siden og
 * rangeringssiden alltid viser de samme spillene og de samme tallene.
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const games = window.STUDILLA_GAMES || [];

  async function loadProfiles() {
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, avatar_color, avatar_icon, level, xp, is_hidden");
    if (error) {
      console.error("[Studilla] Klarte ikke hente spillere:", error.message);
      return [];
    }
    return data || [];
  }

  async function loadRecords() {
    const { data, error } = await sb
      .from("game_records")
      .select("user_id, game_id, score");
    if (error) {
      console.error("[Studilla] Klarte ikke hente spillrekorder:", error.message);
      return [];
    }
    return data || [];
  }

  async function codesCount(userId) {
    const { data, error } = await sb.rpc("user_codes_count", { p_user_id: userId });
    if (error) {
      console.error("[Studilla] Klarte ikke hente antall rabattkoder:", error.message);
      return 0;
    }
    return Number(data) || 0;
  }

  function rank(list) {
    return list
      .slice()
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username, "no"))
      .map((p, i) => Object.assign({}, p, { rank: i + 1 }));
  }

  /**
   * Returnerer { total, perGame } der total er alle spillere rangert etter
   * xp, og perGame er { [gameId]: [...] } rangert etter beste skår i det
   * spillet (kun spillere som faktisk har spilt det spillet er med).
   */
  function buildBoards(profiles, records) {
    const totalMatches = new Map();
    const perGameBest = {};

    records.forEach((r) => {
      totalMatches.set(r.user_id, (totalMatches.get(r.user_id) || 0) + 1);
      if (!perGameBest[r.game_id]) perGameBest[r.game_id] = new Map();
      const g = perGameBest[r.game_id];
      const score = Number(r.score) || 0;
      const cur = g.get(r.user_id);
      if (!cur) {
        g.set(r.user_id, { best: score, matches: 1 });
      } else {
        cur.matches += 1;
        if (score > cur.best) cur.best = score;
      }
    });

    const total = rank(
      profiles.map((p) => ({
        ...p,
        score: p.xp,
        matches: totalMatches.get(p.id) || 0,
      }))
    );

    const perGame = {};
    games.forEach((game) => {
      const g = perGameBest[game.id] || new Map();
      perGame[game.id] = rank(
        profiles
          .filter((p) => g.has(p.id))
          .map((p) => {
            const rec = g.get(p.id);
            return { ...p, score: rec.best, matches: rec.matches };
          })
      );
    });

    return { total, perGame };
  }

  /**
   * Filtrerer bort spillere som har skjult seg selv fra rangeringen
   * (profiles.is_hidden), uten å endre rank-tallene deres – brukes av
   * offentlige lister/søk (rangering.html), men ikke når en spiller ser sin
   * egen plassering (den beholder sitt ekte, uendrede rank-tall).
   */
  function visiblePlayers(list) {
    return list.filter((p) => !p.is_hidden);
  }

  window.StudillaLeaderboard = { games, loadProfiles, loadRecords, buildBoards, codesCount, visiblePlayers };
})();
