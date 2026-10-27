/**
 * Studilla – online tospiller (window.StudillaOnline).
 *
 * Tynt lag over RPC-ene i supabase/schema.sql (seksjon 76). En kamp er én rad
 * i online_matches som begge spillerne abonnerer på via Supabase Realtime.
 * Man trenger ikke være logget inn: plassen i kampen eies av en tilfeldig
 * nøkkel som lagres i localStorage (studilla_match_<id>). Den som har
 * nøkkelen, er spilleren – også når hen åpner lenken på nytt senere.
 */
(function () {
  "use strict";

  const KEY_PREFIX = "studilla_match_";
  const POLL_MS = 2500;
  const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function sb() {
    return window.supabaseClient || null;
  }

  function isAvailable() {
    return !!sb();
  }

  function isMatchId(id) {
    return ID_RE.test(String(id || ""));
  }

  function randomToken() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID() + window.crypto.randomUUID();
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function readToken(matchId) {
    try { return window.localStorage.getItem(KEY_PREFIX + matchId); } catch (e) { return null; }
  }

  function rememberToken(matchId, token) {
    try { window.localStorage.setItem(KEY_PREFIX + matchId, token); } catch (e) {}
  }

  /** Nøkkelen for kampen; lages og lagres hvis den ikke finnes. */
  function tokenFor(matchId) {
    let t = readToken(matchId);
    if (!t) {
      t = randomToken();
      rememberToken(matchId, t);
    }
    return t;
  }

  async function rpc(name, args) {
    const client = sb();
    if (!client) throw new Error("Får ikke kontakt med serveren.");
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message || "Noe gikk galt.");
    return data;
  }

  /** Lager en ny kamp der du er plass 1 (rød, starter). Returnerer id-en. */
  async function create(game) {
    const token = randomToken();
    const id = await rpc("online_create_match", { p_game: game, p_token: token });
    rememberToken(id, token);
    return id;
  }

  /** Blir med i kampen. Returnerer plassen (1/2), eller 0 som tilskuer. */
  async function join(id) {
    return Number(await rpc("online_join_match", { p_id: id, p_token: tokenFor(id) })) || 0;
  }

  function move(id, col) {
    return rpc("online_c4_move", { p_id: id, p_token: tokenFor(id), p_col: col });
  }

  function resign(id) {
    return rpc("online_resign", { p_id: id, p_token: tokenFor(id) });
  }

  /** Revansj med byttede farger. Begge spillerne får samme nye kamp. */
  async function rematch(id) {
    const newId = await rpc("online_rematch", { p_id: id, p_token: tokenFor(id) });
    // Revansjen bruker de samme nøklene som kampen før.
    rememberToken(newId, tokenFor(id));
    return newId;
  }

  /**
   * Motspilleren startet en revansj: den nye kampen eies av de samme
   * nøklene, så nøkkelen fra forrige kamp tas med over.
   */
  function followRematch(oldId, newId) {
    const old = readToken(oldId);
    if (old) rememberToken(newId, old);
  }

  async function fetchMatch(id) {
    const client = sb();
    if (!client) throw new Error("Får ikke kontakt med serveren.");
    const { data, error } = await client.from("online_matches").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message || "Noe gikk galt.");
    return data;
  }

  /**
   * Kaller onRow(rad) hver gang kampen endrer seg. Bruker Realtime, med
   * polling som reserve når kanalen ikke er koblet til. Returnerer en
   * funksjon som avslutter abonnementet.
   */
  function subscribe(id, onRow) {
    const client = sb();
    let stopped = false;
    let live = false;
    let lastUpdated = "";

    function deliver(row) {
      if (stopped || !row) return;
      const stamp = `${row.updated_at}|${row.move_count}|${row.status}|${row.rematch_id || ""}`;
      if (stamp === lastUpdated) return;
      lastUpdated = stamp;
      onRow(row);
    }

    const channel = client
      ? client
          .channel(`match:${id}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "online_matches", filter: `id=eq.${id}` }, (payload) => deliver(payload.new))
          .subscribe((status) => {
            live = status === "SUBSCRIBED";
            // Hent raden på nytt når vi (gjen)kobler, i tilfelle vi gikk glipp av noe.
            if (live) fetchMatch(id).then(deliver).catch(() => {});
          })
      : null;

    const poll = window.setInterval(() => {
      if (live || stopped || document.hidden) return;
      fetchMatch(id).then(deliver).catch(() => {});
    }, POLL_MS);

    function onVisible() {
      if (!document.hidden) fetchMatch(id).then(deliver).catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);

    return function unsubscribe() {
      stopped = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel && client) client.removeChannel(channel);
    };
  }

  function matchUrl(id, game) {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
    return `${base}player.html?id=${encodeURIComponent(game || "fire-pa-rad")}&kamp=${encodeURIComponent(id)}`;
  }

  window.StudillaOnline = {
    isAvailable,
    isMatchId,
    create,
    join,
    move,
    resign,
    rematch,
    followRematch,
    fetch: fetchMatch,
    subscribe,
    matchUrl,
  };
})();
