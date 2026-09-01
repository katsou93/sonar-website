"use strict";
/**
 * Die Stichwort-Wache.
 *
 * Idee: du hinterlegst Worte, die gerade in der Welt passieren - "raccoon",
 * "hormuz", "penguin", ein Promi-Name, ein viraler Clip. Sobald ein Coin
 * mit diesem Wort auftaucht, siehst du ihn.
 *
 * Der entscheidende Teil ist NICHT das Finden. Sobald irgendwo eine
 * Nachricht bricht, entstehen binnen Minuten hunderte Coins mit dem
 * passenden Namen, und die allermeisten sind Müll: null Liquiditaet,
 * Bot-Volumen, Contract-Rechte offen. Ein reiner Wort-Treffer ist also
 * kein Signal, sondern nur Laerm.
 *
 * Deshalb gibt es hier zwei Stufen:
 *
 *   Stufe 1 "gesehen"  - Der Name passt. Mehr nicht. Reine Beobachtung,
 *                        kein Alarm, keine Benachrichtigung.
 *   Stufe 2 "Substanz" - Der Name passt UND es kaufen echte Menschen:
 *                        Liquiditaet ueber der Schwelle, echter
 *                        Umsatzanteil, Holder wachsen, keine roten Flaggen.
 *                        Das ist der Alarm.
 *
 * Praktisch heisst das: von 200 "Raccoon"-Coins schaffen es null bis zwei
 * in Stufe 2, und genau die willst du sehen.
 */

const { tokenize } = require("./narrative");

/** Ein Stichwort in eine pruefbare Form bringen. */
function normalizeWord(raw) {
  const word = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (word.length < 3 || word.length > 24) return null;
  return word;
}

/**
 * Wortliste einlesen. Drei Quellen, in dieser Reihenfolge zusammengefuehrt:
 *   1. die mitgelieferte Liste (config/watchwords.json)
 *   2. die Environment-Variable SONAR_WATCHWORDS (kommagetrennt)
 *   3. was die App im Aufruf mitschickt (?words=a,b,c)
 * Doppelte fliegen raus, zu kurze auch.
 */
function parseWords(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === "string") list = input.split(/[,\n;]+/);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const word = normalizeWord(raw);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= 60) break;
  }
  return out;
}

function defaultWords() {
  // Bewusst ein require und keine gelesene Datei: Vercel packt nur das in
  // die Funktion, was per require erreichbar ist. Eine zur Laufzeit
  // zusammengebaute Dateipfad-Lesung waere im Deployment leer.
  let fromFile = [];
  try {
    fromFile = require("./watchwords.data").words || [];
  } catch (err) {
    fromFile = [];
  }
  return parseWords(fromFile.concat(parseWords(process.env.SONAR_WATCHWORDS || [])));
}

/**
 * Passt ein Coin auf eines der Stichworte?
 *
 * Kurze Worte (unter 5 Zeichen) muessen ein ganzes Wort treffen, sonst
 * findet "ape" jeden "Paper"-Coin. Ab 5 Zeichen darf auch mitten im Text
 * getroffen werden, damit "raccoon" auch "JimothyRaccoonCoin" erwischt.
 */
function matchWord(item, words) {
  const name = String((item && item.name) || "");
  const symbol = String((item && item.symbol) || "");
  const parts = tokenize(name + " " + symbol);
  const flat = (name + symbol).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!flat) return null;

  for (const word of words) {
    if (word.length >= 5) {
      if (flat.indexOf(word) !== -1) return word;
    } else if (parts.indexOf(word) !== -1) {
      return word;
    }
  }
  return null;
}

/**
 * Die Substanzpruefung. Bewusst streng - der Zweck der Wache ist, dass
 * ein Ping etwas bedeutet. Lieber kein Alarm als zehn wertlose.
 */
const SUBSTANCE = {
  minLiquidityUsd: 12000,
  minVolumeH1: 4000,
  minOrganicShare: 0.15,
  minHolders: 50,
};

function substanceOf(item) {
  const reasons = [];
  const liq = item.liquidityUsd || 0;
  if (liq < SUBSTANCE.minLiquidityUsd) reasons.push("Pool nur " + Math.round(liq) + " $");
  if ((item.volumeH1 || 0) < SUBSTANCE.minVolumeH1) reasons.push("kaum Umsatz");
  if (item.organicShareH1 != null && item.organicShareH1 < SUBSTANCE.minOrganicShare) {
    reasons.push("nur " + Math.round(item.organicShareH1 * 100) + "% echtes Volumen");
  }
  if (item.organicShareH1 == null) reasons.push("Echtheit unbekannt");
  if (item.holderCount != null && item.holderCount < SUBSTANCE.minHolders) reasons.push("erst " + item.holderCount + " Halter");
  if (item.mintAuthorityActive === true) reasons.push("Contract kann noch nachdrucken");
  if (item.freezeAuthorityActive === true) reasons.push("Konten können eingefroren werden");
  const red = (item.topFlags || []).filter((f) => f && f.level === "red");
  for (const flag of red) reasons.push(flag.title);
  return { ok: reasons.length === 0, reasons: reasons };
}

/**
 * Alle Treffer aus einer Coin-Liste ziehen.
 *
 * Setzt auf jedem getroffenen Coin item.watchWord und item.watchLevel, und
 * gibt zusaetzlich die beiden Listen getrennt zurueck.
 */
function scan(items, wordInput) {
  const words = wordInput === undefined || wordInput === null ? defaultWords() : parseWords(wordInput);
  const substance = [];
  const seen = [];
  if (!words.length) return { words: words, substance: substance, seen: seen };

  for (const item of items || []) {
    const word = matchWord(item, words);
    if (!word) continue;
    const check = substanceOf(item);
    item.watchWord = word;
    item.watchLevel = check.ok ? "substanz" : "gesehen";
    item.watchReasons = check.reasons;
    (check.ok ? substance : seen).push(item);
  }

  // Innerhalb der Stufen: das Auffaelligste zuerst.
  substance.sort((a, b) => (b.surge || 0) - (a.surge || 0) || (b.volumeH1 || 0) - (a.volumeH1 || 0));
  seen.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));

  return { words: words, substance: substance, seen: seen };
}

module.exports = { scan, matchWord, substanceOf, parseWords, defaultWords, normalizeWord, SUBSTANCE };
