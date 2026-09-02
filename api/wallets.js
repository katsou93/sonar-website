"use strict";
/**
 * GET /api/wallets?addrs=<adresse,adresse,...>
 *
 * Was haben die beobachteten Wallets zuletzt gekauft und verkauft?
 * Jeder Kauf kommt mit unserer eigenen Bewertung des Coins zurueck.
 *
 * Benoetigt HELIUS_API_KEY in den Vercel-Environment-Variablen. Fehlt er,
 * antwortet die Route trotzdem sauber mit keyMissing:true - die App zeigt
 * dann die Einrichtungsanleitung statt eines Fehlers.
 */

const { watch } = require("./_lib/wallets");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  try {
    const result = await watch(q.addrs || "", {
      limit: Math.min(25, Math.max(1, Number(q.limit) || 12)),
      buysOnly: q.buysOnly === "1",
      sinceSeconds: Number(q.since) > 0 ? Math.min(86400, Number(q.since)) : 0,
    });
    // Kurz cachen: jede Wallet kostet Helius-Guthaben, und niemand braucht
    // dieselbe Antwort zweimal in einer Minute.
    send(res, 200, Object.assign({ ok: true }, result), 30);
  } catch (err) {
    fail(res, 502, (err && err.message) || "Wallet-Abfrage fehlgeschlagen.", "WALLETS_FAILED");
  }
};
