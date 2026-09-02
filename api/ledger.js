"use strict";
/**
 * GET /api/ledger?addrs=<adresse,adresse,...>
 *
 * Die Frage, die dieses Werkzeug vorher nie gestellt hat: verdienen die
 * Leute, denen wir folgen, ueberhaupt Geld?
 *
 * Bisher lief die Auswahl so: nimm Coins, die gelaufen sind, schau wer
 * frueh drin war, nenne die Leute Kundschafter. Das beantwortet aber
 * nur "wer war bei einem Gewinner dabei?" - nicht "wer gewinnt?". Zu
 * jedem Coin, der laeuft, gibt es vierzig fruehe Kaeufer, und die
 * meisten davon kaufen zweihundert Launches pro Woche und verlieren bei
 * hundertsiebenundneunzig. Sie stehen in der Liste, WEIL der Coin lief.
 *
 * Diese Route rechnet stattdessen pro Wallet nach, was aus ihren
 * ABGESCHLOSSENEN Positionen geworden ist: wie viel SOL hinein, wie
 * viel heraus. Offene Positionen zaehlen nicht - wer haelt, hat nichts
 * bewiesen.
 *
 * Warum eine eigene Route und nicht Teil der Kundschafter-Suche: sie
 * braucht drei Abfragen pro Wallet, und die Suche hat von den dreissig
 * Sekunden, die Vercel einer Funktion gibt, schon die Haelfte
 * verbraucht. So erscheint erst die Liste, und eine Sekunde spaeter
 * fuellen sich die Zahlen.
 */

const { walletLedger } = require("./_lib/wallets");
const { send, fail, authorized, preflight } = require("./_lib/respond");

function parse(input) {
  const out = [];
  const seen = new Set();
  for (const raw of String(input || "").split(/[,\s;]+/)) {
    const a = raw.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
    if (out.length >= 5) break; // jede Wallet kostet drei Abfragen
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const wallets = parse((req.query || {}).addrs);
  if (!wallets.length) return send(res, 200, { ok: true, ledgers: {} }, 60);

  const ledgers = {};
  // Sequenziell: das Helius-Freikontingent erlaubt zwei Anfragen pro
  // Sekunde. Mit Uhr, damit ein langsamer Aufruf nicht die ganze
  // Antwort mitreisst - lieber drei Bilanzen als ein Timeout.
  const frist = Date.now() + 22000;
  for (let i = 0; i < wallets.length; i++) {
    if (Date.now() > frist) break;
    if (i > 0) await new Promise((r) => setTimeout(r, 550));
    try {
      ledgers[wallets[i]] = await walletLedger(wallets[i]);
    } catch (err) {
      ledgers[wallets[i]] = { genug: false, fehler: true };
    }
  }

  // Zwoelf Stunden cachen: eine Handelsbilanz aendert sich nicht im
  // Minutentakt, und jede Abfrage kostet Guthaben.
  send(res, 200, { ok: true, ledgers: ledgers }, 3600);
};
