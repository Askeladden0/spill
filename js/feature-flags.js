/**
 * Studilla – sentral funksjonsbryter.
 *
 * Slår av nivå-/premiesystemet (toppmeny-widget, profil, rangering,
 * game over-kortet, nivå opp-popup og premier.html) på den live siden uten
 * å fjerne koden eller databasen bak det. Rekorder/poengsummer og
 * rangeringen for øvrig påvirkes ikke.
 *
 * Sett levelsEnabled til true for å skru nivåer/premier på igjen.
 */
window.STUDILLA_FEATURES = {
  levelsEnabled: false,
};
