"use strict";
/**
 * GET /api/scan?address=<mint|pump.fun-Link|DexScreener-Link>
 *
 * Vollständiger Coin-Check: Marktdaten, Holder-Verteilung ohne Pools,
 * Contract-Authorities, Rugcheck-Risiken, Score mit Begründung und die
 * Einordnung, ob der Coin zu Strategie A oder B passt.
 */

const { scan } = require("./_lib/scan");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const input = (req.query && (req.query.address || req.query.q)) || "";
  if (!input) return fail(res, 400, "Parameter 'address' fehlt.", "BAD_INPUT");

  try {
    const report = await scan(input);
    // 20 Sekunden Edge-Cache: schützt die kostenlosen Quellen, ohne dass
    // die Zahlen beim Traden veraltet wirken.
    send(res, 200, { ok: true, report: report }, 20);
  } catch (err) {
    const code = err && err.code;
    const status = code === "BAD_INPUT" ? 400 : code === "NOT_FOUND" ? 404 : 502;
    fail(res, status, (err && err.message) || "Unbekannter Fehler beim Scan.", code || "SCAN_FAILED");
  }
};
