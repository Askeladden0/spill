/**
 * Dilla – delt figur-avatar-system.
 * Erstatter de gamle emoji-avatarene med tegnede figurer (samme sett som i
 * Profil ny.dc.html). avatar_icon i profiles lagrer nå en av FIGURE_KEYS
 * (f.eks. "robot") i stedet for et emoji-tegn, og avatar_color er fortsatt
 * en hex-farge. Brukes av js/auth.js (avatarHTML), profil.html,
 * spillerprofil.html og admin.html slik at figuren tegnes likt overalt.
 */
(function () {
  "use strict";

  const HOLE_FILL = "#0d1117";

  const FIGURES = {
    robot: {
      label: "Robo",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["rect", { x: 3.4, y: 3, width: 17.2, height: 14.6, rx: 5 }],
        ["rect", { x: 11.3, y: 0.2, width: 1.4, height: 3.2, rx: 0.7 }],
        ["circle", { cx: 12, cy: 0.9, r: 1.3 }],
        ["rect", { x: 7, y: 8, width: 3.6, height: 3.6, rx: 1.2, hole: true }],
        ["rect", { x: 13.4, y: 8, width: 3.6, height: 3.6, rx: 1.2, hole: true }],
        ["rect", { x: 8.8, y: 13.6, width: 6.4, height: 1.7, rx: 0.85, hole: true }],
      ],
    },
    katt: {
      label: "Katt",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["polygon", { points: "4.4,7.6 6.2,0.6 11.4,5.4" }],
        ["polygon", { points: "19.6,7.6 17.8,0.6 12.6,5.4" }],
        ["circle", { cx: 12, cy: 10.2, r: 8 }],
        ["circle", { cx: 8.9, cy: 9.4, r: 1.7, hole: true }],
        ["circle", { cx: 15.1, cy: 9.4, r: 1.7, hole: true }],
        ["polygon", { points: "10.8,12.6 13.2,12.6 12,14.4", hole: true }],
        ["rect", { x: 9.4, y: 15, width: 5.2, height: 1.3, rx: 0.65, hole: true }],
      ],
    },
    spoke: {
      label: "Spøkelse",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["circle", { cx: 12, cy: 10.2, r: 8 }],
        ["ellipse", { cx: 8.9, cy: 9.2, rx: 1.8, ry: 2.4, hole: true }],
        ["ellipse", { cx: 15.1, cy: 9.2, rx: 1.8, ry: 2.4, hole: true }],
        ["ellipse", { cx: 12, cy: 14.4, rx: 2.4, ry: 1.9, hole: true }],
      ],
    },
    alien: {
      label: "Romvesen",
      shapes: [
        ["rect", { x: 4, y: 19, width: 16, height: 7.5, rx: 3.5 }],
        ["ellipse", { cx: 12, cy: 10.4, rx: 7.8, ry: 8.6 }],
        ["rect", { x: 11.4, y: 0.2, width: 1.2, height: 2.6, rx: 0.6 }],
        ["ellipse", { cx: 8.4, cy: 10.2, rx: 2.1, ry: 3.4, hole: true }],
        ["ellipse", { cx: 15.6, cy: 10.2, rx: 2.1, ry: 3.4, hole: true }],
        ["rect", { x: 10.6, y: 15.6, width: 2.8, height: 1.2, rx: 0.6, hole: true }],
      ],
    },
    fugl: {
      label: "Fugl",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["circle", { cx: 12, cy: 10.2, r: 8 }],
        ["circle", { cx: 9, cy: 8.6, r: 2.6, hole: true }],
        ["circle", { cx: 15.4, cy: 9.2, r: 1.3, hole: true }],
        ["polygon", { points: "11.6,11.6 16.4,13.4 11.6,15.4", hole: true }],
      ],
    },
    bjorn: {
      label: "Bjørn",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["circle", { cx: 5.4, cy: 4.6, r: 3.4 }],
        ["circle", { cx: 18.6, cy: 4.6, r: 3.4 }],
        ["circle", { cx: 12, cy: 10.6, r: 8 }],
        ["circle", { cx: 9, cy: 9.4, r: 1.5, hole: true }],
        ["circle", { cx: 15, cy: 9.4, r: 1.5, hole: true }],
        ["ellipse", { cx: 12, cy: 14, rx: 3.2, ry: 2.4, hole: true }],
        ["ellipse", { cx: 12, cy: 13.2, rx: 1.1, ry: 0.8 }],
      ],
    },
    krystall: {
      label: "Tulling",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["circle", { cx: 12, cy: 10.2, r: 8 }],
        ["circle", { cx: 8.8, cy: 8.8, r: 1.9, hole: true }],
        ["rect", { x: 12.8, y: 8.4, width: 4, height: 1.6, rx: 0.8, hole: true }],
        ["rect", { x: 8.4, y: 12.6, width: 7, height: 1.9, rx: 0.95, hole: true }],
        ["rect", { x: 10.6, y: 13.6, width: 2.8, height: 4, rx: 1.4, hole: true }],
      ],
    },
    blekk: {
      label: "Monster",
      shapes: [
        ["rect", { x: 2, y: 18.4, width: 20, height: 8, rx: 4 }],
        ["polygon", { points: "5.6,4 8.8,5.4 6.6,1.4" }],
        ["polygon", { points: "18.4,4 15.2,5.4 17.4,1.4" }],
        ["circle", { cx: 12, cy: 10.8, r: 8 }],
        ["circle", { cx: 8.3, cy: 9.4, r: 1.8, hole: true }],
        ["circle", { cx: 12, cy: 7.4, r: 1.4, hole: true }],
        ["circle", { cx: 15.7, cy: 9.4, r: 1.8, hole: true }],
        ["rect", { x: 8.2, y: 13, width: 7.6, height: 2.4, rx: 1.2, hole: true }],
        ["rect", { x: 10, y: 13, width: 1.3, height: 1.1 }],
        ["rect", { x: 12.7, y: 13, width: 1.3, height: 1.1 }],
      ],
    },
  };

  const FIGURE_KEYS = Object.keys(FIGURES);
  const DEFAULT_FIGURE = "robot";
  const DEFAULT_COLORS = ["#2ee87f", "#38bdf8", "#a78bfa", "#f472b6", "#ffd166", "#fb923c", "#ff9385", "#e8edf5"];

  function attrsToString(attrs) {
    return Object.keys(attrs)
      .map((k) => `${k}="${attrs[k]}"`)
      .join(" ");
  }

  function figureSVG(key) {
    const spec = FIGURES[key] || FIGURES[DEFAULT_FIGURE];
    const shapes = spec.shapes
      .map(([tag, attrs]) => {
        const { hole, ...rest } = attrs;
        const fillAttr = hole ? ` fill="${HOLE_FILL}"` : "";
        return `<${tag} ${attrsToString(rest)}${fillAttr}></${tag}>`;
      })
      .join("");
    return `<svg width="100%" height="100%" viewBox="1.5 1 21 21" fill="currentColor" style="display:block">${shapes}</svg>`;
  }

  function figureLabel(key) {
    return (FIGURES[key] || FIGURES[DEFAULT_FIGURE]).label;
  }

  /**
   * Ferdig avatar-badge (farget boks med figur i) i ønsket størrelse.
   * Brukes overalt i stedet for det gamle emoji-badget.
   */
  function avatarBadgeHTML(colorHex, figureKey, size, opts) {
    const px = size || 30;
    const color = colorHex || DEFAULT_COLORS[0];
    const pad = Math.round(px * 0.16);
    const extraClass = (opts && opts.className) ? " " + opts.className : "";
    const extraAttrs = (opts && opts.attrs) || "";
    return `<span class="avatar-badge${extraClass}" style="width:${px}px;height:${px}px;background:${color};border:1px solid ${color}66;color:${HOLE_FILL};padding:${pad}px" ${extraAttrs}>${figureSVG(figureKey)}</span>`;
  }

  window.DillaAvatars = {
    FIGURES,
    FIGURE_KEYS,
    DEFAULT_FIGURE,
    DEFAULT_COLORS,
    figureSVG,
    figureLabel,
    avatarBadgeHTML,
  };
})();
