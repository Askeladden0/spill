/**
 * Studilla – teller klikk på «Bruk koden»-knappen (adminpanelets
 * Rabattkoder-statistikk, se supabase/schema.sql seksjon 74). Lenkene merkes
 * med data-use-brand/data-use-title; klikket sendes til RPC-en
 * track_reward_use_click, som kun lagrer hvilken rabatt det gjaldt – ingen
 * bruker- eller besøkerdata. Feiler stille: lenken åpnes uansett.
 */
(function () {
  "use strict";

  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest("a.case-reveal-use[data-use-brand]");
    if (!link) return;
    const sb = window.supabaseClient;
    if (!sb) return;
    try {
      Promise.resolve(sb.rpc("track_reward_use_click", {
        p_brand: link.dataset.useBrand,
        p_title: link.dataset.useTitle,
      })).catch(() => {});
    } catch (err) {}
  });
})();
