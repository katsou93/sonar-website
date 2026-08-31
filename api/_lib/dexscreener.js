"use strict";
/**
 * DexScreener - Hauptquelle für Preis, Liquidität, Volumen und Alter.
 * Kostenlos, kein Key. Limits laut Doku: ~300 Anfragen/Minute für Token- und
 * Suchendpunkte, ~60/Minute für Profil- und Boost-Endpunkte.
 *
 * Wichtig für pump.fun: Coins tauchen hier schon WAEHREND der Bonding Curve
 * auf (dexId "pumpfun"). Nach der Graduation kommt ein zweites Paar mit dexId
 * "pumpswap" oder "raydium" dazu. Genau daran erkennen wir die Phase - ganz
 * ohne die von Cloudflare geschützte pump.fun-API.
 */

const { cached, getJson, mapLimit } = require("./http");

const BASE = "https://api.dexscreener.com";

const GRADUATED_DEXES = ["pumpswap", "raydium", "meteora", "orca", "lifinity", "whirlpool"];
const CURVE_DEXES = ["pumpfun", "pump", "moonshot", "believe", "boop", "launchlab", "bonk"];

async function getPairsForToken(address) {
  return cached("ds:token:" + address, 15000, async () => {
    const data = await getJson(BASE + "/latest/dex/tokens/" + address, { source: "dexscreener" });
    const pairs = (data && data.pairs) || [];
    return pairs.filter((p) => p.chainId === "solana");
  });
}

/** Bis zu 30 Adressen pro Aufruf - so bleiben wir unter den Limits. */
async function getPairsForTokens(addresses) {
  const unique = Array.from(new Set(addresses));
  const chunks = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

  const responses = await mapLimit(chunks, 3, async (chunk) => {
    try {
      const data = await getJson(BASE + "/latest/dex/tokens/" + chunk.join(","), { source: "dexscreener" });
      return (data && data.pairs) || [];
    } catch (err) {
      return [];
    }
  });

  const byToken = new Map();
  for (const pair of [].concat.apply([], responses)) {
    if (pair.chainId !== "solana") continue;
    const key = pair.baseToken && pair.baseToken.address;
    if (!key) continue;
    const list = byToken.get(key) || [];
    list.push(pair);
    byToken.set(key, list);
  }
  return byToken;
}

/** Zuletzt aktualisierte Token-Profile - unser bester kostenloser "was ist neu"-Strom. */
async function getLatestProfiles() {
  return cached("ds:profiles", 25000, async () => {
    const data = await getJson(BASE + "/token-profiles/latest/v1", { source: "dexscreener" });
    return (Array.isArray(data) ? data : []).filter((p) => p.chainId === "solana");
  });
}

/**
 * Bezahlte Promotion. Achtung bei der Interpretation: ein Boost ist ein
 * gekaufter Werbeplatz, kein Qualitätssiegel. Wir nutzen ihn als
 * Aufmerksamkeitssignal und flaggen ihn bei sehr jungen Coins als gelb.
 */
async function getBoosts(kind) {
  const k = kind === "top" ? "top" : "latest";
  return cached("ds:boosts:" + k, 25000, async () => {
    const data = await getJson(BASE + "/token-boosts/" + k + "/v1", { source: "dexscreener" });
    return (Array.isArray(data) ? data : []).filter((p) => p.chainId === "solana");
  });
}

async function searchPairs(query) {
  const data = await getJson(BASE + "/latest/dex/search?q=" + encodeURIComponent(query), {
    source: "dexscreener",
  });
  const pairs = (data && data.pairs) || [];
  return pairs.filter((p) => p.chainId === "solana");
}

/**
 * Aus mehreren Paaren das aussagekräftigste wählen: höchste Liquidität.
 * Bei einem gerade migrierten Coin ist das automatisch der neue PumpSwap-Pool
 * und nicht die tote Bonding Curve.
 */
function primaryPair(pairs) {
  if (!pairs || !pairs.length) return null;
  return pairs.slice().sort((a, b) => liq(b) - liq(a))[0];
}

function liq(pair) {
  return (pair && pair.liquidity && pair.liquidity.usd) || 0;
}

function detectStage(pairs) {
  if (!pairs || !pairs.length) return "unknown";
  const dexIds = pairs.map((p) => String(p.dexId || "").toLowerCase());
  if (dexIds.some((d) => GRADUATED_DEXES.some((g) => d.indexOf(g) === 0))) return "graduated";
  if (dexIds.some((d) => CURVE_DEXES.indexOf(d) !== -1)) return "bonding_curve";
  return "unknown";
}

/** Aeltestes Paar bestimmt das echte Alter des Coins. */
function ageMinutesOf(pairs) {
  const ts = (pairs || []).map((p) => p.pairCreatedAt).filter((t) => typeof t === "number" && t > 0);
  if (!ts.length) return null;
  return Math.max(0, Math.round((Date.now() - Math.min.apply(null, ts)) / 60000));
}

function extractSocials(pair) {
  const info = (pair && pair.info) || {};
  const socials = info.socials || [];
  const websites = info.websites || [];
  const find = (needle) => {
    const hit = socials.find((s) => String(s.type || s.platform || "").toLowerCase().indexOf(needle) !== -1);
    return hit ? hit.url : null;
  };
  return {
    website: websites.length ? websites[0].url : null,
    twitter: find("twitter") || find("x"),
    telegram: find("telegram"),
    activeBoosts: (pair && pair.boosts && pair.boosts.active) || 0,
  };
}

/** Marktzahlen aus dem Hauptpaar in eine feste Form bringen. */
function marketStats(pairs) {
  const pair = primaryPair(pairs);
  const vol = (pair && pair.volume) || {};
  const chg = (pair && pair.priceChange) || {};
  const tx = (pair && pair.txns) || {};
  const n = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
  const txn = (k) => ({ buys: n(tx[k] && tx[k].buys), sells: n(tx[k] && tx[k].sells) });

  // Liquidität über ALLE Pools summieren: bei frisch migrierten Coins liegt
  // sonst die Hälfte unsichtbar in der alten Kurve.
  const liquidityUsd = (pairs || []).reduce((sum, p) => sum + liq(p), 0) || null;
  const marketCap = (pair && (pair.marketCap || pair.fdv)) || null;
  const h1 = txn("h1");

  return {
    priceUsd: pair && pair.priceUsd ? Number(pair.priceUsd) : null,
    marketCap,
    fdv: (pair && pair.fdv) || null,
    liquidityUsd,
    volume: { m5: n(vol.m5), h1: n(vol.h1), h6: n(vol.h6), h24: n(vol.h24) },
    priceChange: { m5: n(chg.m5), h1: n(chg.h1), h6: n(chg.h6), h24: n(chg.h24) },
    txns: { m5: txn("m5"), h1: h1, h24: txn("h24") },
    volumeToLiquidity: liquidityUsd ? n(vol.h24) / liquidityUsd : null,
    liquidityToMcap: liquidityUsd && marketCap ? liquidityUsd / marketCap : null,
    buySellRatioH1: h1.sells > 0 ? h1.buys / h1.sells : h1.buys > 0 ? 99 : null,
  };
}

module.exports = {
  getPairsForToken,
  getPairsForTokens,
  getLatestProfiles,
  getBoosts,
  searchPairs,
  primaryPair,
  detectStage,
  ageMinutesOf,
  extractSocials,
  marketStats,
};
