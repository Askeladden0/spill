/**
 * Studilla – enkel, anonym besøksmåling for adminpanelets "aktive personer i
 * dag" (Oversikt/Statistikk, se js/admin.js og supabase/schema.sql seksjon
 * 46). Registrerer maks én rad per dag per besøker i public.site_visits, med
 * en tilfeldig id lagret i localStorage – ikke bare innloggede brukere.
 *
 * Krever samtykke til statistikk-informasjonskapsler (js/consent.js) før noe
 * lagres, i tråd med resten av cookie-samtykket på siden. Feiler stille hvis
 * Supabase/tabellen ikke er tilgjengelig – dette er ikke kritisk funksjonalitet.
 */
(function () {
  "use strict";

  const VISITOR_ID_KEY = "studilla_visitor_id";
  const LAST_PING_KEY = "studilla_last_visit_ping";

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function getVisitorId() {
    try {
      let id = window.localStorage.getItem(VISITOR_ID_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(VISITOR_ID_KEY, id);
      }
      return id;
    } catch (e) {
      return null; // privat nettleservindu e.l. – hopper over måling denne økten
    }
  }

  async function ping() {
    const consent = window.StudillaConsent && window.StudillaConsent.get();
    if (!consent || !consent.stats) return;

    const day = todayISO();
    try {
      if (window.localStorage.getItem(LAST_PING_KEY) === day) return;
    } catch (e) {}

    const visitorId = getVisitorId();
    const sb = window.supabaseClient;
    if (!visitorId || !sb) return;

    let userId = null;
    try {
      const { data } = await sb.auth.getSession();
      userId = (data && data.session && data.session.user && data.session.user.id) || null;
    } catch (e) {}

    try {
      const { error } = await sb
        .from("site_visits")
        .upsert({ visitor_id: visitorId, day, user_id: userId }, { onConflict: "visitor_id,day", ignoreDuplicates: true });
      if (!error) {
        try { window.localStorage.setItem(LAST_PING_KEY, day); } catch (e) {}
      }
    } catch (e) {
      // Tabellen finnes kanskje ikke ennå (schema.sql ikke kjørt på nytt), eller
      // nettverket svikter – besøkstelling skal aldri velte resten av siden.
    }
  }

  ping();
  window.addEventListener("studilla:consent-changed", ping);
})();
