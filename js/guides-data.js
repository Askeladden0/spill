/**
 * Guide-database for Studilla ("Guider og ressurser" – guider.html/guide.html).
 *
 * Samme mønster som js/games-data.js: window.STUDILLA_GUIDES starter som en
 * statisk fallback-liste (eksempelguiden fra designet, med én modul av hver
 * type), og fylles om med ekte data fra Supabase-tabellene `guides` og
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

window.STUDILLA_GUIDES = [
  {
    id: "elevrad-penger",
    title: "Hvordan tjene penger på å sitte i elevrådet",
    category: "Elevrådet",
    excerpt: "Honorar, møtegodtgjørelse, reisedekning og fondene elevrådet kan søke på.",
    valueLabel: "Opptil 12 000 kr",
    readTime: "8 min",
    coverUrl: null,
    featured: true,
    updatedAt: null
  }
];

window.STUDILLA_GUIDE_MODULES = {
  "elevrad-penger": [
    {
      id: "fallback-1",
      type: "tekst",
      sortOrder: 1,
      data: {
        heading: "Slik kommer du i gang",
        headingLevel: 2,
        body:
          "De fleste elevråd har rett på mer penger enn de bruker. Pengene ligger tre steder: i skolens eget elevrådsbudsjett, i fylkets tilskuddsordninger, og i eksterne fond som deler ut midler til elevdemokrati. Start med å finne ut hvilket av de tre skolen din allerede bruker.\n\nBe rektor om budsjettlinja for elevrådet. Den skal finnes skriftlig, og du har rett til å se den. Er summen under 100 kroner per elev, ligger skolen lavt sammenlignet med snittet.",
        bullets: [
          "Spør etter budsjettlinja skriftlig, i god tid før neste møte.",
          "Sammenlign med naboskolene – tall gir tyngde i forhandlingen.",
          "Skriv et kort krav med sum, formål og frist."
        ],
        tip: "Møtegodtgjørelse må vedtas før arbeidet er gjort. Ta det opp på det første møtet i skoleåret."
      }
    },
    {
      id: "fallback-2",
      type: "fil",
      sortOrder: 2,
      data: { name: "Budsjettmal for elevrådet", ext: "XLSX", meta: "Regneark · 42 kB · ferdig utfylt eksempel inkludert", url: null }
    },
    {
      id: "fallback-3",
      type: "tabell",
      sortOrder: 3,
      data: {
        title: "Satser per verv, skoleåret 2026/27",
        columns: ["Verv", "Godtgjørelse", "Per år"],
        source: "Kilde: innsamlede satser fra 34 videregående skoler, august 2026.",
        rows: [
          { a: "Elevrådsleder", b: "Honorar + møtegodtgjørelse", c: "10 200 kr" },
          { a: "Nestleder", b: "Halvt honorar + møtegodtgjørelse", c: "7 200 kr" },
          { a: "Økonomiansvarlig", b: "Møtegodtgjørelse", c: "4 200 kr" },
          { a: "Klassetillitsvalgt", b: "Ingen fast sats", c: "0 kr" }
        ]
      }
    },
    {
      id: "fallback-4",
      type: "gevinst",
      sortOrder: 4,
      data: {
        heading: "Dette kan du tjene",
        note: "per skoleår, som leder med full dekning",
        gains: [
          { label: "Møtegodtgjørelse, 14 møter", amountKr: 4200 },
          { label: "Honorar som elevrådsleder", amountKr: 6000 },
          { label: "Dekket reise til fylkessamlinger", amountKr: 1800 },
          { label: "Tilskudd fra elevdemokratifondet", amountKr: 0, displayText: "søkes særskilt" }
        ]
      }
    },
    {
      id: "fallback-5",
      type: "poll",
      sortOrder: 5,
      data: {
        question: "Får elevrådet ditt honorar i dag?",
        options: [
          { label: "Ja, vedtatt honorar", votes: 148 },
          { label: "Bare dekning av reise", votes: 96 },
          { label: "Nei, ingenting", votes: 312 }
        ]
      }
    },
    {
      id: "fallback-6",
      type: "triks",
      sortOrder: 6,
      data: { gameId: null, title: "Budsjett-byggeren", intro: "Sett opp elevrådets årsbudsjett på tid og se hvor pengene forsvinner. Gir poeng til rangeringen.", href: null }
    },
    {
      id: "fallback-7",
      type: "tekst",
      sortOrder: 7,
      data: {
        heading: "Neste steg",
        headingLevel: 2,
        body: "Har du fått vedtaket i boks, er neste jobb å søke eksterne midler. Se etter flere guider om arrangementer og søknader i listen over alle guider.",
        bullets: [],
        tip: null
      }
    }
  ]
};

const GUIDE_IMAGE_BUCKET = "guide-images";
const GUIDE_FILE_BUCKET = "guide-files";

function mapGuideRow(g) {
  return {
    id: g.id,
    title: g.title || "",
    category: g.category || "",
    excerpt: g.excerpt || "",
    valueLabel: g.value_label || "",
    readTime: g.read_time || "",
    coverUrl: g.cover_url || null,
    featured: !!g.is_featured,
    sortOrder: g.sort_order || 0,
    updatedAt: g.updated_at || null
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
      value_label: fields.valueLabel || "",
      read_time: fields.readTime || "",
      cover_url: fields.coverUrl || null,
      is_featured: false,
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
    if (fields.valueLabel !== undefined) patch.value_label = fields.valueLabel;
    if (fields.readTime !== undefined) patch.read_time = fields.readTime;
    if (fields.coverUrl !== undefined) patch.cover_url = fields.coverUrl;
    if (fields.featured !== undefined) patch.is_featured = fields.featured;

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
    const sb = window.supabaseClient;
    const allowed = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const ext = allowed[file.type];
    if (!ext) return { error: { message: "Kun PNG, JPG og WEBP er støttet." } };
    if (file.size > 5 * 1024 * 1024) return { error: { message: "Bildet er for stort (maks 5 MB)." } };

    const path = `${guideId}/cover-${Date.now()}.${ext}`;
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
  }
};
