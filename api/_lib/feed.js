"use strict";
/**
 * Der Radar: neue und heiss laufende Solana-Token, gefiltert nach euren Regeln.
 *
 * Ehrliche Einordnung der Datenlage: DexScreener hat keinen offenen
 * "alle neuen Paare"-Endpunkt. Wir nutzen deshalb die beiden kostenlosen
 * Ströme, die es gibt - zuletzt aktualisierte Token-Profile und die
 * gebuchten Boosts - und reichern sie mit den echten Marktdaten an.
 * Das ist kein vollständiger Mempool-Feed. Es zeigt, was gerade
 * Aufmerksamkeit einsammelt, und genau darum geht es bei Memecoins.
 *
 * Bewusst NICHT pro Token: RPC- und Rugcheck-Abfragen. Bei 100 Token wären
 * das 300+ Requests und garantierte Rate-Limits. Der Radar bewertet nur mit
 * Marktdaten (leichter Score); der volle Check passiert beim Klick auf einen
 * Coin über /api/scan.
 */

const ds = require("./dexscreener");
const { evaluate } = require("./score");

const DEFAULT_FILTERS = {
  minLiquidityUsd: 5000,
  minAgeMinutes: 5,
  maxAgeMinutes: null,
  minVolumeH1: 2000,
  requireSocials: false,
  stage: "any",
  minScore: 0,
  sort: "heat",
  limit: 40,
};

function parseFilters(query) {
  const q = query || {};
  const num = (v, d) => {
    if (v === undefined || v === null || v === "") return d;
    const n = Number(v);
    return isFinite(n) ? n : d;
  };
  return {
    minLiquidityUsd: num(q.minLiquidity, DEFAULT_FILTERS.minLiquidityUsd),
    minAgeMinutes: num(q.minAge, DEFAULT_FILTERS.minAgeMinutes),
    maxAgeMinutes: q.maxAge === "" || q.maxAge === undefined ? DEFAULT_FILTERS.maxAgeMinutes : num(q.maxAge, null),
    minVolumeH1: num(q.minVolumeH1, DEFAULT_FILTERS.minVolumeH1),
    requireSocials: q.socials === "1" || q.socials === "true",
    stage: ["any", "graduated", "bonding_curve"].indexOf(q.stage) !== -1 ? q.stage : "any",
    minScore: num(q.minScore, DEFAULT_FILTERS.minScore),
    sort: ["heat", "new", "volume", "score"].indexOf(q.sort) !== -1 ? q.sort : DEFAULT_FILTERS.sort,
    limit: Math.min(100, Math.max(1, num(q.limit, DEFAULT_FILTERS.limit))),
  };
}

/**
 * Hitze = wie viel Umsatz läuft gerade relativ zur Poolgröße, gedämpft
 * durch das Alter. Absichtlich simpel und nachvollziehbar: ein Wert, den
 * man nicht erklären kann, hilft beim Traden nicht.
 */
function heatOf(item) {
  const liq = item.liquidityUsd || 1;
  const turnover = item.volumeH1 / liq;
  const momentum = Math.max(0, item.priceChangeH1) / 100;
  const freshness = item.ageMinutes == null ? 1 : Math.max(0.25, Math.min(1, 720 / (item.ageMinutes + 60)));
  return (turnover * 2 + momentum) * freshness;
}

async function buildFeed(query) {
  const filters = parseFilters(query);
  const warnings = [];

  const settled = await Promise.allSettled([ds.getLatestProfiles(), ds.getBoosts("latest"), ds.getBoosts("top")]);
  const profiles = settled[0].status === "fulfilled" ? settled[0].value : [];
  const boostsLatest = settled[1].status === "fulfilled" ? settled[1].value : [];
  const boostsTop = settled[2].status === "fulfilled" ? settled[2].value : [];
  if (settled.every((s) => s.status === "rejected")) {
    warnings.push("DexScreener liefert gerade keine Kandidatenliste (Rate-Limit).");
  }

  const addresses = Array.from(
    new Set(
      []
        .concat(profiles, boostsLatest, boostsTop)
        .map((p) => p && p.tokenAddress)
        .filter(Boolean),
    ),
  ).slice(0, 120);

  if (!addresses.length) return { items: [], filters: filters, warnings: warnings, scanned: 0 };

  const byToken = await ds.getPairsForTokens(addresses);
  const items = [];

  byToken.forEach((pairs, address) => {
    const pair = ds.primaryPair(pairs);
    if (!pair) return;
    const stage = ds.detectStage(pairs);
    const ageMinutes = ds.ageMinutesOf(pairs);
    const market = ds.marketStats(pairs);
    const socials = ds.extractSocials(pair);

    const result = evaluate({
      market: market,
      holders: {},
      authorities: {},
      socials: socials,
      stage: stage,
      ageMinutes: ageMinutes,
      rugcheck: null,
      light: true,
    });

    const item = {
      address: address,
      name: pair.baseToken ? pair.baseToken.name : null,
      symbol: pair.baseToken ? pair.baseToken.symbol : null,
      imageUrl: pair.info ? pair.info.imageUrl || null : null,
      stage: stage,
      ageMinutes: ageMinutes,
      priceUsd: market.priceUsd,
      marketCap: market.marketCap,
      liquidityUsd: market.liquidityUsd,
      volumeH1: market.volume.h1,
      volumeH24: market.volume.h24,
      priceChangeH1: market.priceChange.h1,
      buySellRatioH1: market.buySellRatioH1,
      hasSocials: !!(socials.twitter || socials.telegram || socials.website),
      score: result.score,
      verdict: result.verdict,
      topFlags: result.flags.filter((f) => f.level === "red" || f.level === "yellow").slice(0, 3),
      dexUrl: pair.url || null,
      pumpUrl: "https://pump.fun/coin/" + address,
    };
    item.heat = heatOf(item);
    items.push(item);
  });

  const filtered = items.filter((it) => {
    if ((it.liquidityUsd || 0) < filters.minLiquidityUsd) return false;
    if (it.volumeH1 < filters.minVolumeH1) return false;
    if (it.ageMinutes != null && it.ageMinutes < filters.minAgeMinutes) return false;
    if (filters.maxAgeMinutes != null && it.ageMinutes != null && it.ageMinutes > filters.maxAgeMinutes) return false;
    if (filters.requireSocials && !it.hasSocials) return false;
    if (filters.stage !== "any" && it.stage !== filters.stage) return false;
    if (it.score < filters.minScore) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (filters.sort === "new") return (a.ageMinutes == null ? 1e9 : a.ageMinutes) - (b.ageMinutes == null ? 1e9 : b.ageMinutes);
    if (filters.sort === "volume") return b.volumeH1 - a.volumeH1;
    if (filters.sort === "score") return b.score - a.score;
    return b.heat - a.heat;
  });

  return {
    items: filtered.slice(0, filters.limit),
    filters: filters,
    warnings: warnings,
    scanned: items.length,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { buildFeed, parseFilters, DEFAULT_FILTERS };
