/**
 * Studilla – samtykkestyring for informasjonskapsler (cookies).
 *
 * Lagrer brukerens valg i localStorage og styrer om statistikk-
 * (Google Analytics) og markedsføringstagger (Google Ads) lastes inn,
 * via Googles "Consent Mode v2". Denne filen må lastes FØR eventuelle
 * andre analyse-/annonsescript, slik at samtykke-standarden ("denied")
 * er satt før noe måles.
 *
 * Fyll inn ekte ID-er her når de finnes:
 */
const STUDILLA_GA_MEASUREMENT_ID = ""; // f.eks. "G-XXXXXXXXXX" (Google Analytics 4)
const STUDILLA_GOOGLE_ADS_ID = ""; // f.eks. "AW-XXXXXXXXX" (Google Ads / konverteringssporing)

(function () {
  "use strict";

  const STORAGE_KEY = "studilla_cookie_consent";

  function readStoredConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        necessary: true,
        stats: !!parsed.stats,
        marketing: !!parsed.marketing,
        ts: parsed.ts || Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;

  // Sett "denied" som standard for alt utover det som er strengt nødvendig,
  // helt til brukeren har tatt et valg. Dette er Googles anbefalte oppsett
  // for Consent Mode v2.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500
  });
  gtag("set", "url_passthrough", true);

  let tagsLoaded = false;

  function loadGoogleTags() {
    if (tagsLoaded) return;
    if (!STUDILLA_GA_MEASUREMENT_ID && !STUDILLA_GOOGLE_ADS_ID) return;
    tagsLoaded = true;

    const primaryId = STUDILLA_GA_MEASUREMENT_ID || STUDILLA_GOOGLE_ADS_ID;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(primaryId);
    document.head.appendChild(script);

    gtag("js", new Date());
    if (STUDILLA_GA_MEASUREMENT_ID) gtag("config", STUDILLA_GA_MEASUREMENT_ID);
    if (STUDILLA_GOOGLE_ADS_ID) gtag("config", STUDILLA_GOOGLE_ADS_ID);
  }

  function applyConsent(consent) {
    gtag("consent", "update", {
      analytics_storage: consent.stats ? "granted" : "denied",
      ad_storage: consent.marketing ? "granted" : "denied",
      ad_user_data: consent.marketing ? "granted" : "denied",
      ad_personalization: consent.marketing ? "granted" : "denied"
    });
    if (consent.stats || consent.marketing) loadGoogleTags();
  }

  const StudillaConsent = {
    STORAGE_KEY: STORAGE_KEY,

    get() {
      return readStoredConsent();
    },

    hasChoice() {
      return readStoredConsent() !== null;
    },

    save(choice) {
      const consent = {
        necessary: true,
        stats: !!choice.stats,
        marketing: !!choice.marketing,
        ts: Date.now()
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
      } catch (e) {
        /* localStorage utilgjengelig (privat modus e.l.) – samtykket varer da kun denne sidevisningen */
      }
      applyConsent(consent);
      window.dispatchEvent(new CustomEvent("studilla:consent-changed", { detail: consent }));
      return consent;
    },

    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    }
  };

  window.StudillaConsent = StudillaConsent;

  const existing = readStoredConsent();
  if (existing) applyConsent(existing);
})();
