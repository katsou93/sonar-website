"use strict";
/**
 * GET /api/frisch?maxAlter=1440&limit=25&nurGruen=0
 *
 * Die Kandidatenliste fuer den Pruefstand.
 *
 * Unterschied zum Radar: der Radar zeigt, was sich BEWEGT. Diese Route
 * zeigt, was PRUEFBAR ist - frische Coins, jeder durch dieselbe
 * Checkliste geschickt, sortiert danach, wie sauber sie durchkommen.
 *
 * Kostet kein Guthaben. Alles hier stammt aus den Jupiter-Listen, die
 * ohnehin abgefragt werden. Die teure Launch-Forensik laeuft erst auf
 * Zuruf ueber /api/tief - und nur fuer die paar Coins, die es bis nach
 * oben geschafft haben.
 */

const jup = require("./_lib/jupiter");
const { freiesUrteil, FOKUS_UNTEN, FOKUS_OBEN } = require("./_lib/pruefstand");
const { send, fail, authorized, preflight } = require("./_lib/respond");

const MAX_ALTER_STD = 72;

function zahl(v, standard, min, max) {
  const n = Number(v);
  if (!isFinite(n)) return standard;
  return Math.min(max, Math.max(min, n));
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  const maxAlter = zahl(q.maxAlter, 24 * 60, 5, MAX_ALTER_STD * 60);
  const limit = zahl(q.limit, 25, 5, 60);
  const minPunkte = zahl(q.minPunkte, 0, 0, 100);
  const nurKurve = String(q.nurKurve || "") === "1";
  // Das Zielfenster. Standard ist deine Vorgabe 5k bis 40k; die
  // Oberflaeche kann es aufziehen, wenn man doch mal weiter schauen
  // will. Null als Obergrenze heisst "nach oben offen".
  const minMcap = zahl(q.minMcap, FOKUS_UNTEN, 0, 5000000);
  const maxMcap = zahl(q.maxMcap, FOKUS_OBEN, 0, 50000000);

  let gefunden;
  try {
    gefunden = await jup.discover();
  } catch (err) {
    return fail(res, 502, (err && err.message) || "Entdeckung fehlgeschlagen.", "DISCOVER_FAILED");
  }

  const roh = gefunden.items || [];

  const kandidaten = [];
  for (const c of roh) {
    if (!c || !c.address) continue;
    if (c.ageMinutes == null || c.ageMinutes > maxAlter) continue;
    if (nurKurve && c.stage === "graduated") continue;

    // Das Fenster. Ein Coin ohne Marktwert bleibt drin - dazu urteilt
    // die Checkliste dann "unbekannt", statt ihn stillschweigend
    // verschwinden zu lassen.
    if (c.marketCap != null) {
      if (minMcap > 0 && c.marketCap < minMcap) continue;
      if (maxMcap > 0 && c.marketCap > maxMcap) continue;
    }

    // Voellig tote Eintraege gar nicht erst bewerten - sie verstopfen nur
    // die Liste und kosten Rechenzeit.
    const handel = (c.buysH1 || 0) + (c.sellsH1 || 0);
    if (handel === 0 && (c.holderCount || 0) < 10) continue;

    const urteil = freiesUrteil(c);
    if (urteil.punkte < minPunkte) continue;

    kandidaten.push({
      address: c.address,
      name: c.name,
      symbol: c.symbol,
      imageUrl: c.imageUrl,
      launchpad: c.launchpad,
      stage: c.stage,
      ageMinutes: c.ageMinutes,
      marketCap: c.marketCap,
      liquidityUsd: c.liquidityUsd,
      priceUsd: c.priceUsd,
      volumeH1: c.volumeH1,
      priceChangeM5: c.priceChangeM5,
      priceChangeH1: c.priceChangeH1,
      priceChangeH24: c.priceChangeH24,
      buysH1: c.buysH1,
      sellsH1: c.sellsH1,
      netBuyersH1: c.netBuyersH1,
      holderCount: c.holderCount,
      holderChangeH1: c.holderChangeH1,
      topHoldersPct: c.topHoldersPct,
      organicShareH1: c.organicShareH1,
      devMints: c.devMints,
      devMigrations: c.devMigrations,
      twitter: c.twitter,
      telegram: c.telegram,
      website: c.website,
      bondingCurvePct: c.bondingCurvePct,
      pumpUrl: c.pumpUrl,
      dexUrl: c.dexUrl,

      punkte: urteil.punkte,
      ampel: urteil.ampel,
      checks: urteil.checks,
      schlecht: urteil.schlecht,
      offen: urteil.offen,
      tiefLohntSich: urteil.tiefLohntSich,
    });
  }

  // Beste zuerst. Bei Gleichstand gewinnt der juengere - da ist mehr Platz.
  kandidaten.sort((a, b) => (b.punkte - a.punkte) || ((a.ageMinutes || 0) - (b.ageMinutes || 0)));

  send(
    res,
    200,
    {
      ok: true,
      geprueft: roh.length,
      imFenster: kandidaten.length,
      maxAlter: maxAlter,
      minMcap: minMcap,
      maxMcap: maxMcap,
      quellen: gefunden.sourceCounts,
      listenOk: gefunden.listsOk,
      listenGesamt: gefunden.listsTotal,
      coins: kandidaten.slice(0, limit),
    },
    20,
  );
};
