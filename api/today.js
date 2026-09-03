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
  const ohne = [];

  for (const term of daten.terms || []) {
    const wort = String(term.term || "");
    if (!wort) continue;

    // Durch dasselbe Lexikon wie ein Coin-Name. Ein Begriff ist ja
    // nichts anderes als der Name, den ein Coin morgen tragen wird.
    const sektor = narrative.sectorOf({ name: wort, symbol: "" });
    const eintrag = {
      wort: wort,
      quellen: term.sources || [],
      erwaehnungen: (term.sources || []).length,
      reichweite: term.traffic || 0,
      gewicht: gewichtVon(term),
    };

    if (!sektor) {
      ohne.push(eintrag);
      continue;
    }
    const key = sektor.key || sektor;
    const liste = gruppen.get(key) || [];
    liste.push(eintrag);
    gruppen.set(key, liste);
  }

  const kategorien = Array.from(gruppen.entries())
    .map(([key, begriffe]) => {
      begriffe.sort((a, b) => b.gewicht - a.gewicht);
      return {
        key: key,
        label: narrative.labelOf(key),
        begriffe: begriffe.slice(0, 8),
        anzahl: begriffe.length,
        // Die Kategorie ist so stark wie ihre Begriffe zusammen - aber
        // eine Kategorie mit einem sehr starken Begriff soll nicht von
        // einer mit fünf schwachen geschlagen werden.
        punkte: Math.round(
          begriffe.reduce((a, b) => a + b.gewicht, 0) * 0.5 + (begriffe[0] ? begriffe[0].gewicht : 0),
        ),
      };
    })
    .sort((a, b) => b.punkte - a.punkte);

  ohne.sort((a, b) => b.gewicht - a.gewicht);

  // Zehn Minuten cachen. Die Außenwelt ändert sich nicht im
  // Sekundentakt, und jede Abfrage zieht an sechs fremden Servern.
  send(res, 200, {
    ok: true,
    kategorien: kategorien,
    ohneKategorie: ohne.slice(0, 20),
    quellen: daten.sources || {},
    quellenOk: daten.sourcesOk || 0,
    quellenGesamt: daten.sourcesTotal || 0,
    stand: daten.fetchedAt || Date.now(),
  }, 600);
};
