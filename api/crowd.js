"use strict";
/**
 * GET /api/crowd?mint=<adresse>&minutes=30
 *
 * Wer ist in den letzten Minuten in DIESEN Coin gegangen?
 *
 * Das staerkste Signal, das dieses Werkzeug erzeugen kann, ist nicht
 * "einer hat gekauft", sondern "mehrere unabhaengige Leute sind
 * gleichzeitig rein". Bisher verlangte die Zusammenlauf-Regel dafuer
 * drei Wallets AUS DER EIGENEN LISTE - bei fuenf beobachteten Adressen
 * ist das Lotterie und feuerte praktisch nie.
 *
 * Diese Route dreht die Frage um. Statt zu warten, bis sich drei
 * bekannte Leute zufaellig treffen, fragen wir beim Alarm einmal nach:
 * wer hat diesen Coin in der letzten halben Stunde sonst noch gekauft,
 * und wie sehen diese Kaeufe aus?
 *
 * Zwei Zahlen kommen zurueck, und sie sagen Verschiedenes:
 *
 *   ernsthaft - wie viele Leute mit echtem Einsatz (nicht Centbetraege)
 *               dabei sind. Das ist Nachfrage von Menschen.
 *   streuer   - wie viele Mini-Kaeufe. Viele davon bei wenig
 *               Ernsthaftem heisst: hier laufen Bots, kein Interesse.
 *
 * Kosten: ein Helius-Aufruf, und nur beim Alarm - nicht im Dauertakt.
 */

const { recentBuyersOf } = require("./_lib/wallets");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  const mint = String(q.mint || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return fail(res, 400, "Parameter 'mint' fehlt oder ist keine gültige Adresse.", "BAD_INPUT");
  }
  const minutes = Math.min(180, Math.max(5, Number(q.minutes) || 30));

  try {
    const crowd = await recentBuyersOf(mint, minutes);
    // Fuenf Minuten cachen: bei mehreren Alarmen auf denselben Coin
    // reicht eine Abfrage, und jede kostet Guthaben.
    send(res, 200, Object.assign({ ok: true, mint: mint, minutes: minutes }, crowd), 300);
  } catch (err) {
    fail(res, 502, (err && err.message) || "Abfrage fehlgeschlagen.", "CROWD_FAILED");
  }
};
