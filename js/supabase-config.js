/**
 * Supabase-oppsett for PixelPlay.
 *
 * Fyll inn dine egne verdier under (Supabase-dashbord → Project Settings → API).
 * Disse to verdiene er trygge å ha i klientkoden – det er den offentlige
 * "anon"-nøkkelen, ikke service_role-nøkkelen. Tilgangskontroll håndteres av
 * Row Level Security-reglene i supabase/schema.sql, ikke av å skjule nøkkelen.
 *
 * Se SUPABASE_SETUP.md for full oppsettsguide.
 */

window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";

if (
  window.SUPABASE_URL.includes("YOUR-PROJECT-REF") ||
  window.SUPABASE_ANON_KEY.includes("YOUR-PUBLIC-ANON-KEY")
) {
  console.warn(
    "[PixelPlay] Supabase er ikke konfigurert ennå – fyll inn SUPABASE_URL og SUPABASE_ANON_KEY i js/supabase-config.js (se SUPABASE_SETUP.md)."
  );
}

window.supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);
