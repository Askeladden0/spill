/**
 * Studilla – sentral funksjonsbryter.
 *
 * Slår av nivå-/premiesystemet (toppmeny-widget, profil, rangering,
 * game over-kortet, nivå opp-popup og premier.html) på den live siden uten
 * å fjerne koden eller databasen bak det. Rekorder/poengsummer og
 * rangeringen for øvrig påvirkes ikke.
 *
 * Sett levelsEnabled til true for å skru nivåer/premier på igjen.
 *
 * Av siden 26.10.2026: kassene deler ut tilfeldige rabattkoder fra
 * merkevarer (blant annet Temu, Kron og HoneyGain) til en målgruppe som i
 * stor grad er elever under 18. Står av til ordningen er vurdert – se
 * EVALUERING.md, D13 og tiltak T10. Koder brukerne alt har hentet, ligger
 * fortsatt i databasen og vises igjen når bryteren slås på.
 */
window.STUDILLA_FEATURES = {
  levelsEnabled: false,
};
