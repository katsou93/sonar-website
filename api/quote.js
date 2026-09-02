"use strict";
/**
 * GET /api/quote?mints=a,b,c
 *
 * Was kosten diese Coins JETZT? Genau eine Jupiter-Abfrage fuer bis zu
 * 30 Adressen, kostenlos und ohne Helius-Guthaben.
 *
 * Wofuer: die App merkt sich jeden ausgeloesten Alarm samt Preis und
 * schaut spaeter nach, was daraus geworden ist. Ohne diesen Endpunkt
 * gaebe es keine Rueckmeldung - und ohne Rueckmeldung kann nichts lernen.
 */

const jup = require("./_lib/jupiter");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const raw = String((req.query && req.query.mints) || "");
  const mints = raw
    .split(/[,\s]+/)
    .map((m) => m.trim())
    .filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m))
    .slice(0, 30);

  if (!mints.length) return send(res, 200, { ok: true, quotes: [] }, 20);

  try {
    const assets = await jup.byMints(mints);
    const quotes = [];
    for (const asset of assets || []) {
      if (!asset || !asset.id) continue;
      const coin = jup.normalize(asset, null);
      quotes.push({
        mint: coin.address,
        symbol: coin.symbol,
        priceUsd: coin.priceUsd,
        marketCap: coin.marketCap,
        liquidityUsd: coin.liquidityUsd,
        priceChangeH1: coin.priceChangeH1,
      });
    }
    send(res, 200, { ok: true, quotes: quotes }, 20);
  } catch (err) {
    fail(res, 502, (err && err.message) || "Kurse nicht verfügbar.", "QUOTE_FAILED");
  }
};
