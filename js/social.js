/**
 * Studilla – det sosiale laget: følging, meldinger og aktivitetsfeed.
 *
 * Alt som skriver noe går gjennom RPC-er i supabase/schema.sql (seksjon
 * 50–54), ikke gjennom rå tabellskriving, slik at blokkering, fartsgrenser og
 * «kun fra dem jeg følger» håndheves samme sted uansett hvilken side som
 * kaller det.
 *
 * Krever js/supabase-config.js og js/auth.js lastet først.
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;

  /**
   * Hele det sosiale laget er nytt i schema.sql. Kjører en side mot en
   * database der migrasjonen ikke er kjørt ennå, svarer Supabase med
   * "could not find the function". Da skjuler vi det sosiale i stedet for å
   * fylle siden med feilmeldinger – og sier fra én gang i konsollen.
   */
  let available = null;
  let warned = false;

  function isMissing(error) {
    if (!error) return false;
    const msg = (error.message || "") + " " + (error.details || "");
    return error.code === "PGRST202" || error.code === "42P01" ||
      /does not exist|could not find the function|schema cache/i.test(msg);
  }

  function noteMissing() {
    available = false;
    if (warned) return;
    warned = true;
    console.warn(
      "[Studilla] Det sosiale laget mangler i databasen. Kjør supabase/schema.sql " +
      "på nytt (seksjon 50–54) for å slå på følging, meldinger og vennerangering."
    );
  }

  async function rpc(name, args) {
    if (available === false) return null;
    const { data, error } = await sb.rpc(name, args || {});
    if (error) {
      if (isMissing(error)) { noteMissing(); return null; }
      throw error;
    }
    available = true;
    return data;
  }

  /* ---------------------------------------------------------------- *
   * Følging
   * ---------------------------------------------------------------- */

  /** { followers, following, is_following, follows_you } for én spiller. */
  async function followStats(userId) {
    const data = await rpc("follow_stats", { p_user_id: userId });
    return data || { followers: 0, following: 0, is_following: false, follows_you: false };
  }

  async function follow(userId) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) throw new Error("Du må være logget inn for å følge noen.");
    const { error } = await sb.from("follows").insert({ follower_id: me.id, following_id: userId });
    // 23505 = raden finnes allerede; det er ikke en feil for brukeren.
    if (error && error.code !== "23505") {
      if (isMissing(error)) { noteMissing(); return false; }
      throw error;
    }
    return true;
  }

  async function unfollow(userId) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) return false;
    const { error } = await sb
      .from("follows")
      .delete()
      .eq("follower_id", me.id)
      .eq("following_id", userId);
    if (error) {
      if (isMissing(error)) { noteMissing(); return false; }
      throw error;
    }
    return true;
  }

  /** Id-ene til alle den innloggede følger – brukes av vennerangeringen. */
  async function followingIds() {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) return [];
    const { data, error } = await sb.from("follows").select("following_id").eq("follower_id", me.id);
    if (error) {
      if (isMissing(error)) noteMissing();
      return [];
    }
    return (data || []).map((r) => r.following_id);
  }

  async function block(userId) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) throw new Error("Du må være logget inn.");
    const { error } = await sb.from("user_blocks").insert({ blocker_id: me.id, blocked_id: userId });
    if (error && error.code !== "23505") {
      if (isMissing(error)) { noteMissing(); return false; }
      throw error;
    }
    return true;
  }

  async function unblock(userId) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) return false;
    const { error } = await sb
      .from("user_blocks").delete().eq("blocker_id", me.id).eq("blocked_id", userId);
    if (error && !isMissing(error)) throw error;
    return true;
  }

  async function isBlocked(userId) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) return false;
    const { data, error } = await sb
      .from("user_blocks").select("blocked_id")
      .eq("blocker_id", me.id).eq("blocked_id", userId).maybeSingle();
    if (error) return false;
    return !!data;
  }

  /* ---------------------------------------------------------------- *
   * Meldinger
   * ---------------------------------------------------------------- */

  async function threads() {
    return (await rpc("dm_threads")) || [];
  }

  async function unreadCount() {
    const n = await rpc("dm_unread_count");
    return Number(n) || 0;
  }

  async function markRead(otherId) {
    return await rpc("dm_mark_read", { p_other: otherId });
  }

  async function send(recipientId, body) {
    const { data, error } = await sb.rpc("send_direct_message", {
      p_recipient: recipientId,
      p_body: body,
    });
    if (error) {
      if (isMissing(error)) { noteMissing(); throw new Error("Meldinger er ikke satt opp ennå."); }
      // Feilmeldingene fra RPC-en er allerede skrevet for å vises som de er.
      throw new Error(error.message || "Klarte ikke sende meldingen.");
    }
    return data;
  }

  /** Meldingene i én samtale, eldste først. */
  async function conversation(otherId, limit) {
    const session = await sb.auth.getSession();
    const me = session.data.session && session.data.session.user;
    if (!me) return [];
    const key = [me.id, otherId].sort().join(":");
    const { data, error } = await sb
      .from("direct_messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .eq("thread_key", key)
      .order("created_at", { ascending: false })
      .limit(limit || 100);
    if (error) {
      if (isMissing(error)) noteMissing();
      return [];
    }
    return (data || []).reverse();
  }

  /* ---------------------------------------------------------------- *
   * Aktivitet og søk
   * ---------------------------------------------------------------- */

  async function feed(limit) {
    return (await rpc("following_feed", { p_limit: limit || 30 })) || [];
  }

  async function findPlayers(query, limit) {
    return (await rpc("find_players", { p_query: query || "", p_limit: limit || 10 })) || [];
  }

  async function profileByUsername(username) {
    const { data, error } = await sb
      .from("profiles_public")
      .select("*")
      .ilike("username", username)
      .maybeSingle();
    if (error) return null;
    return data;
  }

  /* ---------------------------------------------------------------- *
   * Uleste-prikk i toppmenyen
   * ---------------------------------------------------------------- */

  /**
   * Setter en liten prikk på «Meldinger» i toppmenyen når det ligger uleste.
   * Kalles av js/auth.js hver gang headeren tegnes, slik at tallet er ferskt
   * uansett hvilken side man står på.
   */
  async function refreshUnreadBadge() {
    const link = document.querySelector("[data-dm-badge]");
    if (!link) return;
    const session = await sb.auth.getSession();
    if (!session.data.session) {
      link.hidden = true;
      return;
    }
    let n = 0;
    try {
      n = await unreadCount();
    } catch (e) {
      n = 0;
    }
    link.hidden = n <= 0;
    link.textContent = n > 9 ? "9+" : String(n);
  }

  /** Kort, norsk «for 3 min siden»-tekst. */
  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return "nå nettopp";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min siden`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} t siden`;
    const d = Math.round(h / 24);
    if (d === 1) return "i går";
    if (d < 7) return `${d} dager siden`;
    return new Date(iso).toLocaleDateString("no-NO", { day: "numeric", month: "short" });
  }

  /** Escaper tekst skrevet av andre brukere før den settes inn som HTML. */
  function escapeHTML(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.StudillaSocial = {
    followStats, follow, unfollow, followingIds,
    block, unblock, isBlocked,
    threads, unreadCount, markRead, send, conversation,
    feed, findPlayers, profileByUsername,
    refreshUnreadBadge, timeAgo, escapeHTML,
    isAvailable: () => available !== false,
  };
})();
