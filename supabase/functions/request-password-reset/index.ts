// Studilla – "Glemt passord"-funksjon (login.html kaller denne via
// sb.functions.invoke("request-password-reset", { body: { username } })).
//
// Studilla logger inn med brukernavn + passord, ikke e-post (se js/auth.js).
// Kontoen sin faktiske innloggings-e-post er derfor alltid den interne,
// syntetiske adressen "brukernavn@brukere.studilla.no" – ingen ekte innboks.
// Brukere kan valgfritt legge inn en ekte "recovery_email" på profilen sin
// (profiles.recovery_email, se supabase/schema.sql seksjon 48). Den brukes
// KUN til å sende tilbakestillingslenken hit, aldri som innloggings-e-post.
//
// Fremgangsmåte:
//   1. Slå opp brukeren (service role – RLS gjelder ikke, så vi kan lese
//      recovery_email selv om den ikke er synlig for andre besøkende).
//   2. Har brukeren ingen recovery_email → svar "no_email" (fronten ber dem
//      kontakte admin, se SUPABASE_SETUP.md).
//   3. Har de en → be Supabase generere en ekte "recovery"-lenke for den
//      interne innloggings-e-posten (generateLink SENDER ikke noe selv – den
//      bare returnerer lenken), og send den videre til recovery_email med
//      Resend.
//
// Krever følgende secrets (sett med `supabase secrets set ...`, se
// SUPABASE_SETUP.md):
//   RESEND_API_KEY  – API-nøkkel fra resend.com (gratis nivå er nok for en
//                     liten side som dette, men domenet må verifiseres der
//                     for å kunne sende til vilkårlige mottakere).
//   SITE_URL        – f.eks. "https://studilla.no" (uten sluttskråstrek),
//                     brukes som redirect etter at lenken er klikket.
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY settes automatisk av Supabase i
// Edge Function-miljøet og trenger ikke konfigureres manuelt.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = (Deno.env.get("SITE_URL") || "https://studilla.no").replace(/\/+$/, "");
const INTERNAL_EMAIL_DOMAIN = "brukere.studilla.no";
const USERNAME_REGEX = /^[a-zA-Z0-9_]{5,20}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", message: "Method not allowed" }, 405);

  let username = "";
  try {
    const body = await req.json();
    username = String(body?.username || "").trim().toLowerCase();
  } catch {
    return json({ status: "error", message: "Ugyldig forespørsel." }, 400);
  }

  if (!USERNAME_REGEX.test(username)) {
    return json({ status: "invalid", message: "Ugyldig brukernavn." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, recovery_email")
    .ilike("username", username)
    .maybeSingle();

  if (profileError) {
    console.error("[request-password-reset] Klarte ikke slå opp profil:", profileError.message);
    return json({ status: "error", message: "Noe gikk galt. Prøv igjen." }, 500);
  }

  if (!profile) {
    return json({ status: "not_found", message: "Fant ingen bruker med dette brukernavnet." });
  }

  if (!profile.recovery_email) {
    return json({
      status: "no_email",
      message: "Denne kontoen har ikke lagt inn e-post for gjenoppretting. Kontakt admin for å tilbakestille passordet.",
    });
  }

  const loginEmail = `${username}@${INTERNAL_EMAIL_DOMAIN}`;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: loginEmail,
    options: { redirectTo: `${SITE_URL}/tilbakestill-passord.html` },
  });

  if (linkError || !link?.properties?.action_link) {
    console.error("[request-password-reset] Klarte ikke lage gjenopprettingslenke:", linkError?.message);
    return json({ status: "error", message: "Noe gikk galt. Prøv igjen." }, 500);
  }

  if (!RESEND_API_KEY) {
    console.error("[request-password-reset] RESEND_API_KEY mangler – kan ikke sende e-post.");
    return json({ status: "error", message: "Noe gikk galt. Prøv igjen." }, 500);
  }

  const actionLink = link.properties.action_link;
  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Studilla <no-reply@studilla.no>",
      to: profile.recovery_email,
      subject: "Tilbakestill passordet ditt på Studilla",
      html: `
        <p>Hei!</p>
        <p>Du (eller noen andre) ba om å tilbakestille passordet for brukeren
        <b>${username}</b> på Studilla.</p>
        <p><a href="${actionLink}">Klikk her for å velge et nytt passord</a></p>
        <p>Ba du ikke om dette selv? Da kan du bare ignorere denne e-posten –
        passordet ditt er fortsatt trygt.</p>
      `,
    }),
  });

  if (!sendRes.ok) {
    console.error("[request-password-reset] Resend svarte med feil:", await sendRes.text());
    return json({ status: "error", message: "Noe gikk galt. Prøv igjen." }, 500);
  }

  return json({ status: "sent", message: "Vi har sendt en e-post med lenke for å tilbakestille passordet." });
});
