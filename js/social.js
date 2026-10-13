/**
 * Studilla – det sosiale laget: venner, meldinger, gruppechatter og
 * blokkering.
 *
 * Alt som skriver noe går gjennom RPC-er i supabase/schema.sql (seksjon
 * 50–63), ikke gjennom rå tabellskriving, slik at blokkering, fartsgrenser og
 * «kun fra dem jeg følger» håndheves samme sted uansett hvilken side som
 * kaller det.
 *
 * Vennskap er gjensidig: man sender en forespørsel med «Legg til venn», og
 * den andre godtar eller avslår. Selve vennskapet lagres fortsatt som to
 * rader i follows (én hver vei), slik at vennerangeringen og resten som
 * allerede leste den tabellen fungerer uendret.
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
      "på nytt (seksjon 50–63) for å slå på venner, meldinger, gruppechatter og " +
      "vennerangeringen."
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

  /** Den innloggede brukerens id, eller null. */
  async function myId() {
    const session = await sb.auth.getSession();
    const user = session.data.session && session.data.session.user;
    return user ? user.id : null;
  }

  /* ---------------------------------------------------------------- *
   * Venner
   * ---------------------------------------------------------------- */

  /**
   * { friends, is_friend, request_outgoing, request_incoming, is_blocked }
   * for én spiller. Ett kall, siden dette vises på hver eneste spillerprofil.
   */
  async function friendStats(userId) {
    const data = await rpc("friend_stats", { p_user_id: userId });
    return data || {
      friends: 0, is_friend: false,
      request_outgoing: false, request_incoming: false, is_blocked: false,
    };
  }

  /** Sender en venneforespørsel. Gir "friends" hvis dere ble venner direkte. */
  async function addFriend(userId) {
    const { data, error } = await sb.rpc("send_friend_request", { p_user: userId });
    if (error) {
      if (isMissing(error)) { noteMissing(); throw new Error("Venner er ikke satt opp ennå."); }
      throw new Error(error.message || "Klarte ikke sende venneforespørselen.");
    }
    return data;
  }

  async function respondFriendRequest(userId, accept) {
    const { data, error } = await sb.rpc("respond_friend_request", {
      p_requester: userId,
      p_accept: !!accept,
    });
    if (error) throw new Error(error.message || "Klarte ikke svare på forespørselen.");
    return data;
  }

  async function cancelFriendRequest(userId) {
    return await rpc("cancel_friend_request", { p_user: userId });
  }

  async function removeFriend(userId) {
    return await rpc("remove_friend", { p_user: userId });
  }

  async function incomingRequests() {
    return (await rpc("friend_requests_incoming")) || [];
  }

  async function outgoingRequests() {
    return (await rpc("friend_requests_outgoing")) || [];
  }

  async function friendsList() {
    return (await rpc("friends_list")) || [];
  }

  /** Bare id-ene til vennene dine – brukes av vennerangeringen. */
  async function friendIds() {
    return (await friendsList()).map((r) => r.user_id);
  }

  /** Aktiviteten til én spiller – vises på spillerprofilen. */
  async function playerActivity(userId, limit) {
    return (await rpc("player_activity", { p_user_id: userId, p_limit: limit || 15 })) || [];
  }

  /* ---------------------------------------------------------------- *
   * Blokkering
   * ---------------------------------------------------------------- */

  async function block(userId) {
    const me = await myId();
    if (!me) throw new Error("Du må være logget inn.");
    const { error } = await sb.from("user_blocks").insert({ blocker_id: me, blocked_id: userId });
    if (error && error.code !== "23505") {
      if (isMissing(error)) { noteMissing(); return false; }
      throw error;
    }
    // Blokkering avslutter også et eventuelt vennskap og en ubesvart
    // forespørsel – ellers blir man stående i hverandres lister.
    try { await removeFriend(userId); } catch (e) { /* blokkeringen er det viktige */ }
    return true;
  }

  async function unblock(userId) {
    const me = await myId();
    if (!me) return false;
    const { error } = await sb
      .from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", userId);
    if (error && !isMissing(error)) throw error;
    return true;
  }

  async function isBlocked(userId) {
    const me = await myId();
    if (!me) return false;
    const { data, error } = await sb
      .from("user_blocks").select("blocked_id")
      .eq("blocker_id", me).eq("blocked_id", userId).maybeSingle();
    if (error) return false;
    return !!data;
  }

  /** De du har blokkert, med brukernavn og profilbilde. */
  async function blockedUsers() {
    return (await rpc("my_blocked_users")) || [];
  }

  /* ---------------------------------------------------------------- *
   * Meldinger – to parter
   * ---------------------------------------------------------------- */

  async function threads() {
    return (await rpc("dm_threads")) || [];
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
    const me = await myId();
    if (!me) return [];
    const key = [me, otherId].sort().join(":");
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
   * Gruppechatter
   * ---------------------------------------------------------------- */

  async function createGroup(name, memberIds) {
    const { data, error } = await sb.rpc("create_group_chat", {
      p_name: name,
      p_members: memberIds,
    });
    if (error) {
      if (isMissing(error)) { noteMissing(); throw new Error("Gruppechatter er ikke satt opp ennå."); }
      throw new Error(error.message || "Klarte ikke opprette gruppa.");
    }
    return data;
  }

  async function groupThreads() {
    return (await rpc("group_threads")) || [];
  }

  async function groupConversation(groupId, limit) {
    return (await rpc("group_conversation", { p_group: groupId, p_limit: limit || 100 })) || [];
  }

  async function sendGroupMessage(groupId, body) {
    const { data, error } = await sb.rpc("send_group_message", { p_group: groupId, p_body: body });
    if (error) {
      if (isMissing(error)) { noteMissing(); throw new Error("Gruppechatter er ikke satt opp ennå."); }
      throw new Error(error.message || "Klarte ikke sende meldingen.");
    }
    return data;
  }

  async function groupMarkRead(groupId) {
    return await rpc("group_mark_read", { p_group: groupId });
  }

  async function groupMembers(groupId) {
    return (await rpc("group_member_list", { p_group: groupId })) || [];
  }

  async function addGroupMembers(groupId, memberIds) {
    return await rpc("add_group_members", { p_group: groupId, p_members: memberIds });
  }

  async function leaveGroup(groupId) {
    return await rpc("leave_group_chat", { p_group: groupId });
  }

  /* ---------------------------------------------------------------- *
   * Vedlegg i meldinger
   * ---------------------------------------------------------------- *
   *
   * En melding kan ha ett vedlegg: et triks å spille, en guide å lese
   * eller en rekord å slå. Vedlegget ligger som et lite merke helt først
   * i meldingsteksten («[[v:spill|2048]] slå denne da»), slik at det
   * fungerer med den samme send_direct_message-RPC-en og den samme
   * kolonnen som vanlige meldinger – ingen ny migrasjon trengs. Klienten
   * plukker merket av igjen og tegner det som et kort over teksten.
   */

  const ATTACH_RE = /^\[\[v:(spill|guide|rekord)\|([^|\]]{1,120})(?:\|([^|\]]{0,32}))?\]\]\s*/;

  /** Deler en lagret meldingstekst i { attachment, text }. */
  function parseBody(body) {
    const raw = String(body == null ? "" : body);
    const m = ATTACH_RE.exec(raw);
    if (!m) return { attachment: null, text: raw };
    return {
      attachment: { kind: m[1], ref: m[2], value: m[3] || "" },
      text: raw.slice(m[0].length),
    };
  }

  /** Setter sammen vedlegg + fritekst til den teksten som lagres. */
  function buildBody(attachment, text) {
    const t = String(text == null ? "" : text).trim();
    if (!attachment) return t;
    const value = attachment.value ? `|${attachment.value}` : "";
    return `[[v:${attachment.kind}|${attachment.ref}${value}]]${t ? " " + t : ""}`;
  }

  /* ---------------------------------------------------------------- *
   * Søk
   * ---------------------------------------------------------------- */

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
   * Uleste – prikk i toppmenyen og sprettoppvarsel
   * ---------------------------------------------------------------- */

  /**
   * Antall uleste, både vanlige meldinger og gruppemeldinger. Faller
   * tilbake til dm_unread_count på databaser der gruppechattene ikke er
   * migrert inn ennå.
   */
  async function unreadCount() {
    const { data, error } = await sb.rpc("chat_unread_count");
    if (!error) { available = true; return Number(data) || 0; }
    if (!isMissing(error)) throw error;
    const n = await rpc("dm_unread_count");
    return Number(n) || 0;
  }

  /** De nyeste uleste meldingene – brukes av sprettoppvarselet. */
  async function recentUnread(limit) {
    return (await rpc("recent_unread_messages", { p_limit: limit || 5 })) || [];
  }

  /**
   * Setter en liten prikk på «Venner» i toppmenyen når det ligger uleste.
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
    myId,
    friendStats, addFriend, respondFriendRequest, cancelFriendRequest, removeFriend,
    incomingRequests, outgoingRequests, friendsList, friendIds, playerActivity,
    block, unblock, isBlocked, blockedUsers,
    threads, unreadCount, recentUnread, markRead, send, conversation,
    createGroup, groupThreads, groupConversation, sendGroupMessage,
    groupMarkRead, groupMembers, addGroupMembers, leaveGroup,
    parseBody, buildBody,
    findPlayers, profileByUsername,
    refreshUnreadBadge, timeAgo, escapeHTML,
    isAvailable: () => available !== false,
  };
})();
