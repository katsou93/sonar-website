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
  minMarketCapUsd: 0,
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
    minMarketCapUsd: num(q.minMcap, DEFAULT_FILTERS.minMarketCapUsd),
    minLiquidityUsd: num(q.minLiquidity, DEFAULT_FILTERS.minLiquidityUsd),
    minAgeMinutes: num(q.minAge, DEFAULT_FILTERS.minAgeMinutes),
    maxAgeMinutes: q.maxAge === "" || q.maxAge === undefined ? DEFAULT_FILTERS.maxAgeMinutes : num(q.maxAge, null),
    minVolumeH1: num(q.minVolumeH1, DEFAULT_FILTERS.minVolumeH1),
    minOrganicShare: num(q.minOrganic, DEFAULT_FILTERS.minOrganicShare),
    requireSocials: q.socials === "1" || q.socials === "true",
    stage: ["any", "graduated", "bonding_curve"].indexOf(q.stage) !== -1 ? q.stage : "any",
    minScore: num(q.minScore, DEFAULT_FILTERS.minScore),
    sort: ["heat", "new", "volume", "score", "organic", "holders", "early", "surge"].indexOf(q.sort) !== -1 ? q.sort : DEFAULT_FILTERS.sort,
    limit: Math.min(200, Math.max(1, num(q.limit, DEFAULT_FILTERS.limit))),
  };
}

/**
 * Hitze: wie viel Umsatz läuft relativ zur Poolgröße, gewichtet mit dem
 * Anteil echten Volumens und gedämpft durch das Alter. Bewusst simpel und
 * nachrechenbar - ein Wert, den man nicht erklären kann, hilft nicht.
 */
function heatOf(item) {
  // Ohne bekannte Liquidität gibt es keine sinnvolle Umschlagsrate. Früher
  // stand hier "|| 1", wodurch ein Coin ohne Liquiditätsangabe auf das
  // Fünfzigtausendfache der Hitze kam und die Standardsortierung anführte.
  if (!item.liquidityUsd) return 0;
  const liq = item.liquidityUsd;
  const turnover = item.volumeH1 / liq;
  const momentum = Math.max(0, item.priceChangeH1) / 100;
  const real = item.organicShareH1 == null ? 0.5 : Math.max(0.1, Math.min(1, item.organicShareH1 * 3));
  const freshness = item.ageMinutes == null ? 1 : Math.max(0.25, Math.min(1, 720 / (item.ageMinutes + 60)));
  return (turnover * 2 + momentum) * real * freshness;
}

/**
 * Früh-Signal: der on-chain-Schatten von Social-Buzz.
 *
 * Einen X- oder Telegram-Feed nach frühen Calls zu durchsuchen, geht ohne
 * bezahlten API-Zugang nicht verlässlich. Was aber messbar ist: was ein
 * früher Call auslöst. Wenn irgendwo jemand mit Reichweite einen Coin
 * erwähnt, steigt binnen Minuten die Holder-Zahl, es kommen echte Käufer
 * dazu (keine Bots), und die Liquidität wächst - und zwar solange der Coin
 * noch klein ist. Genau diese drei Bewegungen messen wir.
 *
 * Der Wert ist bewusst nachrechenbar: Holder-Wachstum zählt am stärksten,
 * echte Käufer als zweites, wachsende Liquidität als drittes, und alles
 * verfällt mit dem Alter. Ein Coin, der das gleichzeitig zeigt, ist genau
 * der Moment, den man sonst durch Scrollen sucht.
 */
function earlyOf(item) {
  const holderGrowth = Math.max(0, item.holderChangeH1 || 0) / 100;
  const realBuyers = Math.min(1.5, (item.organicBuyersH1 || 0) / 40);
  const liqGrowth = Math.max(0, item.liquidityChangeH1 || 0) / 150;
  const age = item.ageMinutes == null ? 999 : item.ageMinutes;
  const freshness = age <= 180 ? 1 : Math.max(0.15, Math.min(1, 360 / age));
  // Was schon gross ist, kann nicht mehr "früh" sein.
  const small = !item.marketCap ? 1 : Math.max(0.2, Math.min(1, 2000000 / item.marketCap));
  return (holderGrowth * 2 + realBuyers + liqGrowth) * freshness * small;
}

/**
 * Auffälligkeit für etablierte Coins.
 *
 * Bei einem Coin, der Wochen alt ist und Millionen an Liquidität hat, ist
 * die Frage nicht mehr "ist das ein Rug" - das hat er überlebt. Die Frage
 * ist: passiert hier GERADE etwas, das für DIESEN Coin ungewöhnlich ist?
 *
 * Deshalb wird alles am eigenen Normalzustand gemessen, nicht an absoluten
 * Schwellen. Ein Coin mit 50k Stundenumsatz ist unauffällig, wenn er das
 * immer macht - und hochinteressant, wenn sein Schnitt bei 5k liegt.
 *
 *   Umsatzsprung : aktuelle Stunde gegen den 24-Stunden-Schnitt
 *   Holder-Zulauf: kommen echte neue Halter dazu?
 *   Echtheit     : ist der Umsatz echt oder ein Bot-Karussell?
 *   Fruehphase   : steht die Bewegung noch am Anfang oder schon senkrecht?
 *
 * Die letzte Zutat ist die wichtigste und die, die am meisten weh tut:
 * ein Coin, der schon +300% gemacht hat, wird ABGEWERTET, nicht
 * hochgestuft. Wer da einsteigt, kauft von denen, die vorher drin waren.
 */
function surgeOf(item) {
  const avgHourly = item.volumeH24 > 0 ? item.volumeH24 / 24 : 0;
  const volumeSurge = avgHourly > 0 ? item.volumeH1 / avgHourly : item.volumeH1 > 0 ? 3 : 0;
  item.volumeSurge = volumeSurge;

  // Ohne Umsatzsprung ist nichts los - dann hilft auch der Rest nicht.
  if (volumeSurge < 1.2) return 0;

  const surgeScore = Math.min(4, Math.log2(volumeSurge + 1));
  const holderPush = Math.max(0, Math.min(2, (item.holderChangeH1 || 0) / 15));
  const real = item.organicShareH1 == null ? 0.4 : Math.max(0.15, Math.min(1.2, item.organicShareH1 * 4));

  // Je weiter der Kurs schon gelaufen ist, desto weniger interessant.
  const move = item.priceChangeH1 || 0;
  const earlyInMove = move <= 0 ? 0.7 : move < 30 ? 1 : move < 80 ? 0.8 : move < 200 ? 0.45 : 0.2;

  // Verkaufsdruck streicht das Signal.
  const pressure = item.buySellRatioH1 == null ? 1 : item.buySellRatioH1 < 0.9 ? 0.4 : 1;

  return (surgeScore + holderPush) * real * earlyInMove * pressure;
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

/**
 * DexScreener-Kandidaten. Die drei Listen laufen PARALLEL zur
 * Jupiter-Suche - vorher hingen sie dahinter und verdoppelten damit die
 * Laufzeit der Funktion, was auf Vercel in einen Abbruch laufen kann.
 */
async function dexCandidates() {
  const settled = await Promise.allSettled([ds.getLatestProfiles(), ds.getBoosts("latest"), ds.getBoosts("top")]);
  const addresses = [];
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    for (const entry of res.value) {
      const addr = entry && entry.tokenAddress;
      if (addr && addresses.indexOf(addr) === -1) addresses.push(addr);
    }
  }
  return addresses;
}

/** Für die Extra-Adressen die vollen Jupiter-Daten nachholen. */
async function enrich(addresses) {
  if (!addresses.length) return [];
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

  // Beide Entdeckungswege gleichzeitig starten.
  const [discovered, dexAddresses] = await Promise.all([jup.discover(), dexCandidates()]);
  const items = discovered.items.slice();
  const known = new Set(items.map((i) => i.address));

  if (discovered.listsOk === 0) {
    warnings.push("Jupiter antwortet gerade nicht - der Radar läuft nur auf der DexScreener-Ergänzung.");
  } else if (discovered.listsOk < discovered.listsTotal) {
    warnings.push(
      "Nur " + discovered.listsOk + " von " + discovered.listsTotal + " Jupiter-Listen haben geantwortet - es fehlen womöglich Kandidaten.",
    );
  }

  const extras = await enrich(dexAddresses.filter((a) => !known.has(a)));
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
      // Vorab-Bewertung: dem Radar fehlen Holder-Verteilung, LP-Sperre und
      // die Rugcheck-Einzelrisiken. Der volle Scan kann deutlich strenger
      // ausfallen - die Oberfläche weist das entsprechend aus.
      preliminary: true,
      score: result.score,
      verdict: result.verdict,
      topFlags: result.flags.filter((f) => f.level === "red" || f.level === "yellow").slice(0, 3),
      hasSocials: !!(item.twitter || item.telegram || item.website),
    });
    row.heat = heatOf(row);
    row.early = earlyOf(row);
    row.surge = surgeOf(row);
    scored.push(row);
  }

  const filtered = scored.filter((it) => {
    if ((it.marketCap || 0) < filters.minMarketCapUsd) return false;
    if ((it.liquidityUsd || 0) < filters.minLiquidityUsd) return false;
    if (it.volumeH1 < filters.minVolumeH1) return false;
    // Unbekanntes Alter darf einen Altersfilter NICHT passieren. Sonst
    // rutschen Coins ohne Zeitstempel durch das Preset "Früh dran" und
    // lösen bei jedem Alarmlauf erneut eine Meldung aus.
    if (filters.minAgeMinutes > 0 && it.ageMinutes == null) return false;
    if (it.ageMinutes != null && it.ageMinutes < filters.minAgeMinutes) return false;
    if (filters.maxAgeMinutes != null) {
      if (it.ageMinutes == null) return false;
      if (it.ageMinutes > filters.maxAgeMinutes) return false;
    }
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
    if (filters.sort === "early") return b.early - a.early;
    if (filters.sort === "surge") return b.surge - a.surge;
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
