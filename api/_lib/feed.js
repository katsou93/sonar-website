"use strict";
/**
 * Der Radar.
 *
 * Vorher: die ~40 zuletzt aktualisierten DexScreener-Profile als einzige
 * Kandidatenquelle. Nach den Filtern blieb ein gutes Dutzend Coins übrig -
 * zu wenig, um überhaupt auszuwählen.
 *
 * Jetzt: neun Jupiter-Listen plus die Pool-Liste, parallel abgefragt und
 * entdoppelt. Das sind je nach Marktlage 150 bis 250 Kandidaten, und weil
 * Jupiter Liquidität, Volumen, Holder-Zahl, Contract-Rechte UND den Anteil
 * echten Volumens gleich mitliefert, brauchen wir dafür keine einzige
 * Zusatzabfrage pro Token. Der Radar ist damit nicht nur voller, sondern
 * auch schneller als vorher.
 *
 * DexScreener bleibt als Ergänzung dabei: die gebuchten Boosts und die
 * frischen Profile zeigen manchmal Coins, die es noch in keine
 * Jupiter-Rangliste geschafft haben.
 */

const jup = require("./jupiter");
const ds = require("./dexscreener");
const { evaluate } = require("./score");

const DEFAULT_FILTERS = {
  minLiquidityUsd: 3000,
  minAgeMinutes: 3,
  maxAgeMinutes: null,
  minVolumeH1: 1000,
  minOrganicShare: 0,
  requireSocials: false,
  stage: "any",
  minScore: 0,
  sort: "heat",
  limit: 60,
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
    minOrganicShare: num(q.minOrganic, DEFAULT_FILTERS.minOrganicShare),
    requireSocials: q.socials === "1" || q.socials === "true",
    stage: ["any", "graduated", "bonding_curve"].indexOf(q.stage) !== -1 ? q.stage : "any",
    minScore: num(q.minScore, DEFAULT_FILTERS.minScore),
    sort: ["heat", "new", "volume", "score", "organic", "holders"].indexOf(q.sort) !== -1 ? q.sort : DEFAULT_FILTERS.sort,
    limit: Math.min(200, Math.max(1, num(q.limit, DEFAULT_FILTERS.limit))),
  };
}

/**
 * Hitze: wie viel Umsatz läuft relativ zur Poolgröße, gewichtet mit dem
 * Anteil echten Volumens und gedämpft durch das Alter. Bewusst simpel und
 * nachrechenbar - ein Wert, den man nicht erklären kann, hilft nicht.
 */
function heatOf(item) {
  const liq = item.liquidityUsd || 1;
  const turnover = item.volumeH1 / liq;
  const momentum = Math.max(0, item.priceChangeH1) / 100;
  const real = item.organicShareH1 == null ? 0.5 : Math.max(0.1, Math.min(1, item.organicShareH1 * 3));
  const freshness = item.ageMinutes == null ? 1 : Math.max(0.25, Math.min(1, 720 / (item.ageMinutes + 60)));
  return (turnover * 2 + momentum) * real * freshness;
}

function scoreItem(item) {
  return evaluate({
    light: true,
    stage: item.stage,
    ageMinutes: item.ageMinutes,
    isToken2022: item.isToken2022,
    market: {
      priceUsd: item.priceUsd,
      marketCap: item.marketCap,
      liquidityUsd: item.liquidityUsd,
      volume: { m5: 0, h1: item.volumeH1, h6: 0, h24: item.volumeH24 },
      priceChange: { m5: item.priceChangeM5, h1: item.priceChangeH1, h6: 0, h24: item.priceChangeH24 },
      txns: { m5: { buys: 0, sells: 0 }, h1: { buys: item.buysH1, sells: item.sellsH1 }, h24: { buys: 0, sells: 0 } },
      volumeToLiquidity: item.liquidityUsd ? item.volumeH24 / item.liquidityUsd : null,
      liquidityToMcap: item.liquidityUsd && item.marketCap ? item.liquidityUsd / item.marketCap : null,
      buySellRatioH1: item.buySellRatioH1,
    },
    holders: {
      top10Pct: null,
      topHoldersPctExternal: item.topHoldersPct,
      totalHolders: item.holderCount,
    },
    authorities: {
      mintAuthority: item.mintAuthorityActive ? "aktiv" : null,
      freezeAuthority: item.freezeAuthorityActive ? "aktiv" : null,
      lpLockedPct: null,
    },
    socials: { twitter: item.twitter, telegram: item.telegram, website: item.website, activeBoosts: 0 },
    organic: {
      shareH1: item.organicShareH1,
      scoreLabel: item.organicScoreLabel,
      buyersH1: item.organicBuyersH1,
      holderChangeH1: item.holderChangeH1,
    },
    rugcheck: null,
  });
}

/** DexScreener-Ergänzung: Coins, die in keiner Jupiter-Liste stehen. */
async function dexExtras(known) {
  const settled = await Promise.allSettled([ds.getLatestProfiles(), ds.getBoosts("latest"), ds.getBoosts("top")]);
  const addresses = [];
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    for (const entry of res.value) {
      const addr = entry && entry.tokenAddress;
      if (addr && !known.has(addr) && addresses.indexOf(addr) === -1) addresses.push(addr);
    }
  }
  if (!addresses.length) return [];
  // Über Jupiter nachschlagen, damit alle Einträge dieselbe Datentiefe haben.
  try {
    const assets = await jup.byMints(addresses.slice(0, 100));
    return assets.map((a) => jup.normalize(a, null)).filter(Boolean);
  } catch (err) {
    return [];
  }
}

async function buildFeed(query) {
  const filters = parseFilters(query);
  const warnings = [];

  const discovered = await jup.discover();
  const items = discovered.items.slice();
  const known = new Set(items.map((i) => i.address));

  if (discovered.listsOk === 0) {
    warnings.push("Jupiter antwortet gerade nicht - der Radar läuft nur auf der DexScreener-Ergänzung.");
  } else if (discovered.listsOk < discovered.listsTotal) {
    warnings.push(
      "Nur " + discovered.listsOk + " von " + discovered.listsTotal + " Jupiter-Listen haben geantwortet - es fehlen womöglich Kandidaten.",
    );
  }

  const extras = await dexExtras(known);
  for (const extra of extras) {
    if (!known.has(extra.address)) {
      known.add(extra.address);
      items.push(extra);
    }
  }

  // Stablecoins, SOL und Wrapped-Kram fliegen raus - das ist kein Memecoin-Radar-Stoff.
  const IGNORE = new Set(["SOL", "USDC", "USDT", "WSOL", "JUP", "JLP", "USDS", "PYUSD", "EURC", "USDG"]);

  const scored = [];
  for (const item of items) {
    if (IGNORE.has(String(item.symbol || "").toUpperCase())) continue;
    if (!item.liquidityUsd && !item.volumeH1) continue;
    const result = scoreItem(item);
    const row = Object.assign({}, item, {
      score: result.score,
      verdict: result.verdict,
      topFlags: result.flags.filter((f) => f.level === "red" || f.level === "yellow").slice(0, 3),
      hasSocials: !!(item.twitter || item.telegram || item.website),
    });
    row.heat = heatOf(row);
    scored.push(row);
  }

  const filtered = scored.filter((it) => {
    if ((it.liquidityUsd || 0) < filters.minLiquidityUsd) return false;
    if (it.volumeH1 < filters.minVolumeH1) return false;
    if (it.ageMinutes != null && it.ageMinutes < filters.minAgeMinutes) return false;
    if (filters.maxAgeMinutes != null && it.ageMinutes != null && it.ageMinutes > filters.maxAgeMinutes) return false;
    if (filters.requireSocials && !it.hasSocials) return false;
    if (filters.stage !== "any" && it.stage !== filters.stage) return false;
    if (it.score < filters.minScore) return false;
    if (filters.minOrganicShare > 0 && (it.organicShareH1 == null || it.organicShareH1 * 100 < filters.minOrganicShare)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (filters.sort === "new") return (a.ageMinutes == null ? 1e9 : a.ageMinutes) - (b.ageMinutes == null ? 1e9 : b.ageMinutes);
    if (filters.sort === "volume") return b.volumeH1 - a.volumeH1;
    if (filters.sort === "score") return b.score - a.score;
    if (filters.sort === "organic") return (b.organicShareH1 || 0) - (a.organicShareH1 || 0);
    if (filters.sort === "holders") return (b.holderCount || 0) - (a.holderCount || 0);
    return b.heat - a.heat;
  });

  return {
    items: filtered.slice(0, filters.limit),
    filters: filters,
    warnings: warnings,
    scanned: scored.length,
    matched: filtered.length,
    sources: discovered.sourceCounts,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { buildFeed, parseFilters, DEFAULT_FILTERS };
