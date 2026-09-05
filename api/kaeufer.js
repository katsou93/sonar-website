"use strict";
/**
 * GET /api/kaeufer?mint=<adresse>&minuten=60&wieViele=4
 *
 * Wer geht hier gerade rein - und taugt der etwas?
 *
 * Bewusst eine EIGENE Route mit einem eigenen Knopf und nicht Teil der
 * Tiefpruefung. Grund ist das Guthaben: hier wird pro geprueftem Wallet
 * ein Aufruf faellig, und anders als die Launch-Daten aendert sich die
 * Antwort staendig - wer vor einer Stunde gekauft hat, ist nicht, wer
 * jetzt kauft. Ein Ergebnis, das man nicht lange halten kann, darf
 * nicht automatisch fuer jeden Coin laufen.
 *
 * Was den Aufwand trotzdem rechtfertigt: das ist die einzige Zahl im
 * ganzen Werkzeug, die von MENSCHEN handelt statt von Marktdaten. Ob
 * eine Wallet mit nachweisbarer Bilanz gerade eingestiegen ist, sagt
 * mehr als jede Umsatzkennzahl - und ob es fuenf Wallets derselben
 * Person sind, sieht man dem Chart nie an.
 */

const { kaeuferBild } = require("./_lib/kaeufer");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  const mint = String(q.mint || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return fail(res, 400, "Parameter 'mint' fehlt oder ist keine gültige Adresse.", "BAD_INPUT");
  }
  const minuten = Math.min(360, Math.max(10, Number(q.minuten) || 60));
  const wieViele = Math.min(4, Math.max(1, Number(q.wieViele) || 4));

  try {
    const bild = await kaeuferBild(mint, minuten, wieViele);
    // Fuenf Minuten: lang genug, dass ein zweiter Blick auf denselben
    // Coin nichts kostet, kurz genug, dass "wer kauft gerade" auch
    // wirklich gerade heisst.
    send(res, 200, Object.assign({ ok: true, mint: mint }, bild), 300);
  } catch (err) {
    fail(res, 502, (err && err.message) || "Abfrage fehlgeschlagen.", "KAEUFER_FAILED");
  }
};
