/**
 * Studilla – byggesteg.
 *
 * Siden er fortsatt en helt vanlig statisk nettside. Dette scriptet gjør bare
 * to ting, uten en eneste avhengighet:
 *
 *   1. Setter sammen sidene fra felles deler, slik at <head>, toppmeny og
 *      bunnmeny bare finnes ETT sted i kildekoden i stedet for å være limt
 *      inn i hver av HTML-filene.
 *   2. Legger på ?v=<innholdshash> på alle lokale css/js/asset-lenker, slik
 *      at nettlesere henter nye filer med det samme etter en utrulling.
 *
 * Resultatet havner i dist/, som er det GitHub Pages publiserer. Kildefilene
 * røres ikke.
 *
 * Kjøres med:  npm run build
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

/** Mapper som kopieres rått til dist/. */
const COPY_DIRS = ["css", "js", "assets", "documents"];

/**
 * Enkeltfiler i rota som GitHub Pages trenger, hvis de finnes. De ligger her slik at f.eks. et CNAME for eget domene
 * eller en robots.txt blir med i dist/ i stedet for å forsvinne stille den
 * dagen noen legger dem til.
 */
const COPY_ROOT_FILES = ["CNAME", ".nojekyll", "robots.txt", "ads.txt"];

/**
 * HTML-filer som IKKE er sider på nettstedet. *.dc.html er designutkast fra
 * Claude Design-lerretet og skal ikke publiseres.
 */
const isSitePage = (name) => name.endsWith(".html") && !name.endsWith(".dc.html");

/**
 * Markøren for det delte <head>-innholdet. Den er med vilje en ekte
 * stilark-lenke og ikke en kommentar: åpner man en kildefil direkte i
 * nettleseren, uten å bygge, får man fortsatt riktig design. Byggesteget
 * bytter hele taggen ut med build/partials/head.html, så stilarket havner
 * aldri to ganger i den ferdige siden.
 */
const HEAD_MARKER = '<link rel="stylesheet" href="css/style.css" data-studilla-head>';

/** Sider som trenger css/admin.css (adminpanelet og adminverktøyene på tips-sidene). */
const ADMIN_CSS_PAGES = new Set(["admin.html", "tip.html", "tips.html"]);

/** Adressen nettstedet ligger på – brukes i canonical og sitemap. */
const SITE_URL = "https://studilla.no";

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);

/* ------------------------------------------------------------------ *
 * Filhjelpere
 * ------------------------------------------------------------------ */

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

const hashOf = (relPath) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relPath))).digest("hex").slice(0, 8);

/* ------------------------------------------------------------------ *
 * 1. Innholdshash for alt som kan lenkes til
 * ------------------------------------------------------------------ */

const assetHashes = new Map();
for (const dir of COPY_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const rel of walk(abs)) assetHashes.set(rel, hashOf(rel));
}

/* ------------------------------------------------------------------ *
 * 2. Header/footer hentes fra js/layout-markup.js – samme fil som
 *    nettleseren bruker, så markupen finnes fortsatt bare ett sted.
 * ------------------------------------------------------------------ */

function loadLayoutMarkup() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ["js/feature-flags.js", "js/layout-markup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
  }
  if (!sandbox.STUDILLA_LAYOUT) throw new Error("js/layout-markup.js satte ikke STUDILLA_LAYOUT");
  return sandbox.STUDILLA_LAYOUT;
}

const LAYOUT = loadLayoutMarkup();

/* ------------------------------------------------------------------ *
 * 2b. Tipsene hentes fra Supabase, slik at hvert tips kan bli en egen
 *     statisk side (bedre for søkemotorer enn tip.html?id=…, som bare
 *     fylles med JavaScript). Bruker den offentlige anon-nøkkelen fra
 *     js/supabase-config.js – samme data enhver besøkende kan lese.
 *     Feiler hentingen, feiler bygget, så den forrige utrullingen (med
 *     artikkelsidene) blir stående i stedet for å forsvinne.
 * ------------------------------------------------------------------ */

function readSupabaseConfig() {
  const src = fs.readFileSync(path.join(ROOT, "js/supabase-config.js"), "utf8");
  const pick = (name) => (src.match(new RegExp(`window\\.${name} = "([^"]+)"`)) || [])[1];
  return { url: pick("SUPABASE_URL"), key: pick("SUPABASE_ANON_KEY") };
}

async function fetchTable(query) {
  const { url, key } = readSupabaseConfig();
  const res = await fetch(`${url}/rest/v1/${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase svarte ${res.status} på ${query.split("?")[0]}: ${await res.text()}`);
  return res.json();
}

function loadGuideRender() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/guide-render.js"), "utf8"), sandbox, { filename: "js/guide-render.js" });
  return sandbox.StudillaGuideRender;
}

async function loadArticles() {
  const [guides, modules, games] = await Promise.all([
    fetchTable("guides?select=*&is_hidden=eq.false&order=sort_order.asc"),
    fetchTable("guide_modules?select=*&order=sort_order.asc"),
    fetchTable("games?select=id,name,description,thumbnail_url&hidden=eq.false"),
  ]);

  // Filnavnet er tipsets id, som ikke endrer seg når tittelen redigeres –
  // da blir adressen Google har indeksert stående. Kolliderer den med en
  // av de faste sidene, får den et prefiks.
  const taken = new Set(fs.readdirSync(ROOT).filter(isSitePage));
  return guides.map((g) => {
    let file = `${g.id}.html`;
    if (taken.has(file)) file = `tips-${g.id}.html`;
    taken.add(file);
    return {
      guide: g,
      file,
      modules: modules.filter((m) => m.guide_id === g.id).map((m) => ({ id: m.id, type: m.type, data: m.data || {} })),
      games: games.map((x) => ({ id: x.id, name: x.name, description: x.description, thumbnail: x.thumbnail_url })),
    };
  });
}

const ARTICLES = await loadArticles();
const GUIDE_PAGES = Object.fromEntries(ARTICLES.map((a) => [a.guide.id, a.file]));

/**
 * Merker menypunktet for siden man står på, slik js/layout.js gjør i
 * nettleseren. Gjøres her også, så riktig punkt er markert allerede i
 * sidekilden i stedet for å hoppe på plass etter at JavaScript har kjørt.
 */
function markActiveNav(headerHtml, page) {
  if (!page) return headerHtml;
  return headerHtml.replace(
    new RegExp(`class="nav-link"( data-page="${page}")`, "g"),
    'class="nav-link is-active"$1'
  );
}

/* ------------------------------------------------------------------ *
 * 3. Felles <head>
 * ------------------------------------------------------------------ */

const gameModuleHashes = Object.fromEntries(
  [...assetHashes].filter(([rel]) => rel.startsWith("js/games/"))
);

/**
 * Byggkommentaren øverst i head.html er dokumentasjon for utviklere og skal
 * ikke ut på sidene, så alt til og med den første linja som er bare "-->"
 * fjernes.
 */
function readHeadPartial() {
  const lines = fs.readFileSync(path.join(ROOT, "build/partials/head.html"), "utf8").split("\n");
  const commentEnd = lines.findIndex((l) => l.trim() === "-->");
  return lines.slice(commentEnd + 1).join("\n").trimEnd();
}

const headPartial = readHeadPartial().replace(
  "{{assetHashes}}",
  `<script>window.STUDILLA_ASSET_HASHES=${JSON.stringify(gameModuleHashes)};` +
    `window.STUDILLA_GUIDE_PAGES=${JSON.stringify(GUIDE_PAGES)};</script>`
);

/* ------------------------------------------------------------------ *
 * 4. Bygg hver side
 * ------------------------------------------------------------------ */

/**
 * Legger ?v=<hash> på lokale lenker til css/js/assets. Eksterne URL-er,
 * HTML-lenker, anker og strenger som allerede har spørringstegn står i fred.
 */
function addAssetHashes(html, file) {
  return html.replace(/(\b(?:href|src)=")([^"?#]+)"/g, (whole, attr, url) => {
    if (!COPY_DIRS.some((dir) => url.startsWith(dir + "/"))) return whole;
    const hash = assetHashes.get(url);
    if (!hash) {
      fail(file, `lenker til ${url}, som ikke finnes`);
      return whole;
    }
    return `${attr}${url}?v=${hash}"`;
  });
}

function buildPage(file, html = fs.readFileSync(path.join(ROOT, file), "utf8"), opts = {}) {

  if (!html.includes(HEAD_MARKER)) {
    fail(file, `mangler head-markøren ${HEAD_MARKER} i <head>`);
    return;
  }
  // Kildesidene har de samme stilarkene etter markøren (så de ser riktige ut
  // uten bygg). Head-delen legger dem inn selv, så duplikatene fjernes her.
  html = html.replace(/<link rel="stylesheet" href="css\/(?:style|admin|pages|social)\.css">[ \t]*\r?\n/g, "");
  const adminCss = ADMIN_CSS_PAGES.has(file) || opts.adminCss ? '<link rel="stylesheet" href="css/admin.css">\n' : "";
  html = html.replace(HEAD_MARKER, headPartial.replace("{{adminCss}}", adminCss));

  // Sider uten inline-script kan trygt laste egne scripts med defer
  // (rekkefølgen bevares). Sider med inline-script bruker globaler umiddelbart.
  const hasInlineScript = /<script>/.test(html.slice(html.indexOf("</head>")));
  if (!hasInlineScript) {
    html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, '<script defer src="$1"></script>');
  }

  const page = (html.match(/<body[^>]*\bdata-page="([^"]*)"/) || [])[1] || "";

  // Toppmeny og bunnmeny skrives rett inn i HTML-en. Da finnes menylenkene i
  // sidekilden (bedre for SEO), og siden hopper ikke når JavaScript kjører.
  // js/layout.js ser at slot-ene er borte og hopper over innsettingen.
  // Ikke alle sidene har begge (admin.html har ingen av dem, player.html har
  // ingen bunnmeny), så slot-ene fylles bare når de faktisk finnes.
  html = html.replace('<div id="site-header"></div>', markActiveNav(LAYOUT.header, page).trim());
  html = html.replace('<div id="site-footer"></div>', LAYOUT.footer.trim());

  html = addAssetHashes(html, file);

  fs.writeFileSync(path.join(DIST, file), html);
}

/* ------------------------------------------------------------------ *
 * 5. Én statisk side per tips
 *
 *    Bygges fra tip.html, med innholdet ferdig tegnet av js/guide-render.js.
 *    js/guides.js kjører fortsatt på siden (likes, visninger, avstemninger og
 *    redigering for admin) og tegner over med ferske data fra Supabase.
 * ------------------------------------------------------------------ */

const Render = loadGuideRender();

/** Bytter innholdet i det første elementet som har attributtet `attr`. */
function fillSlot(html, attr, inner, file) {
  const re = new RegExp(`(<(\\w+)[^>]*\\s${attr}(?:\\s[^>]*)?>)(</\\2>)`);
  if (!re.test(html)) fail(file, `fant ikke ${attr} i tip.html`);
  return html.replace(re, (whole, open, tag, close) => open + inner + close);
}

function articleHtml({ guide: g, file, modules, games }) {
  const esc = Render.escapeHTML;
  const ctx = { isAdmin: false, games, pollVoted: () => null };
  const url = `${SITE_URL}/${file}`;
  const title = `${g.title} · Studilla`;
  const description = g.excerpt || "";
  let html = fs.readFileSync(path.join(ROOT, "tip.html"), "utf8");

  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description,
    ...(g.cover_url ? { image: g.cover_url } : {}),
    ...(g.updated_at ? { dateModified: g.updated_at } : {}),
    ...(g.created_at ? { datePublished: g.created_at } : {}),
    author: { "@type": "Person", name: "Snorre Saus" },
    publisher: { "@type": "Organization", name: "Studilla" },
    mainEntityOfPage: url,
  };

  html = html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, [
      `<meta name="description" content="${esc(description)}">`,
      `<link rel="canonical" href="${esc(url)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:site_name" content="Studilla">`,
      ...(g.cover_url ? [`<meta property="og:image" content="${esc(g.cover_url)}">`] : []),
      `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
    ].join("\n"))
    .replace('<body data-page="tips">', `<body data-page="tips" data-guide-id="${esc(g.id)}">`)
    .replace(/(<div class="guide-layout" data-guide-root) hidden>/, "$1>");

  const toc = modules
    .map((m) => ({ id: m.id, label: Render.moduleTOCLabel(m, ctx) }))
    .filter((x) => x.label)
    .map((x) => `<a href="#module-${esc(String(x.id))}" class="guide-toc-link">${esc(x.label)}</a>`)
    .join("");
  if (toc) html = html.replace(/(<div class="side-card guide-toc-card" data-guide-toc-card) hidden>/, "$1>");

  const gevinst = modules.find((m) => m.type === "gevinst");
  if (gevinst) html = html.replace(/(<div class="guide-gevinst-card" data-guide-gevinst-card) hidden>/, "$1>");

  html = fillSlot(html, "data-guide-category", esc(g.category || "Tips"), file);
  html = fillSlot(html, "data-guide-title", esc(g.title), file);
  html = fillSlot(html, "data-guide-excerpt", esc(g.excerpt || ""), file);
  html = fillSlot(html, "data-guide-updated", g.updated_at ? `Oppdatert ${esc(Render.formatDate(g.updated_at))}` : "", file);
  html = fillSlot(html, "data-guide-cover", g.cover_url ? `<img src="${esc(g.cover_url)}" alt="">` : "", file);
  html = fillSlot(html, "data-guide-modules", modules.map((m) => `
      <section class="guide-module" id="module-${esc(String(m.id))}">
        ${Render.moduleBodyHTML(m, ctx)}
      </section>`).join(""), file);
  html = fillSlot(html, "data-guide-toc", toc, file);
  if (gevinst) {
    html = fillSlot(html, "data-guide-gevinst-card", `
      <span class="guide-gevinst-side-label">Gevinstpotensial</span>
      <span class="guide-gevinst-side-amount">${Render.kr(Render.gevinstSum(gevinst.data))}</span>
      <span class="guide-gevinst-side-note">${esc(gevinst.data.note || "hvis du følger alle stegene i tipset.")}</span>
    `, file);
  }
  return html;
}

/**
 * sitemap.xml i rota lister de faste sidene. Artikkelsidene legges til her,
 * med lastmod fra Supabase, så nye tips havner i sitemap ved neste bygg.
 */
function buildSitemap() {
  const base = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const entries = ARTICLES.map(({ guide: g, file }) => {
    const lastmod = g.updated_at ? `<lastmod>${g.updated_at.slice(0, 10)}</lastmod>` : "";
    return `  <url><loc>${SITE_URL}/${file}</loc>${lastmod}</url>`;
  }).join("\n");
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), base.replace("</urlset>", `${entries}\n</urlset>`));
}

/* ------------------------------------------------------------------ *
 * Kjør
 * ------------------------------------------------------------------ */

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const dir of COPY_DIRS) {
  const abs = path.join(ROOT, dir);
  if (fs.existsSync(abs)) copyDir(abs, path.join(DIST, dir));
}

for (const file of COPY_ROOT_FILES) {
  const abs = path.join(ROOT, file);
  if (fs.existsSync(abs)) fs.copyFileSync(abs, path.join(DIST, file));
}

const pages = fs.readdirSync(ROOT).filter(isSitePage).sort();
pages.forEach((file) => buildPage(file));
ARTICLES.forEach((a) => buildPage(a.file, articleHtml(a), { adminCss: true }));
buildSitemap();

if (errors.length) {
  console.error("\nByggefeil:\n" + errors.map((e) => "  - " + e).join("\n") + "\n");
  process.exit(1);
}

console.log(`Bygget ${pages.length} sider og ${ARTICLES.length} artikkelsider til dist/`);
