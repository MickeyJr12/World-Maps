        // ============================================================
// 1) COLLE TA LISTE ICI (remplace le contenu de l'objet)
// ============================================================
var monuments = {
    "AT":[{
        id:"Q877023"
    }]
}


let nbrResolus = 0;

// ============================================================
// 2) CODE (ne rien modifier)
// ============================================================

function removeParentheses(text) {
  if (!text) return text;

  let out = "";
  let depth = 0;

  for (const ch of text) {
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
      else out += ch; // parenthèse fermante orpheline : on la garde
    } else if (depth === 0) {
      out += ch;
    }
  }

  return out
    .replace(/\s+([,.;:!?])/g, "$1") // supprime l'espace avant la ponctuation : "Raja Ampat , or" -> "Raja Ampat, or"
    .replace(/\s{2,}/g, " ")         // espaces doubles -> simples
    .trim();
}

;(async () => {
  const SKIP_NO_IMAGE = true; // true = on ne garde que les lieux qui ont une photo
  const DESCRIPTION_FIRST_PARAGRAPH_ONLY = true; // true = seulement le 1er paragraphe de l'intro
  const DESCRIPTION_MAX_CHARS = 600;             // 0 = pas de limite

  const WIKIDATA = "https://www.wikidata.org/w/api.php";
  const COMMONS = "https://commons.wikimedia.org/w/api.php";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chunk = (arr, n) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  async function api(base, params) {
    const url =
      base + "?" + new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url);
      if (res.ok) return res.json();
      await sleep(1000 * attempt);
    }
    throw new Error("Échec de la requête : " + url);
  }

  async function getEntities(ids, props) {
    const out = {};
    for (const batch of chunk([...new Set(ids)], 50)) {
      const data = await api(WIKIDATA, {
        action: "wbgetentities",
        ids: batch.join("|"),
        props,
        languages: "fr|en",
      });
      Object.assign(out, data.entities);
      await sleep(200);
    }
    return out;
  }

  function bestValue(entity, prop) {
    const claims = (entity.claims?.[prop] || []).filter((c) => c.rank !== "deprecated");
    const best =
      claims.find((c) => c.rank === "preferred") ||
      claims.find((c) => !c.qualifiers?.P582) ||
      claims[0];
    return best?.mainsnak?.datavalue?.value;
  }

  const label = (entity, lang) => entity?.labels?.[lang]?.value ?? null;
  const stripHtml = (s) => (s ? s.replace(/<[^>]*>/g, "").trim() : null);

  async function getCountryIds() {
    const query = "SELECT ?c ?iso WHERE { ?c wdt:P297 ?iso }";
    const res = await fetch(
      "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query)
    );
    const data = await res.json();
    const map = {};
    for (const b of data.results.bindings) map[b.iso.value] = b.c.value.split("/").pop();
    return map;
  }

  async function findId(name, countryQid) {
  const data = await api(WIKIDATA, {
    action: "wbsearchentities",
    search: name,
    language: "en",
    type: "item",
    limit: "10",
  });

  const candidates = data.search || [];
  if (!candidates.length) return null;

  const ents = await getEntities(
    candidates.map((candidate) => candidate.id),
    "claims"
  );

  // Priorité 1 : le territoire est indiqué directement par P17.
  for (const candidate of candidates) {
    const entity = ents[candidate.id];

    const countries = (entity?.claims?.P17 || [])
      .map((claim) => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

    if (countries.includes(countryQid)) {
      return candidate.id;
    }
  }

  // Priorité 2 : le territoire est indiqué par P131.
  for (const candidate of candidates) {
    const entity = ents[candidate.id];

    const locations = (entity?.claims?.P131 || [])
      .map((claim) => claim.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

    if (locations.includes(countryQid)) {
      return candidate.id;
    }
  }

  // Priorité 3 : accepte le premier résultat si aucun territoire
  // ne permet de départager les candidats.
  return candidates[0].id;
}


    async function getCommonsInfo(filenames) {
    const out = {};
    for (const batch of chunk([...new Set(filenames)], 50)) {
      const data = await api(COMMONS, {
        action: "query",
        titles: batch.map((f) => "File:" + f).join("|"),
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "1280",
      });
      for (const page of data.query?.pages || []) {
        const info = page.imageinfo?.[0];
        if (!info) continue;
        const meta = info.extmetadata || {};
        out[page.title.replace(/^File:/, "")] = {
          image: info.thumburl || info.url,
          sourceUrl:
            info.descriptionurl ??
            "https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title), // secours
          author: stripHtml(meta.Artist?.value),
          license: meta.LicenseShortName?.value ?? null,
          licenseUrl: meta.LicenseUrl?.value ?? null,
        };
      }
      await sleep(200);
    }
    return out;
  }


    const description = (entity, lang) => entity?.descriptions?.[lang]?.value ?? null;

  function cleanExtract(text) {
    let t = text.trim();
    if (DESCRIPTION_FIRST_PARAGRAPH_ONLY) t = t.split(/\n\s*\n/)[0];
    t = t.replace(/\s+/g, " ").trim();
    if (DESCRIPTION_MAX_CHARS && t.length > DESCRIPTION_MAX_CHARS) {
      t = t.slice(0, DESCRIPTION_MAX_CHARS);
      t = t.slice(0, Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? ")) + 1) || t + "…";
    }
    return t || null;
  }

  // Récupère l'intro (trop juste descriptives) des articles Wikipédia (lang = "fr" ou "en") 
  // async function getWikiExtracts(lang, titles) {
  //   const out = {};
  //   const base = `https://${lang}.wikipedia.org/w/api.php`;
  //   for (const batch of chunk([...new Set(titles)], 20)) { // max 20 titres par requête pour exintro
  //     const data = await api(base, {
  //       action: "query",
  //       prop: "extracts",
  //       exintro: "1",
  //       explaintext: "1",
  //       exlimit: "20",
  //       redirects: "1",
  //       titles: batch.join("|"),
  //     });
  //     const q = data.query || {};

  //     // titre demandé -> titre réel (normalisation / redirections)
  //     const alias = {};
  //     for (const n of q.normalized || []) alias[n.from] = n.to;
  //     for (const r of q.redirects || []) alias[r.from] = r.to;
  //     const resolve = (t) => { let i = 0; while (alias[t] && i++ < 5) t = alias[t]; return t; };

  //     const byTitle = {};
  //     for (const page of q.pages || []) if (page.extract) byTitle[page.title] = page.extract;

  //     for (const t of batch) {
  //       const text = byTitle[resolve(t)];
  //       if (text) out[t] = cleanExtract(text);
  //     }
  //     await sleep(200);
  //   }
  //   return out;
  // }

  const DESCRIPTION_MODE = "anecdote"; // "intro" = ancien comportement, "anecdote" = nouveau

// Sections sans intérêt
const SECTION_SKIP = /^(notes?|références?|references?|notes et références|notes and references|voir aussi|see also|liens externes|external links|bibliographie|bibliography|further reading|galerie|gallery|annexes?|articles? connexes?|sources?|accès|access|tourisme|visite|visiting|tourism)$/i;

// Sections où l'on cherche en priorité (du plus au moins intéressant)
const SECTION_PRIORITY = {
  fr: ["légende", "anecdote", "mythe", "histoire", "historique", "origine", "construction", "culture populaire", "architecture", "description"],
  en: ["legend", "folklore", "myth", "anecdote", "history", "origin", "construction", "popular culture", "architecture", "description"],
};

// Mots qui signalent une phrase "qui raconte quelque chose"
const KEYWORDS = {
  fr: ["légende", "mystère", "secret", "fantôme", "trésor", "incendie", "détruit", "reconstruit", "bataille", "siège", "roi", "reine", "empereur", "pape", "assassin", "prison", "exécut", "miracle", "unesco", "record", "plus grand", "plus ancien", "plus haut", "premier", "première", "seul", "unique", "célèbre", "inspir", "film", "tournage", "surnom", "symbole", "interdit", "disparu"],
  en: ["legend", "folklore", "mystery", "secret", "ghost", "treasure", "fire", "destroyed", "rebuilt", "battle", "siege", "king", "queen", "emperor", "pope", "assassin", "prison", "execut", "miracle", "unesco", "record", "largest", "oldest", "tallest", "first", "only", "unique", "famous", "inspir", "film", "nicknam", "symbol", "banned", "vanished"],
};

// Découpe le texte brut en sections grâce aux "== Titre =="
function parseSections(text) {
  const re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  const sections = [];
  let prev = { title: "__intro__", end: 0 };
  let m;
  while ((m = re.exec(text))) {
    sections.push({ title: prev.title, text: text.slice(prev.end, m.index).trim() });
    prev = { title: m[2], end: m.index + m[0].length };
  }
  sections.push({ title: prev.title, text: text.slice(prev.end).trim() });
  return sections;
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"“(0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function scoreSentence(s, lang) {
  const low = s.toLowerCase();
  let score = 0;
  for (const k of KEYWORDS[lang]) if (low.includes(k)) score += 2;
  if (/\b1\d{3}\b|\b20[0-2]\d\b/.test(s)) score += 1;              // contient une date
  if (/siècle|century|av\. J\.-C|BC\b/i.test(s)) score += 1;
  if (s.length < 40) score -= 3;                                   // trop courte pour raconter quoi que ce soit
  if (s.length > 320) score -= 2;                                  // pavé indigeste
  if (/^(il|elle|it) (est|is) (situ|locat)/i.test(s)) score -= 3;  // "Il est situé à…"
  if (/\d+[,.]\d+\s*°|coordonnées|coordinates|\bkm\b/i.test(s)) score -= 3;
  return score;
}

// Meilleure suite de phrases consécutives qui tient dans `budget` caractères
function bestWindow(sentences, lang, budget) {
  const scores = sentences.map((s) => scoreSentence(s, lang));
  let best = { score: -Infinity, text: null };
  for (let i = 0; i < sentences.length; i++) {
    let len = 0, score = 0;
    for (let j = i; j < sentences.length; j++) {
      len += sentences[j].length + (j > i ? 1 : 0);
      if (len > budget) break;
      score += scores[j];
      if (score > best.score) best = { score, text: sentences.slice(i, j + 1).join(" ") };
    }
  }
  return best;
}

function buildDescription(fullText, lang) {
  const sections = parseSections(fullText);
  const intro = sections[0]?.text ?? "";
  if (DESCRIPTION_MODE !== "anecdote") return cleanExtract(intro);

  // Première phrase de l'intro = "carte d'identité" du lieu
  const introSentence = splitSentences(intro)[0] ?? "";
  const budget = DESCRIPTION_MAX_CHARS - introSentence.length - 1;
  if (budget < 100) return cleanExtract(intro);

  let best = { score: -Infinity, text: null };
  for (const sec of sections.slice(1)) {
    if (SECTION_SKIP.test(sec.title) || sec.text.length < 80) continue;
    const title = sec.title.toLowerCase();
    const prio = SECTION_PRIORITY[lang].findIndex((k) => title.includes(k));
    const bonus = prio === -1 ? 0 : SECTION_PRIORITY[lang].length - prio;
    const w = bestWindow(splitSentences(sec.text), lang, budget);
    if (w.text && w.score + bonus > best.score) best = { score: w.score + bonus, text: w.text };
  }

  // Rien de vraiment intéressant trouvé → on retombe sur l'intro classique
  if (!best.text || best.score < 4) return cleanExtract(intro);
  return `${introSentence} ${best.text}`.trim();
}

// Article complet : l'API n'accepte qu'UN titre par requête hors mode exintro
async function getWikiFullExtracts(lang, titles) {
  const out = {};
  for (const title of [...new Set(titles)]) {
    const data = await api(`https://${lang}.wikipedia.org/w/api.php`, {
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exsectionformat: "wiki",   // titres rendus en "== Titre =="
      redirects: "1",
      titles: title,
    });
    const page = data.query?.pages?.[0];
    if (page?.extract) out[title] = buildDescription(page.extract, lang);
    await sleep(150);
  }
  return out;
}



  

  // ---------- Programme principal ----------
  console.log("Démarrage…");
  const countryIds = await getCountryIds();

  // 1. Résoudre les identifiants manquants
  const places = [];
  for (const [iso, items] of Object.entries(monuments)) {
     let nbrFound = 0;
    for (const item of items) {
      let qid = item.id;
      if (!qid) {
        qid = await findId(item.name, countryIds[iso]);
        await sleep(250);
        if (!qid) {
          
          console.warn(`[${iso}] Introuvable : ${item.name}`)
        };
      }
      if (qid) {
        nbrFound +=1
        places.push({ iso, qid, fallbackName: item.name })
      };
    }
    nbrResolus+=1
    console.log(nbrFound + " trouvé sur " + monuments[iso].length)
    console.log(`[${nbrResolus}/${Object.keys(monuments).length}]` + `Identifiants résolus pour ${iso}`);
  }

  // 2. Données Wikidata
  // console.log("Récupération des données Wikidata…");
  // const entities = await getEntities(places.map((p) => p.qid), "labels|claims|sitelinks");

    // 2. Données Wikidata
  console.log("Récupération des données Wikidata…");
  const entities = await getEntities(
    places.map((p) => p.qid),
    "labels|descriptions|claims|sitelinks"
  );


  // 3. Libellés villes/régions et pays
  const cityIds = places.map((p) => bestValue(entities[p.qid] || {}, "P131")?.id).filter(Boolean);
  const labelEntities = await getEntities([...cityIds, ...Object.values(countryIds)], "labels");

  // 4. Images Commons
  console.log("Récupération des images Commons…");
  const filenames = places.map((p) => bestValue(entities[p.qid] || {}, "P18")).filter(Boolean);
  const commons = await getCommonsInfo(filenames);

    // 4bis. Introductions Wikipédia (fr + en)
  console.log("Récupération des descriptions Wikipédia…");
  const frTitles = places.map((p) => entities[p.qid]?.sitelinks?.frwiki?.title).filter(Boolean);
  const enTitles = places.map((p) => entities[p.qid]?.sitelinks?.enwiki?.title).filter(Boolean);
  // const [frExtracts, enExtracts] = await Promise.all([
  //   getWikiExtracts("fr", frTitles),
  //   getWikiExtracts("en", enTitles),
  // ]);

  const [frExtracts, enExtracts] = await Promise.all([
  getWikiFullExtracts("fr", frTitles),
  getWikiFullExtracts("en", enTitles),
]);



  // 5. Construction du résultat
  const result = {};
  for (const iso of Object.keys(monuments)) result[iso] = [];
  for (const p of places) {
    const e = entities[p.qid];
    if (!e || e.missing !== undefined) continue;

    const file = bestValue(e, "P18") ?? null;
    const img = file ? commons[file] : null;
    if (SKIP_NO_IMAGE && !img) continue;

    const cityId = bestValue(e, "P131")?.id ?? null;
    const coord = bestValue(e, "P625");
    const countryQid = countryIds[p.iso] ?? null;

    const entry = {
      id: p.qid,
      name: {
        fr: label(e, "fr") ?? label(e, "en") ?? p.fallbackName,
        en: label(e, "en") ?? p.fallbackName,
      },
      city: cityId
        ? {
            id: cityId,
            fr: label(labelEntities[cityId], "fr") ?? label(labelEntities[cityId], "en"),
            en: label(labelEntities[cityId], "en"),
          }
        : null,
      country: {
        id: countryQid,
        iso: p.iso,
        fr: label(labelEntities[countryQid], "fr") ?? label(labelEntities[countryQid], "en"),
        en: label(labelEntities[countryQid], "en"),
      },
      coordinates: {
        latitude: coord?.latitude ?? null,
        longitude: coord?.longitude ?? null,
      },
      image: img?.image ?? null,
      file,
      author: img?.author ?? null,
      license: img?.license ?? null,
      licenseUrl: img?.licenseUrl ?? null,
      sourceUrl: img?.sourceUrl ?? null, 
      fame: Object.keys(e.sitelinks || {}).length,

      description: {
        fr: removeParentheses(frExtracts[e.sitelinks?.frwiki?.title]) ?? removeParentheses(description(e, "fr")) ?? null,
        en: removeParentheses(enExtracts[e.sitelinks?.enwiki?.title]) ?? removeParentheses(description(e, "en")) ?? null,
      },
    };
    

    (result[p.iso] ||= []);
    if (!result[p.iso].some((x) => x.id === entry.id)) result[p.iso].push(entry);
  }

  for (const iso of Object.keys(result)) result[iso].sort((a, b) => b.fame - a.fame);

  window.monumentsResult = result; // accessible ensuite dans la console
  const json = JSON.stringify(result, null, 4);
  const total = Object.values(result).reduce((n, arr) => n + arr.length, 0);
  console.log(`Terminé : ${total} lieux.`);

  if (typeof copy === "function") {
    copy(json); // fonction propre à la console Chrome/Edge/Firefox
    console.log("Le JSON a été copié dans ton presse-papiers (Ctrl+V pour le coller).");
  } else {
    console.log("Tape `JSON.stringify(monumentsResult, null, 4)` pour récupérer le résultat.");
  }
  console.log(result);
})();

 