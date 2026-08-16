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

window.SUPABASE_URL = "https://dtchrzsayskizbhuqdls.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0Y2hyenNheXNraXpiaHVxZGxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjY1NjcsImV4cCI6MjEwMjQ0MjU2N30.T2zNImuxWM4E5JkqnAphpYt_NZ3biY8I4TPr6VPrmN0";

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
