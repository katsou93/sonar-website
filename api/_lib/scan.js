"use strict";
/**
 * Orchestriert einen vollständigen Coin-Check.
 *
 * Alle drei Quellen laufen parallel und dürfen einzeln ausfallen. Was fehlt,
 * steht hinterher ehrlich in `sources` und `warnings` - lieber ein Report mit
 * Lücke als ein Spinner, der nie aufhört.
 */

const ds = require("./dexscreener");
const rugcheck = require("./rugcheck");
const solana = require("./solana");
const { evaluate, strategyFit } = require("./score");

const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

/** Akzeptiert Adresse, pump.fun-Link, DexScreener-Link, Solscan-Link. */
function extractAddress(input) {
  if (!input) return null;
  const text = String(input).trim();
  const direct = text.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  if (direct) return direct[0];
  const parts = text.split(/[/?&=#\s]+/).filter(Boolean);
  // Von hinten suchen: in URLs steht die Token-Adresse fast immer am Ende.
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].match(BASE58);
    if (m && m[0].length >= 32) return m[0];
  }
  return null;
}

async function scan(rawInput) {
  const address = extractAddress(rawInput);
  if (!address) {
    const err = new Error("Keine gültige Solana-Token-Adresse erkannt.");
    err.code = "BAD_INPUT";
    throw err;
  }

  const warnings = [];
  const settled = await Promise.allSettled([
    ds.getPairsForToken(address),
    rugcheck.getReport(address),
    solana.getHolderDistribution(address),
    solana.getMintInfo(address),
  ]);

  const pairs = settled[0].status === "fulfilled" ? settled[0].value : [];
  const rc = settled[1].status === "fulfilled" ? settled[1].value : null;
  const dist = settled[2].status === "fulfilled" ? settled[2].value : null;
  const mintInfo = settled[3].status === "fulfilled" ? settled[3].value : null;

  if (settled[0].status === "rejected") warnings.push("DexScreener antwortet nicht - ohne Marktdaten ist der Check wertlos.");
  if (!rc) warnings.push("Rugcheck stumm (Rate-Limit oder Ausfall) - Contract-Zweitmeinung fehlt.");
  if (!dist) warnings.push("Holder-Verteilung nicht abrufbar - für verlässliche Werte einen eigenen RPC in SOLANA_RPC hinterlegen.");

  if (!pairs.length) {
    const err = new Error("Kein Handelspaar gefunden. Entweder ist die Adresse falsch oder der Coin ist so neu, dass DexScreener ihn noch nicht kennt.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const pair = ds.primaryPair(pairs);
  const stage = ds.detectStage(pairs);
  const ageMinutes = ds.ageMinutesOf(pairs);
  const market = ds.marketStats(pairs);
  const socials = ds.extractSocials(pair);

  const holders = {
    top10Pct: dist ? dist.top10Pct : null,
    topHolderPct: dist ? dist.topHolderPct : null,
    poolSharePct: dist ? dist.poolSharePct : null,
    creatorPct: rc ? rc.creatorPct : null,
    totalHolders: rc ? rc.totalHolders : null,
    excludedPools: dist ? dist.excludedPools : [],
    source: [].concat(dist ? ["rpc"] : [], rc ? ["rugcheck"] : []),
  };

  const authorities = {
    mintAuthority: mintInfo ? mintInfo.mintAuthority : rc && rc.mintAuthority !== undefined ? rc.mintAuthority : null,
    freezeAuthority: mintInfo ? mintInfo.freezeAuthority : rc && rc.freezeAuthority !== undefined ? rc.freezeAuthority : null,
    lpLockedPct: rc ? rc.lpLockedPct : null,
  };

  const input = {
    market: market,
    holders: holders,
    authorities: authorities,
    socials: socials,
    stage: stage,
    ageMinutes: ageMinutes,
    rugcheck: rc,
  };

  const result = evaluate(input);
  const fit = strategyFit(input, result.score, result.verdict);

  return {
    address: address,
    chain: "solana",
    name: pair && pair.baseToken ? pair.baseToken.name : null,
    symbol: pair && pair.baseToken ? pair.baseToken.symbol : null,
    imageUrl: pair && pair.info ? pair.info.imageUrl || null : null,
    pairAddress: pair ? pair.pairAddress : null,
    dexId: pair ? pair.dexId : null,
    dexUrl: pair ? pair.url : null,
    stage: stage,
    ageMinutes: ageMinutes,
    market: market,
    holders: holders,
    authorities: authorities,
    socials: socials,
    rugcheckRisks: rc ? rc.risks : [],
    flags: result.flags,
    score: result.score,
    verdict: result.verdict,
    summary: result.summary,
    fit: fit,
    sources: { dexscreener: pairs.length > 0, rugcheck: !!rc, rpc: !!dist || !!mintInfo },
    fetchedAt: new Date().toISOString(),
    warnings: warnings,
  };
}

module.exports = { scan, extractAddress };
