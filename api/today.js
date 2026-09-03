"use strict";
/**
 * GET /api/today
 *
 * Der Tag auf einer Seite: worüber wird gerade geredet, sortiert nach
 * denselben Kategorien, nach denen auch Coins sortiert werden.
 *
 * Der Gedanke dahinter ist einfach und war bisher trotzdem nicht
 * umgesetzt. Auf pump.fun filterst du nach Meme, Politik, Tieren, KI.
 * Genau in diesen Schubladen denkt der Markt. Unsere Aussenwelt-Daten
 * kamen aber als eine flache Liste von Begriffen heraus - Nepal,
 * Hogwarts, Powell, Waschbaer, alles durcheinander. Wer daraus etwas
 * ableiten wollte, musste die Einordnung selbst im Kopf machen.
 *
 * Diese Route macht sie. Jeder Begriff aus Reddit, Google Trends, den
 * Nachrichten, Hacker News und Wikipedia wird durch dasselbe Lexikon
 * geschickt, mit dem auch Coin-Namen einsortiert werden. Danach steht
 * da nicht mehr "vierzig Begriffe", sondern:
 *
 *     Politik      Nepal, Powell, Kathmandu
 *     Tiere        Jimothy, Aquarium
 *     KI           Grok, Anthropic
 *
 * Und pro Begriff die einzige Zahl, die wirklich zaehlt: von wie vielen
 * unabhaengigen Quellen kommt er? Ein Wort, das gleichzeitig bei Reddit
 * UND in den Nachrichten steht, ist etwas anderes als eines, das nur in
 * einer Wikipedia-Liste auftaucht.
 */

const buzz = require("./_lib/buzz");
const narrative = require("./_lib/narrative");
const { send, fail, authorized, preflight } = require("./_lib/respond");

/**
 * Wie schwer wiegt ein Begriff?
 *
 * Die Anzahl der QUELLEN ist der stärkste Teil, und zwar mit Abstand.
 * Ein Thema, das an drei unabhängigen Stellen gleichzeitig auftaucht,
 * ist real. Eines, das nur an einer steht, kann eine Laune sein - eine
 * einzelne Wikipedia-Liste oder ein Nachrichtenticker, der jede Stunde
 * dasselbe wiederholt.
 *
 * Die Reichweite (Suchvolumen, Reddit-Punkte) zählt mit, aber gedämpft:
 * sie ist zwischen den Quellen nicht vergleichbar, und wer sie voll
 * gewichtet, lässt am Ende Wikipedia jede Rangliste gewinnen.
 */
function gewichtVon(term) {
  const quellen = (term.sources || []).length || 1;
  const reichweite = Math.log10(1 + (term.traffic || 0));
  return Math.round(quellen * 100 + reichweite * 12);
}

/* ------------------------------------------------------------------ *
 * Was fuer ein Ding ist das?
 * ------------------------------------------------------------------ */

/**
 * Das Meme-Lexikon kennt Hunde, Katzen, Froesche, Politik. Es ist fuer
 * COIN-NAMEN gebaut, und dort funktioniert es. Fuer Nachrichten
 * funktioniert es nicht: die liefern Personen und Orte, und fuer "Stan
 * Kroenke" gibt es keine Hunde-Schublade. Live landete deshalb fast
 * alles in "ohne Schublade" - die Einteilung, um die es eigentlich
 * ging, war praktisch leer.
 *
 * Also eine zweite Einteilung, die zu Nachrichten passt: nicht WORUEBER
 * das Ding handelt, sondern WAS FUER EIN DING es ist. Person, Ort,
 * Marke, Ereignis. Das laesst sich aus der Form des Namens und aus der
 * Schlagzeile ableiten, ohne ein Weltwissen zu brauchen.
 *
 * Das Meme-Lexikon behaelt Vorrang: "Raccoon" ist ein Tier, nicht eine
 * "Sache". Erst wenn es nicht greift, kommt diese Einteilung.
 */

/**
 * Zwei kurze Namenslisten.
 *
 * Reine Formregeln kommen nur bis hierhin: "Hugging Face" sieht aus wie
 * Vorname Nachname, ist aber eine Firma. "Washington" und
 * "Pennsylvania" sind Orte, ohne dass ihnen das anzusehen waere. Live
 * gemessen landete das eine bei den Personen, das andere bei den
 * Ereignissen.
 *
 * Solche Faelle loest man nicht mit einer klugeren Regel, sondern mit
 * einer kurzen Liste der haeufigsten Namen. Sie muss nicht vollstaendig
 * sein - sie muss nur die abfangen, die staendig vorkommen.
 */
const MARKEN = new Set([
  "microsoft", "google", "alphabet", "apple", "amazon", "meta", "facebook", "instagram",
  "tesla", "netflix", "nvidia", "openai", "anthropic", "disney", "sony", "samsung",
  "xbox", "playstation", "nintendo", "tiktok", "reddit", "youtube", "spotify", "uber",
  "spacex", "starlink", "boeing", "intel", "amd", "oracle", "ibm", "adobe", "paypal",
  "coinbase", "binance", "robinhood", "hugging face", "deepseek", "mistral", "perplexity",
  "walmart", "costco", "nike", "adidas", "mcdonald", "starbucks", "pfizer", "moderna",
]);

const ORTE = new Set([
  // Laender
  "usa", "america", "china", "russia", "ukraine", "israel", "gaza", "iran", "india",
  "japan", "germany", "france", "britain", "england", "italy", "spain", "canada",
  "mexico", "brazil", "australia", "korea", "taiwan", "nepal", "pakistan", "turkey",
  "egypt", "nigeria", "poland", "sweden", "norway", "greece", "syria", "yemen",
  // US-Staaten und grosse Staedte
  "washington", "california", "texas", "florida", "pennsylvania", "ohio", "michigan",
  "georgia", "arizona", "nevada", "colorado", "oregon", "virginia", "alaska", "hawaii",
  "new york", "los angeles", "chicago", "houston", "boston", "seattle", "denver",
  "miami", "atlanta", "detroit", "philadelphia", "phoenix", "dallas", "san francisco",
  "london", "paris", "berlin", "moscow", "beijing", "tokyo", "delhi", "dubai", "rome",
]);

const ORT_ENDUNG = /\b(City|River|Island|Bay|County|Valley|Beach|Lake|Mountain|Desert|Sea|Ocean|Park|Bridge|Airport|Stadium|Province|District|State)$/i;
const MARKE_ENDUNG = /\b(Inc|Corp|Labs?|Studios?|Games|Media|Group|Holdings|Technologies|Systems|Motors|Airlines|Bank)$/i;

const EREIGNIS_WORT = /\b(dies|died|death|killed|kills|murder|crash|crashed|fire|flood|quake|earthquake|storm|protest|riot|arrest|arrested|wins|won|beats|launch|launches|launched|announce|announced|resign|resigns|attack|explosion|rescue|verdict|sentenced|bankrupt|collapse)\b/i;
const ORT_SATZ = /\b(in|from|across|near|outside|near)\s+$/;
const MARKE_SATZ = /\b(company|startup|app|firm|maker|brand|platform|studio|developer|founder|CEO|acquired|acquisition|IPO)\b/i;

/** Sieht der Name aus wie ein Personenname? Vorname Nachname, beides gross. */
function wirktWiePerson(wort) {
  const teile = String(wort || "").trim().split(/\s+/);
  if (teile.length < 2 || teile.length > 3) return false;
  // Jeder Teil gross beginnend und ohne Ziffern - "Gloria Steinem",
  // "Tom Clancy", "Nikolas Ferreira Daniel".
  return teile.every((t) => /^[A-ZÄÖÜ][a-zäöüß'-]{1,19}$/.test(t));
}

/** CamelCase mitten im Wort verraet fast immer eine Marke: StartLux, OpenAI. */
function wirktWieMarke(wort) {
  const eins = String(wort || "").trim();
  if (/\s/.test(eins)) return MARKE_ENDUNG.test(eins);
  return /^[A-Z][a-z]+[A-Z]/.test(eins) || MARKE_ENDUNG.test(eins);
}

function artVon(wort, beispiel) {
  const w = String(wort || "").trim();
  const klein = w.toLowerCase();
  const satz = String(beispiel || "");

  // Die Listen zuerst: sie sind sicher, die Formregeln sind Schaetzung.
  if (MARKEN.has(klein)) return { key: "marke", label: "Marken und Produkte" };
  if (ORTE.has(klein)) return { key: "ort", label: "Orte" };

  if (wirktWieMarke(w)) return { key: "marke", label: "Marken und Produkte" };
  if (ORT_ENDUNG.test(w)) return { key: "ort", label: "Orte" };

  // "protests in Nepal", "fire across California" - was hinter einer
  // Ortspraeposition steht, ist ein Ort.
  if (satz) {
    const stelle = satz.indexOf(w);
    if (stelle > 0 && ORT_SATZ.test(satz.slice(Math.max(0, stelle - 14), stelle))) {
      return { key: "ort", label: "Orte" };
    }
    if (MARKE_SATZ.test(satz)) return { key: "marke", label: "Marken und Produkte" };
  }

  if (wirktWiePerson(w)) return { key: "person", label: "Personen" };

  // Ereignis erst zuletzt: fast jede Schlagzeile enthaelt ein
  // Ereigniswort, das wuerde sonst alles einsammeln.
  if (satz && EREIGNIS_WORT.test(satz)) return { key: "ereignis", label: "Ereignisse" };

  return null;
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  let daten;
  try {
    daten = await buzz.fetchBuzz();
  } catch (err) {
    return send(res, 200, {
      ok: true,
      kategorien: [],
      quellen: {},
      fehler: "Die Außenwelt war gerade nicht erreichbar.",
    }, 60);
  }

  const gruppen = new Map();
  const labels = new Map();
  const ohne = [];

  // Mehrzahl und Einzahl zusammenfassen. Live gesehen standen "film",
  // "films" und "series" als drei getrennte Eintraege nebeneinander -
  // das sind aber nicht drei Themen, das ist eines, dreimal gezaehlt,
  // und jedes davon wirkte dadurch schwaecher als es ist.
  const stamm = (w) => {
    const x = String(w || "").toLowerCase();
    if (x.length > 4 && x.endsWith("ies")) return x.slice(0, -3) + "y";
    if (x.length > 4 && x.endsWith("es")) return x.slice(0, -2);
    if (x.length > 3 && x.endsWith("s") && !x.endsWith("ss")) return x.slice(0, -1);
    return x;
  };
  const zusammen = new Map();
  for (const term of daten.terms || []) {
    const wort = String(term.term || "");
    if (!wort) continue;
    const key = stamm(wort);
    const vorhanden = zusammen.get(key);
    if (!vorhanden) {
      zusammen.set(key, { term: wort, sources: (term.sources || []).slice(), traffic: term.traffic || 0, beispiel: term.beispiel || null });
      continue;
    }
    // Die kuerzere Schreibweise gewinnt - "film" liest sich besser als
    // "films", und es ist dieselbe Sache.
    if (wort.length < vorhanden.term.length) vorhanden.term = wort;
    (term.sources || []).forEach((q) => {
      if (vorhanden.sources.indexOf(q) === -1) vorhanden.sources.push(q);
    });
    vorhanden.traffic = Math.max(vorhanden.traffic, term.traffic || 0);
    if (!vorhanden.beispiel && term.beispiel) vorhanden.beispiel = term.beispiel;
  }

  for (const term of zusammen.values()) {
    const wort = String(term.term || "");
    if (!wort) continue;

    // Durch dasselbe Lexikon wie ein Coin-Name. Ein Begriff ist ja
    // nichts anderes als der Name, den ein Coin morgen tragen wird.
    // Erst das Meme-Lexikon - "Raccoon" ist ein Tier, keine "Sache".
    // Greift es nicht, wird nach der ART des Dings eingeteilt.
    const sektor = narrative.sectorOf({ name: wort, symbol: "" });
    const art = sektor ? null : artVon(wort, term.beispiel);
    const eintrag = {
      wort: wort,
      quellen: term.sources || [],
      erwaehnungen: (term.sources || []).length,
      reichweite: term.traffic || 0,
      // Die Schlagzeile. Ein nacktes Wort kann man nicht beurteilen -
      // mit dem Satz dahinter dauert es eine Sekunde.
      beispiel: term.beispiel || null,
      gewicht: gewichtVon(term),
    };

    if (!sektor && !art) {
      ohne.push(eintrag);
      continue;
    }
    const key = sektor ? (sektor.key || sektor) : art.key;
    if (!labels.has(key)) labels.set(key, sektor ? narrative.labelOf(key) : art.label);
    const liste = gruppen.get(key) || [];
    liste.push(eintrag);
    gruppen.set(key, liste);
  }

  const kategorien = Array.from(gruppen.entries())
    .map(([key, begriffe]) => {
      begriffe.sort((a, b) => b.gewicht - a.gewicht);
      // Nur was von mindestens zwei Quellen kommt. Ein einzelner
      // Treffer ist zu oft ein Nachrichtenticker, der dasselbe Wort
      // stuendlich wiederholt - er fuellt die Kategorien mit Rauschen
      // und laesst die echten Themen darin untergehen. Die Gesamtzahl
      // bleibt trotzdem ehrlich stehen.
      const zeigbar = begriffe.filter((b) => b.erwaehnungen >= 2);
      return {
        key: key,
        label: labels.get(key) || narrative.labelOf(key),
        begriffe: (zeigbar.length ? zeigbar : begriffe).slice(0, 8),
        anzahl: begriffe.length,
        // Die Kategorie ist so stark wie ihre Begriffe zusammen - aber
        // eine Kategorie mit einem sehr starken Begriff soll nicht von
        // einer mit fünf schwachen geschlagen werden.
        punkte: Math.round(
          begriffe.reduce((a, b) => a + b.gewicht, 0) * 0.5 + (begriffe[0] ? begriffe[0].gewicht : 0),
        ),
      };
    })
    .filter((k) => k.begriffe.some((b) => b.erwaehnungen >= 2))
    .sort((a, b) => b.punkte - a.punkte);

  // Was ohne Kontext dasteht, taugt nicht.
  //
  // Ein Begriff aus einer einzigen Quelle OHNE Schlagzeile ist eine
  // nackte Zeichenkette - man kann nicht beurteilen, ob dahinter etwas
  // steckt. Live standen zwanzig solcher Eintraege in der Liste und
  // machten die ganze Seite unbrauchbar. Entweder mehrere Quellen
  // bestaetigen das Thema, oder es gibt wenigstens den Satz dazu.
  const brauchbar = ohne.filter((b) => b.erwaehnungen >= 2 || b.beispiel);
  brauchbar.sort((a, b) => b.gewicht - a.gewicht);

  // Zehn Minuten cachen. Die Außenwelt ändert sich nicht im
  // Sekundentakt, und jede Abfrage zieht an sechs fremden Servern.
  send(res, 200, {
    ok: true,
    kategorien: kategorien,
    ohneKategorie: brauchbar.slice(0, 16),
    // Ehrlich dazusagen, wie viel weggefallen ist - sonst sieht eine
    // kurze Liste nach einem stillen Tag aus statt nach einem Filter.
    ausgesiebt: ohne.length - brauchbar.length,
    quellen: daten.sources || {},
    quellenOk: daten.sourcesOk || 0,
    quellenGesamt: daten.sourcesTotal || 0,
    stand: daten.fetchedAt || Date.now(),
  }, 600);
};
