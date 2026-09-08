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
 * Enkeltfiler i rota som GitHub Pages trenger, hvis de finnes. Ingen av dem
 * er i bruk i dag, men de ligger her slik at f.eks. et CNAME for eget domene
 * eller en robots.txt blir med i dist/ i stedet for å forsvinne stille den
 * dagen noen legger dem til.
 */
const COPY_ROOT_FILES = ["CNAME", ".nojekyll", "robots.txt", "sitemap.xml"];

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
  const commentEnd = lines.indexOf("-->");
  return lines.slice(commentEnd + 1).join("\n").trimEnd();
}

const headPartial = readHeadPartial().replace(
  "{{assetHashes}}",
  `<script>window.STUDILLA_ASSET_HASHES=${JSON.stringify(gameModuleHashes)};</script>`
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

function buildPage(file) {
  let html = fs.readFileSync(path.join(ROOT, file), "utf8");

  if (!html.includes(HEAD_MARKER)) {
    fail(file, `mangler head-markøren ${HEAD_MARKER} i <head>`);
    return;
  }
  html = html.replace(HEAD_MARKER, headPartial);

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
pages.forEach(buildPage);

if (errors.length) {
  console.error("\nByggefeil:\n" + errors.map((e) => "  - " + e).join("\n") + "\n");
  process.exit(1);
}

console.log(`Bygget ${pages.length} sider til dist/`);
