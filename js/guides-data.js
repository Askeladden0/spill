/**
 * Guide-database for Studilla ("Guider og ressurser" – guider.html/guide.html).
 *
 * Samme mønster som js/games-data.js: window.STUDILLA_GUIDES starter tom og
 * fylles med ekte data fra Supabase-tabellene `guides` og
 * `guide_modules` når de er tilgjengelige. Modulene til hver guide ligger i
 * window.STUDILLA_GUIDE_MODULES, nøklet på guide-id.
 *
 * Vent på window.STUDILLA_GUIDES_READY før du render noe som er avhengig av
 * guide-data.
 *
 * Denne filen har ingen egen adminpanel-motpart – window.StudillaGuides
 * eksponerer også skrivefunksjonene (opprett/rediger/slett guide og modul,
 * last opp bilde/fil, stem i avstemning) som js/guides.js bruker til å bygge
 * redigeringskontrollene rett inn i guider.html/guide.html. RLS i
 * supabase/schema.sql sørger for at skriving faktisk krever admin uansett hva
 * klienten prøver på.
 */

// Tom fallback-liste. Tidligere lå eksempelguiden "Hvordan tjene penger på å
// sitte i elevrådet" her, og den dukket opp igjen på sidene hver gang Supabase
// svarte med feil eller tidsavbrudd – også lenge etter at den var slettet fra
// basen. Hold denne tom: ekte guider kommer fra Supabase.
window.STUDILLA_GUIDES = [];

window.STUDILLA_GUIDE_MODULES = {};

const GUIDE_IMAGE_BUCKET = "guide-images";
const GUIDE_FILE_BUCKET = "guide-files";

function mapGuideRow(g) {
  return {
    id: g.id,
    title: g.title || "",
    category: g.category || "",
    excerpt: g.excerpt || "",
    icon: g.icon || "",
    valueLabel: g.value_label || "",
    readTime: g.read_time || "",
    coverUrl: g.cover_url || null,
    featured: !!g.is_featured,
    hidden: !!g.is_hidden,
    sortOrder: g.sort_order || 0,
    updatedAt: g.updated_at || null,
    viewCount: Number(g.view_count) || 0,
    likeCount: Number(g.like_count) || 0
  };
}

function mapModuleRow(m) {
  return { id: m.id, type: m.type, sortOrder: m.sort_order || 0, data: m.data || {} };
}

async function fetchGuidesFromSupabase() {
  const sb = window.supabaseClient;
  const guidesRes = await sb.from("guides").select("*").order("sort_order", { ascending: true });
  if (guidesRes.error) return guidesRes;

  const modulesRes = await sb.from("guide_modules").select("*").order("sort_order", { ascending: true });
  if (modulesRes.error) return modulesRes;

  const byGuide = {};
  modulesRes.data.forEach((m) => {
    if (!byGuide[m.guide_id]) byGuide[m.guide_id] = [];
    byGuide[m.guide_id].push(mapModuleRow(m));
  });

  return { data: { guides: guidesRes.data.map(mapGuideRow), modulesByGuide: byGuide } };
}

window.STUDILLA_GUIDES_READY = (async function loadGuides() {
  const sb = window.supabaseClient;
  if (!sb) return window.STUDILLA_GUIDES;

  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 5000));
  const result = await Promise.race([fetchGuidesFromSupabase(), timeout]);

  if (result.timedOut) {
    console.error("[Studilla] Tidsavbrudd ved henting av guider, bruker fallback-liste.");
    return window.STUDILLA_GUIDES;
  }

  if (result.error) {
    // Tabellen finnes sannsynligvis ikke ennå (migrasjonen i supabase/schema.sql
    // er ikke kjørt). Behold fallback-listen i stedet for å vise en tom side.
    console.error("[Studilla] Klarte ikke hente guider, bruker fallback-liste:", result.error.message);
    return window.STUDILLA_GUIDES;
  }

  // Tabellen svarte uten feil – dette er den ekte tilstanden, selv om den er
  // tom (ingen guider opprettet ennå). Erstatt fallback-listen helt.
  window.STUDILLA_GUIDES.length = 0;
  window.STUDILLA_GUIDES.push(...result.data.guides);
  window.STUDILLA_GUIDE_MODULES = result.data.modulesByGuide;
  return window.STUDILLA_GUIDES;
})();

/**
 * Henter én guide + modulene sine på nytt fra Supabase og oppdaterer de
 * globale listene i place. Brukes av admin-redigeringen i js/guides.js etter
 * lagring, slik at UI-et alltid viser det som faktisk står lagret.
 */
async function refreshGuide(id) {
  const sb = window.supabaseClient;
  if (!sb) return;

  const [{ data: g, error: gErr }, { data: mods, error: mErr }] = await Promise.all([
    sb.from("guides").select("*").eq("id", id).maybeSingle(),
    sb.from("guide_modules").select("*").eq("guide_id", id).order("sort_order", { ascending: true })
  ]);

  if (!gErr && g) {
    const mapped = mapGuideRow(g);
    const i = window.STUDILLA_GUIDES.findIndex((x) => x.id === id);
    if (i === -1) window.STUDILLA_GUIDES.push(mapped);
    else window.STUDILLA_GUIDES[i] = mapped;
  } else if (!gErr && !g) {
    window.STUDILLA_GUIDES = window.STUDILLA_GUIDES.filter((x) => x.id !== id);
  }

  if (!mErr && mods) window.STUDILLA_GUIDE_MODULES[id] = mods.map(mapModuleRow);
}

async function refreshGuideList() {
  const sb = window.supabaseClient;
  if (!sb) return;
  const { data, error } = await sb.from("guides").select("*").order("sort_order", { ascending: true });
  if (!error && data) {
    window.STUDILLA_GUIDES.length = 0;
    window.STUDILLA_GUIDES.push(...data.map(mapGuideRow));
  }
}

function nextSortOrder() {
  return (Math.max(0, ...window.STUDILLA_GUIDES.map((g) => g.sortOrder || 0)) || 0) + 1;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "guide";
}

async function uniqueGuideId(title) {
  const sb = window.supabaseClient;
  const base = slugify(title);
  let id = base;
  let n = 2;
  // Sjekk både lokal liste (i tilfelle Supabase ikke er tilgjengelig) og
  // databasen, slik at id-en garantert er unik uansett hvor dataene kommer fra.
  while (
    window.STUDILLA_GUIDES.some((g) => g.id === id) ||
    (sb && (await sb.from("guides").select("id").eq("id", id).maybeSingle()).data)
  ) {
    id = `${base}-${n++}`;
  }
  return id;
}

window.StudillaGuides = {
  list() { return window.STUDILLA_GUIDES; },
  modulesFor(guideId) { return window.STUDILLA_GUIDE_MODULES[guideId] || []; },

  async createGuide(fields) {
    const sb = window.supabaseClient;
    const id = await uniqueGuideId(fields.title);
    const row = {
      id,
      title: fields.title || "Ny guide",
      category: fields.category || "",
      excerpt: fields.excerpt || "",
      icon: fields.icon || "",
      value_label: fields.valueLabel || "",
      read_time: fields.readTime || "",
      cover_url: fields.coverUrl || null,
      is_featured: false,
      is_hidden: false,
      sort_order: nextSortOrder()
    };
    const { data, error } = await sb.from("guides").insert(row).select().single();
    if (error) return { error };
    const mapped = mapGuideRow(data);
    window.STUDILLA_GUIDES.push(mapped);
    window.STUDILLA_GUIDE_MODULES[id] = [];
    return { data: mapped };
  },

  async updateGuide(id, fields) {
    const sb = window.supabaseClient;

    if (fields.featured === true) {
      // Kun én guide kan være fremhevet (håndhevet av en unik indeks i
      // schema.sql) – fjern flagget fra den forrige fremhevede guiden først,
      // ellers ville denne oppdateringen feilet på den unike indeksen.
      await sb.from("guides").update({ is_featured: false }).eq("is_featured", true).neq("id", id);
    }

    const patch = { updated_at: new Date().toISOString() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.category !== undefined) patch.category = fields.category;
    if (fields.excerpt !== undefined) patch.excerpt = fields.excerpt;
    if (fields.icon !== undefined) patch.icon = fields.icon;
    if (fields.valueLabel !== undefined) patch.value_label = fields.valueLabel;
    if (fields.readTime !== undefined) patch.read_time = fields.readTime;
    if (fields.coverUrl !== undefined) patch.cover_url = fields.coverUrl;
    if (fields.featured !== undefined) patch.is_featured = fields.featured;
    if (fields.hidden !== undefined) patch.is_hidden = fields.hidden;

    const { error } = await sb.from("guides").update(patch).eq("id", id);
    if (error) return { error };
    const g = window.STUDILLA_GUIDES.find((x) => x.id === id);
    if (g) Object.assign(g, fields);
    if (fields.featured) {
      // Klienten vet ikke selv hvilken guide som var fremhevet før – hent
      // hele lista på nytt så kun én guide vises som fremhevet i UI-et.
      await refreshGuideList();
    }
    return { data: g };
  },

  async deleteGuide(id) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("guides").delete().eq("id", id);
    if (error) return { error };
    window.STUDILLA_GUIDES = window.STUDILLA_GUIDES.filter((x) => x.id !== id);
    delete window.STUDILLA_GUIDE_MODULES[id];
    return { data: true };
  },

  async uploadCover(guideId, file) {
    return this.uploadImage(guideId, file, "cover");
  },

  /**
   * Laster opp et bilde til `guide-images`-bøtta og gir tilbake den offentlige
   * URL-en. Brukes både til toppbildet (prefix "cover") og til bilde-modulene
   * inne i guiden (prefix "bilde"), som har helt like krav til format og
   * størrelse.
   */
  async uploadImage(guideId, file, prefix) {
    const sb = window.supabaseClient;
    const allowed = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const ext = allowed[file.type];
    if (!ext) return { error: { message: "Kun PNG, JPG og WEBP er støttet." } };
    if (file.size > 5 * 1024 * 1024) return { error: { message: "Bildet er for stort (maks 5 MB)." } };

    const path = `${guideId}/${prefix || "bilde"}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(GUIDE_IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
    if (error) return { error };
    const { data: pub } = sb.storage.from(GUIDE_IMAGE_BUCKET).getPublicUrl(path);
    return { data: pub.publicUrl };
  },

  async uploadFile(guideId, file) {
    const sb = window.supabaseClient;
    if (file.size > 20 * 1024 * 1024) return { error: { message: "Filen er for stor (maks 20 MB)." } };

    const path = `${guideId}/${Date.now()}-${file.name}`;
    const { error } = await sb.storage.from(GUIDE_FILE_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: true });
    if (error) return { error };
    const { data: pub } = sb.storage.from(GUIDE_FILE_BUCKET).getPublicUrl(path);
    const ext = (file.name.split(".").pop() || "").toUpperCase().slice(0, 5);
    const kb = Math.max(1, Math.round(file.size / 1024));
    return { data: { url: pub.publicUrl, ext, sizeLabel: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB` } };
  },

  async addModule(guideId, type, data, sortOrder) {
    const sb = window.supabaseClient;
    const { data: row, error } = await sb
      .from("guide_modules")
      .insert({ guide_id: guideId, type, data, sort_order: sortOrder })
      .select()
      .single();
    if (error) return { error };
    const mapped = mapModuleRow(row);
    if (!window.STUDILLA_GUIDE_MODULES[guideId]) window.STUDILLA_GUIDE_MODULES[guideId] = [];
    window.STUDILLA_GUIDE_MODULES[guideId].push(mapped);
    return { data: mapped };
  },

  async updateModule(guideId, moduleId, data) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("guide_modules").update({ data }).eq("id", moduleId);
    if (error) return { error };
    const mod = (window.STUDILLA_GUIDE_MODULES[guideId] || []).find((m) => m.id === moduleId);
    if (mod) mod.data = data;
    return { data: mod };
  },

  async deleteModule(guideId, moduleId) {
    const sb = window.supabaseClient;
    const { error } = await sb.from("guide_modules").delete().eq("id", moduleId);
    if (error) return { error };
    window.STUDILLA_GUIDE_MODULES[guideId] = (window.STUDILLA_GUIDE_MODULES[guideId] || []).filter((m) => m.id !== moduleId);
    return { data: true };
  },

  async reorderModules(guideId, orderedIds) {
    const sb = window.supabaseClient;
    const updates = orderedIds.map((id, i) => sb.from("guide_modules").update({ sort_order: i + 1 }).eq("id", id));
    const results = await Promise.all(updates);
    const error = results.find((r) => r.error);
    if (error) return { error: error.error };
    const list = window.STUDILLA_GUIDE_MODULES[guideId] || [];
    orderedIds.forEach((id, i) => {
      const mod = list.find((m) => m.id === id);
      if (mod) mod.sortOrder = i + 1;
    });
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    return { data: true };
  },

  async votePoll(guideId, moduleId, optionIndex) {
    const sb = window.supabaseClient;
    const { data, error } = await sb.rpc("guide_vote_poll", { p_module_id: moduleId, p_option_index: optionIndex });
    if (error) return { error };
    const mod = (window.STUDILLA_GUIDE_MODULES[guideId] || []).find((m) => m.id === moduleId);
    if (mod) mod.data = data;
    return { data };
  },

  // Telles hver gang guide.html åpnes for en guide – ikke deduplisert, i
  // motsetning til den daglige besøksmålingen i js/visit-tracking.js.
  async addView(guideId) {
    const sb = window.supabaseClient;
    const { data, error } = await sb.rpc("guide_add_view", { p_guide_id: guideId });
    if (error) return { error };
    const g = window.STUDILLA_GUIDES.find((x) => x.id === guideId);
    if (g) g.viewCount = Number(data) || 0;
    return { data };
  },

  /** Av/på-liking for innlogget bruker. Feiler stille (kaster) hvis ikke logget inn. */
  async toggleLike(guideId) {
    const sb = window.supabaseClient;
    const { data, error } = await sb.rpc("guide_toggle_like", { p_guide_id: guideId });
    if (error) return { error };
    const g = window.STUDILLA_GUIDES.find((x) => x.id === guideId);
    if (g) g.likeCount = Number(data.count) || 0;
    return { data };
  },

  /** Bruker-id-ene til alle som har likt guiden – brukt til å finne venner som har likt. */
  async likersFor(guideId) {
    const sb = window.supabaseClient;
    const { data, error } = await sb.from("guide_likes").select("user_id").eq("guide_id", guideId);
    if (error) return [];
    return (data || []).map((r) => r.user_id);
  },

  /** Har den innloggede brukeren likt denne guiden? */
  async myLike(guideId) {
    const sb = window.supabaseClient;
    const { data: session } = await sb.auth.getSession();
    const me = session && session.session && session.session.user;
    if (!me) return false;
    const { data, error } = await sb
      .from("guide_likes").select("guide_id")
      .eq("guide_id", guideId).eq("user_id", me.id).maybeSingle();
    if (error) return false;
    return !!data;
  }
};
