"use strict";
/**
 * Jupiter Token API - die eigentliche Entdeckungsschicht.
 *
 * Warum diese Quelle: DexScreener hat keinen offenen "alle neuen Paare"-
 * Endpunkt. Wir hingen deshalb an den ~40 zuletzt aktualisierten Profilen
 * und hatten am Ende ein Dutzend Coins in der Liste. Jupiter liefert
 * mehrere hundert Kandidaten UND pro Token Daten, für die wir vorher drei
 * Quellen anfragen mussten:
 *
 *   holderCount                  - vorher nur über Rugcheck
 *   audit.topHoldersPercentage   - vorher nur über einen eigenen RPC
 *   audit.mint/freezeAuthority   - vorher nur über RPC
 *   graduatedAt                  - eindeutige Phasenerkennung statt Rateraten
 *   buyOrganicVolume             - das hier ist neu und das Wertvollste:
 *
 * Jupiter trennt echtes von bot-getriebenem Volumen. Ein Coin mit 227k
 * Umsatz, davon 15k organisch, sieht im Chart nach Nachfrage aus und ist
 * in Wahrheit ein Karussell aus Bots, die sich gegenseitig handeln. Das
 * war bisher unser blinder Fleck - genau die Coins, die "heiss" aussehen
 * und dich als Ausgang brauchen.
 *
 * Alles kostenlos, ohne Schlüssel. Rate-Limit der lite-API ist grosszügig,
 * wir fragen pro Radar-Aufruf rund zehn Listen parallel ab.
 */

const { cached, getJson } = require("./http");

const LITE = "https://lite-api.jup.ag/tokens/v2";
const DATAPI = "https://datapi.jup.ag/v1";

/** Jede Liste ist bei 30 Einträgen gedeckelt - deshalb fragen wir viele. */
async function list(path, ttlMs) {
  return cached("jup:" + path, ttlMs || 20000, async () => {
    const data = await getJson(LITE + path, { source: "jupiter", timeoutMs: 5500, retries: 0 });
    return Array.isArray(data) ? data : [];
  });
}

const recent = () => list("/recent");
const topOrganic = (period) => list("/toporganicscore/" + period);
const topTraded = (period) => list("/toptraded/" + period);

/** Bis zu 100 Mint-Adressen auf einmal - für Scan und Watchlist. */
async function byMints(mints) {
  const ids = (Array.isArray(mints) ? mints : [mints]).slice(0, 100).join(",");
  if (!ids) return [];
  return cached("jup:mints:" + ids, 20000, async () => {
    const data = await getJson(LITE + "/search?query=" + encodeURIComponent(ids), {
      source: "jupiter",
      timeoutMs: 5500,
      retries: 0,
    });
    return Array.isArray(data) ? data : [];
  });
}

/**
 * NUR exakte Treffer. Jupiters /search sucht auch über Namen und Symbole -
 * ein "nimm halt den ersten Treffer"-Fallback würde die Zahlen eines
 * fremden Coins unter der angefragten Adresse anzeigen. Das ist der
 * gefährlichste Fehler, den dieses Werkzeug machen könnte.
 */
async function byMint(mint) {
  const hits = await byMints([mint]);
  return hits.find((t) => t && t.id === mint) || null;
}

/**
 * Der Pool-Endpunkt von Jupiters eigener Oberfläche. Nicht offiziell
 * dokumentiert, deshalb strikt optional behandelt: fällt er aus, läuft der
 * Radar mit den lite-API-Listen weiter. Er bringt die frischesten Launches
 * und den Fortschritt auf der Bonding Curve.
 */
async function pools(sortBy) {
  const key = sortBy || "listedTime";
  return cached("jup:pools:" + key, 20000, async () => {
    try {
      const data = await getJson(DATAPI + "/pools?sortBy=" + encodeURIComponent(key) + "&limit=50", {
        source: "jupiter-datapi",
        timeoutMs: 5500,
        retries: 0,
      });
      return (data && Array.isArray(data.pools) ? data.pools : []).filter((p) => p && p.baseAsset);
    } catch (err) {
      return [];
    }
  });
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

/**
 * Aus einem Jupiter-Asset unsere einheitliche Form machen.
 * `pool` ist optional und liefert zusätzlich den Kurvenfortschritt.
 */
function normalize(asset, pool) {
  if (!asset || !asset.id) return null;
  const s1 = asset.stats1h || {};
  const s24 = asset.stats24h || {};
  const s5 = asset.stats5m || {};
  const audit = asset.audit || {};

  const volumeH1 = num(s1.buyVolume) + num(s1.sellVolume);
  const organicH1 = num(s1.buyOrganicVolume) + num(s1.sellOrganicVolume);
  const volumeH24 = num(s24.buyVolume) + num(s24.sellVolume);
  const organicH24 = num(s24.buyOrganicVolume) + num(s24.sellOrganicVolume);

  const created = (asset.firstPool && asset.firstPool.createdAt) || asset.createdAt || null;
  const ageMinutes = created ? Math.max(0, Math.round((Date.now() - new Date(created).getTime()) / 60000)) : null;

  const graduated = !!asset.graduatedAt;
  const stage = graduated ? "graduated" : asset.launchpad ? "bonding_curve" : "unknown";

  const liquidityUsd = num(asset.liquidity) || null;
  const marketCap = num(asset.mcap) || num(asset.fdv) || null;

  return {
    address: asset.id,
    name: asset.name || null,
    symbol: asset.symbol || null,
    imageUrl: asset.icon || null,
    launchpad: asset.launchpad || null,
    stage: stage,
    graduatedAt: asset.graduatedAt || null,
    ageMinutes: ageMinutes,

    priceUsd: num(asset.usdPrice) || null,
    marketCap: marketCap,
    liquidityUsd: liquidityUsd,
    volumeH1: volumeH1,
    volumeH24: volumeH24,
    priceChangeM5: num(s5.priceChange),
    priceChangeH1: num(s1.priceChange),
    priceChangeH24: num(s24.priceChange),
    buysH1: num(s1.numBuys),
    sellsH1: num(s1.numSells),
    buySellRatioH1: num(s1.numSells) > 0 ? num(s1.numBuys) / num(s1.numSells) : num(s1.numBuys) > 0 ? 99 : null,
    tradersH1: num(s1.numTraders),
    netBuyersH1: num(s1.numNetBuyers),
    holderChangeH1: typeof s1.holderChange === "number" ? s1.holderChange : null,
    liquidityChangeH1: typeof s1.liquidityChange === "number" ? s1.liquidityChange : null,

    // Der Kern: wie viel vom Umsatz ist kein Bot-Karussell?
    organicShareH1: volumeH1 > 0 ? organicH1 / volumeH1 : null,
    organicShareH24: volumeH24 > 0 ? organicH24 / volumeH24 : null,
    organicBuyersH1: num(s1.numOrganicBuyers),
    organicScore: typeof asset.organicScore === "number" ? asset.organicScore : null,
    organicScoreLabel: asset.organicScoreLabel || null,

    holderCount: typeof asset.holderCount === "number" ? asset.holderCount : null,
    topHoldersPct: typeof audit.topHoldersPercentage === "number" ? audit.topHoldersPercentage : null,
    devAddress: asset.dev || null,
    // Jupiter meldet "disabled: true" - wir drehen das auf unsere Logik
    // (eine gesetzte Authority ist das Problem, nicht ihr Fehlen).
    // Drei Zustände, nicht zwei: fehlt das Feld, ist es NICHT "sicher",
    // sondern unbekannt. Unbekannt als grün anzuzeigen wäre eine Lüge.
    mintAuthorityActive: typeof audit.mintAuthorityDisabled === "boolean" ? !audit.mintAuthorityDisabled : null,
    freezeAuthorityActive: typeof audit.freezeAuthorityDisabled === "boolean" ? !audit.freezeAuthorityDisabled : null,
    devMigrations: typeof audit.devMigrations === "number" ? audit.devMigrations : null,
    devMints: typeof audit.devMints === "number" ? audit.devMints : null,

    isToken2022: String(asset.tokenProgram || "").indexOf("Tokenz") === 0,
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    twitter: asset.twitter || null,
    website: asset.website || null,
    telegram: asset.telegram || null,

    // Jupiter liefert den Kurvenfortschritt mal als Anteil (0,81), mal
    // schon als Prozentwert (81,35) - live stand deshalb "Kurve 8135%"
    // in der Liste. Ein Anteil ist nie groesser als 1, ein Prozentwert
    // fast immer; daran lassen sich die beiden sicher unterscheiden.
    bondingCurvePct:
      pool && typeof pool.bondingCurve === "number"
        ? (pool.bondingCurve <= 1 ? pool.bondingCurve * 100 : pool.bondingCurve)
        : null,
    dexUrl: "https://dexscreener.com/solana/" + asset.id,
    pumpUrl: "https://pump.fun/coin/" + asset.id,
  };
}

/**
 * Alle Listen parallel holen und zu einer entdoppelten Kandidatenmenge
 * verschmelzen. Jede Quelle darf ausfallen; zurück kommt, was da ist.
 */
async function discover() {
  const jobs = [
    ["recent", recent()],
    ["organic-5m", topOrganic("5m")],
    ["organic-1h", topOrganic("1h")],
    ["organic-6h", topOrganic("6h")],
    ["organic-24h", topOrganic("24h")],
    ["traded-5m", topTraded("5m")],
    ["traded-1h", topTraded("1h")],
    ["traded-6h", topTraded("6h")],
    ["traded-24h", topTraded("24h")],
  ];

  // Alles in EINEM Durchgang - die Pool-Abfragen hingen vorher hinter den
  // neun Listen und verdoppelten damit das Zeitbudget der Funktion.
  const poolJobs = [pools("listedTime"), pools("volume24h")];
  const all = await Promise.allSettled(jobs.map((j) => j[1]).concat(poolJobs));
  const settled = all.slice(0, jobs.length);
  const poolResults = all.slice(jobs.length);

  const byAddress = new Map();
  const sourceCounts = {};
  let listsOk = 0;

  settled.forEach((res, i) => {
    const label = jobs[i][0];
    if (res.status !== "fulfilled") {
      sourceCounts[label] = 0;
      return;
    }
    listsOk++;
    sourceCounts[label] = res.value.length;
    for (const asset of res.value) {
      const item = normalize(asset, null);
      if (item && !byAddress.has(item.address)) byAddress.set(item.address, item);
    }
  });

  let poolCount = 0;
  poolResults.forEach((res) => {
    if (res.status !== "fulfilled") return;
    for (const pool of res.value) {
      poolCount++;
      const item = normalize(pool.baseAsset, pool);
      if (!item) continue;
      const existing = byAddress.get(item.address);
      if (existing) {
        // Kurvenfortschritt nachtragen, Rest nicht überschreiben.
        if (existing.bondingCurvePct == null) existing.bondingCurvePct = item.bondingCurvePct;
      } else {
        byAddress.set(item.address, item);
      }
    }
  });
  sourceCounts["pools"] = poolCount;

  return {
    items: Array.from(byAddress.values()),
    sourceCounts: sourceCounts,
    listsOk: listsOk,
    listsTotal: jobs.length,
  };
}

/**
 * Der SOL-Kurs in Dollar.
 *
 * Gebraucht fuer die einzige Zahl, die wirklich zaehlt: welchen ANTEIL an
 * einem Coin jemand gerade gekauft hat. Ein SOL in einen 5k-Coin ist eine
 * Ansage, ein SOL in einen 5M-Coin ist unsichtbar - ohne Kurs laesst sich
 * das nicht ausrechnen.
 */
async function solPrice() {
  return cached("jup:solprice", 5 * 60 * 1000, async () => {
    try {
      const hit = await byMint("So11111111111111111111111111111111111111112");
      const usd = hit && (hit.usdPrice || (hit.baseAsset && hit.baseAsset.usdPrice));
      return typeof usd === "number" && usd > 0 ? usd : null;
    } catch (err) {
      return null;
    }
  });
}

module.exports = { discover, normalize, byMint, byMints, recent, topOrganic, topTraded, pools, solPrice };
