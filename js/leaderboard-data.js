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
    // Leser fra profiles_public (ikke profiles direkte): RLS begrenser nå
    // rå-select på profiles til egen rad + admin, siden profiles.is_admin
    // ikke skal være lesbart for alle. Viewet eksponerer fortsatt de samme
    // offentlige feltene for ALLE brukere (se supabase/schema.sql, seksjon 24).
    const { data, error } = await sb
      .from("profiles_public")
      .select("id, username, avatar_color, avatar_icon, level, xp, is_hidden");
    if (error) {
      console.error("[Studilla] Klarte ikke hente spillere:", error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Beste skår + antall runder per spiller og triks.
   *
   * Dette var tidligere `select user_id, game_id, score from game_records`
   * uten grense – altså ALLE runder som noen gang er spilt, hentet ned til
   * nettleseren for å grupperes der. Supabase kutter et slikt svar på 1000
   * rader uten å si fra, så topplista begynner å vise feil tall (og folk
   * forsvinner helt fra den) så snart siden har litt trafikk. Aggregeringen
   * gjøres nå i databasen (leaderboard_totals, seksjon 55): én rad per
   * spiller og triks i stedet for én rad per runde.
   */
  async function loadRecords() {
    const { data, error } = await sb.rpc("leaderboard_totals");
    if (!error && data) {
      return data.map((r) => ({
        user_id: r.user_id,
        game_id: r.game_id,
        score: Number(r.best) || 0,
        matches: Number(r.matches) || 0,
      }));
    }

    // Databasen har ikke fått seksjon 55 ennå – fall tilbake til den gamle
    // måten, men med en eksplisitt grense så det i det minste er tydelig
    // hvor taket går.
    if (error) {
      console.warn(
        "[Studilla] leaderboard_totals mangler – kjør supabase/schema.sql på nytt. " +
        "Bruker den gamle uthentingen inntil da."
      );
    }
    const fallback = await sb
      .from("game_records")
      .select("user_id, game_id, score")
      .order("score", { ascending: false })
      .limit(10000);
    if (fallback.error) {
      console.error("[Studilla] Klarte ikke hente spillrekorder:", fallback.error.message);
      return [];
    }
    return fallback.data || [];
  }

  /**
   * Ukens rangering (mandag–søndag, norsk tid). Den globale totallista er
   * demotiverende for nye spillere – der ligger de som har spilt siden mars
   * uoppnåelig langt foran. Ukeslista nullstilles hver mandag, så en fersk
   * spiller kan faktisk vinne.
   */
  async function loadWeekly(weekOffset) {
    const { data, error } = await sb.rpc("weekly_leaderboard", { p_week_offset: weekOffset || 0 });
    if (error || !data) {
      if (error) console.warn("[Studilla] Ukesrangeringen er ikke tilgjengelig:", error.message);
      return null;
    }
    return data.map((r) => ({
      user_id: r.user_id,
      score: Number(r.score) || 0,
      matches: Number(r.matches) || 0,
    }));
  }

  /**
   * Rangering for en gitt periode ("all", "month", "week", "today") og
   * eventuelt ett enkelt triks. Aggregeringen skjer i databasen
   * (period_leaderboard, seksjon 57) av samme grunn som for
   * leaderboard_totals: Supabase kutter et rått uttrekk av game_records på
   * 1 000 rader uten å si fra, og da begynner topplista å vise feil tall.
   *
   * Har ikke databasen fått seksjon 57 ennå, faller vi tilbake til å regne
   * det ut i nettleseren, slik at siden virker helt til schema.sql er kjørt
   * på nytt.
   */
  async function loadPeriod(period, gameId) {
    const { data, error } = await sb.rpc("period_leaderboard", {
      p_period: period || "all",
      p_game_id: gameId || null,
    });
    if (!error && data) {
      return data.map((r) => ({
        user_id: r.user_id,
        score: Number(r.score) || 0,
        matches: Number(r.matches) || 0,
      }));
    }

    console.warn(
      "[Studilla] period_leaderboard mangler – kjør supabase/schema.sql på nytt. " +
      "Regner perioden ut i nettleseren inntil da."
    );
    return periodFallback(period, gameId);
  }

  /**
   * Startpunktet for en periode i spillerens egen tidssone. Brukes bare av
   * fallback-en over; databasen regner selv i norsk tid.
   */
  function periodStart(period) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (period === "today") return d;
    if (period === "week") {
      // Mandag som ukestart, som i weekly_leaderboard.
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d;
    }
    if (period === "month") {
      d.setDate(1);
      return d;
    }
    return null;
  }

  async function periodFallback(period, gameId) {
    const start = periodStart(period);
    let query = sb.from("game_records").select("user_id, game_id, score, created_at");
    if (start) query = query.gte("created_at", start.toISOString());
    if (gameId) query = query.eq("game_id", gameId);
    const { data, error } = await query.limit(10000);
    if (error) {
      console.error("[Studilla] Klarte ikke hente perioderangeringen:", error.message);
      return [];
    }

    // Samme regnestykke som i databasen: beste runde per triks, summert.
    const best = new Map();
    (data || []).forEach((r) => {
      if (!best.has(r.user_id)) best.set(r.user_id, new Map());
      const perGame = best.get(r.user_id);
      const score = Number(r.score) || 0;
      const cur = perGame.get(r.game_id);
      if (!cur) perGame.set(r.game_id, { best: score, plays: 1 });
      else {
        cur.plays += 1;
        if (score > cur.best) cur.best = score;
      }
    });

    return Array.from(best.entries()).map(([user_id, perGame]) => {
      let score = 0;
      let matches = 0;
      perGame.forEach((v) => { score += v.best; matches += v.plays; });
      return { user_id, score, matches };
    });
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

    // En rad er enten én enkelt runde (gammel uthenting) eller allerede
    // sammenslått per spiller/triks (leaderboard_totals). Da bærer den et
    // matches-tall vi skal bruke i stedet for å telle rader.
    records.forEach((r) => {
      const plays = Number.isFinite(r.matches) ? Number(r.matches) : 1;
      totalMatches.set(r.user_id, (totalMatches.get(r.user_id) || 0) + plays);
      if (!perGameBest[r.game_id]) perGameBest[r.game_id] = new Map();
      const g = perGameBest[r.game_id];
      const score = Number(r.score) || 0;
      const cur = g.get(r.user_id);
      if (!cur) {
        g.set(r.user_id, { best: score, matches: plays });
      } else {
        cur.matches += plays;
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

  /**
   * Setter sammen en periodeliste (uke, måned, i dag) med profilene, i samme
   * form som buildBoards() gir, slik at rangeringssiden kan tegne den med
   * nøyaktig samme kode.
   */
  function buildPeriodBoard(profiles, rows) {
    const byId = new Map(rows.map((w) => [w.user_id, w]));
    return rank(
      profiles
        .filter((p) => byId.has(p.id))
        .map((p) => {
          const w = byId.get(p.id);
          return { ...p, score: w.score, matches: w.matches };
        })
    );
  }

  /**
   * Rangering blant dem du følger (og deg selv). Rank-tallene regnes på nytt
   * innenfor gruppen – å se «#412 av 3 000» er demotiverende, «#2 av 6» er
   * en konkurranse du faktisk kan vinne.
   */
  function buildFriendsBoard(board, followingIds, myId) {
    const allowed = new Set(followingIds);
    if (myId) allowed.add(myId);
    return rank(board.filter((p) => allowed.has(p.id)).map((p) => ({ ...p })));
  }

  window.StudillaLeaderboard = {
    games, loadProfiles, loadRecords, loadWeekly, loadPeriod,
    buildBoards, buildPeriodBoard, buildFriendsBoard,
    // Gammelt navn, beholdt så eldre kall ikke knekker.
    buildWeeklyBoard: buildPeriodBoard,
    codesCount, visiblePlayers,
  };
})();
