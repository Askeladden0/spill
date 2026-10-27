/**
 * Studilla – «Hvordan spille»-forklaringer for hvert spill.
 * Brukes av forsiden (dagens spill) og spillsiden (player.html).
 * window.StudillaHowTo.get(id)  -> { intro, steps[] } eller null
 * window.StudillaHowTo.open(id) -> åpner forklaringen i en dialog
 */
(function () {
  "use strict";

  const HOWTO = {
    "tallkombo": {
      intro: "Slå sammen brikker med like tall til du lager 2048-brikken.",
      steps: [
        "Skyv alle brikkene i en retning med piltastene, eller sveip på mobil.",
        "Når to brikker med samme tall treffer hverandre, smelter de sammen og tallet dobles.",
        "Etter hvert trekk dukker det opp en ny brikke. Spillet er over når brettet er fullt og ingen brikker kan slås sammen."
      ]
    },
    fruktfusjon: {
      intro: "Slå sammen like frukter til større og større frukter.",
      steps: [
        "Flytt fingeren eller musen for å velge hvor frukten skal falle, og slipp den ned i krukken.",
        "Når to like frukter treffer hverandre, smelter de sammen til en større frukt og gir poeng.",
        "Ikke la haugen vokse over kanten av krukken, da er spillet over."
      ]
    },
    "puslespill": {
      intro: "Fyll hele rader med fallende klosser for å fjerne dem.",
      steps: [
        "Flytt klossen sideveis med venstre/høyre piltast, og roter den med pil opp.",
        "Pil ned får klossen til å falle raskere. På mobil bruker du sveip og trykk.",
        "Hver rad uten hull forsvinner og gir poeng. Spillet er over når klossene stabler seg helt til toppen."
      ]
    },
    "blokksprenging": {
      intro: "Plasser blokker på brettet og fyll hele rader eller kolonner.",
      steps: [
        "Dra en av de tre blokkene nederst og slipp den på et ledig sted på brettet.",
        "Fyll en hel rad eller kolonne for å sprenge den og tjene poeng.",
        "Blokkene kan ikke roteres. Spillet er over når ingen av blokkene lenger får plass."
      ]
    },
    "slangen": {
      intro: "Styr slangen, spis maten og bli lengst mulig.",
      steps: [
        "Trykk en piltast (eller sveip på mobil) for å starte, og styr slangen på samme måte.",
        "Hver gang slangen spiser, vokser den og du får poeng.",
        "Unngå å kjøre inn i veggen eller i deg selv, da er spillet over."
      ]
    },
    "boblekanonen": {
      intro: "Skyt bobler og sprett grupper med samme farge.",
      steps: [
        "Sikt med musen eller fingeren og slipp for å skyte en boble.",
        "Treffer du tre eller flere bobler i samme farge, spretter de og gir poeng.",
        "Ikke la boblene nå bunnen av brettet."
      ]
    },
    "minesveiper": {
      intro: "Finn alle rutene uten miner.",
      steps: [
        "Trykk på en rute for å åpne den. Tallet viser hvor mange miner som ligger rundt den.",
        "Høyreklikk, trykk lenge, eller slå på flaggmodus for å sette et flagg der du tror det er en mine.",
        "Åpne alle trygge ruter for å vinne. Treffer du en mine, er spillet over."
      ]
    },
    "fire-pa-rad": {
      intro: "Få fire brikker på rad før motstanderen gjør det – mot AI-en eller en venn online.",
      steps: [
        "Trykk på en kolonne for å slippe en brikke ned i den.",
        "Fire på rad vannrett, loddrett eller diagonalt vinner.",
        "Mot AI-en: jo færre trekk du bruker på å vinne, jo flere poeng får du.",
        "Mot en venn: velg «Mot en venn online» og send lenken, eller utfordre fra Meldinger. Online-kamper gir ikke poeng."
      ]
    },
    "senke-skip": {
      intro: "Senk hele motstanderens flåte før motstanderen senker din – mot AI-en eller en venn online.",
      steps: [
        "Plasser de fem skipene dine på brettet. Trykk «Roter» for å legge dem på høykant, eller «Tilfeldig» for å la datamaskinen gjøre det.",
        "Trykk på en rute i motstanderens farvann for å skyte. Rød rute er treff, hvit prikk er bom.",
        "Et skip er senket når alle rutene er truffet. Den som først senker alle fem, vinner.",
        "Mot AI-en: jo færre skudd du bruker, jo flere poeng får du. Mot en venn: velg «Mot en venn online» og send lenken. Online-kamper gir ikke poeng."
      ]
    },
    dama: {
      intro: "Ta alle motstanderens brikker, eller stenge dem inne – mot AI-en eller en venn online.",
      steps: [
        "Trykk på en brikke og så på et markert felt. Brikker går ett felt diagonalt fremover.",
        "Hopp over en motstander for å ta den. Du må slå når du kan, og kan du slå igjen etter hoppet, må du fortsette.",
        "Når en brikke når motstanderens bakerste rad, blir den en dame og kan gå og slå i alle retninger.",
        "Mot AI-en: jo flere brikker du har igjen, jo flere poeng. Mot en venn: velg «Mot en venn online» og send lenken. Online-kamper gir ikke poeng."
      ]
    },
    papirkomet: {
      intro: "Fly romskipet Polaris gjennom asteroidene.",
      steps: [
        "Trykk, klikk eller bruk mellomrom for å tenne motoren.",
        "Fly gjennom åpningen mellom asteroidesøylene for å få poeng.",
        "Treffer du en asteroide eller bakken, er runden over."
      ]
    }
  };

  function get(id) { return HOWTO[id] || null; }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function listHtml(h) {
    return `<ol class="howto-steps">${h.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
  }

  function injectStyle() {
    if (document.getElementById("howto-style")) return;
    const st = document.createElement("style");
    st.id = "howto-style";
    st.textContent = `
      .howto-steps{margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6;color:var(--muted)}
      .hero-howto{max-width:44ch;margin:0 0 16px;font-size:14px;color:var(--text,#fff)}.hero-howto strong{display:block;margin-bottom:4px}
      .howto-btn{background:transparent;border:1px solid var(--border,#444);border-radius:10px;color:var(--text,#fff);font:inherit;font-size:13px;padding:8px 12px;cursor:pointer;white-space:nowrap}
      .howto-link{background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
      .howto-dialog{max-width:min(440px,calc(100vw - 32px));border:1px solid var(--border,#333);border-radius:14px;padding:22px;background:var(--surface,#1b1824);color:var(--text,#fff)}
      .howto-dialog::backdrop{background:rgba(0,0,0,.6)}
      .howto-dialog h2{margin:0 0 6px;font-size:18px}
      .howto-dialog p{margin:0 0 12px;font-size:14px;color:var(--muted)}
    `;
    document.head.appendChild(st);
  }

  function open(id) {
    const h = get(id);
    if (!h) return;
    injectStyle();
    const games = window.STUDILLA_GAMES || [];
    const g = games.find((x) => x.id === id);
    const dlg = document.createElement("dialog");
    dlg.className = "howto-dialog";
    dlg.innerHTML = `<h2>Hvordan spille${g ? " " + esc(g.name) : ""}</h2><p>${esc(h.intro)}</p>${listHtml(h)}<button type="button" class="btn-primary" data-howto-close>Skjønner</button>`;
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-howto-close]")) dlg.close();
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  injectStyle();
  window.StudillaHowTo = { get, open, listHtml, injectStyle };
})();
