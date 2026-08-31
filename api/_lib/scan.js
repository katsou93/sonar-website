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
const jup = require("./jupiter");
const { evaluate, strategyFit } = require("./score");

const BASE58_ONLY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Akzeptiert Adresse, pump.fun-Link, DexScreener-Link, Solscan-Link.
 *
 * Wichtig: NUR der Pfad wird ausgewertet, niemals die Query. Eine
 * DexScreener-URL trägt beim Klick auf einen Trader ein "?maker=<Wallet>"
 * mit sich. Wer von hinten nach dem letzten Base58-String sucht, findet
 * dann die Wallet des Traders und prüft anschliessend seelenruhig den
 * falschen "Coin". Deshalb: Query und Fragment abschneiden, dann im Pfad
 * das letzte Segment nehmen, das wie eine Adresse aussieht.
 */
function extractAddress(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (BASE58_ONLY.test(text)) return text;

  const withoutQuery = text.split("?")[0].split("#")[0];
  const parts = withoutQuery.split(/[/\s]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (BASE58_ONLY.test(parts[i])) return parts[i];
  }
  return null;
}

/**
 * Eine DexScreener-Chart-URL enthält die PAAR-Adresse, nicht den Mint.
 * Findet DexScreener zur Adresse kein Handelspaar, in dem sie der
 * Basis-Token ist, versuchen wir sie als Paar aufzulösen und nehmen den
 * Basis-Token daraus. Erst wenn auch das nichts ergibt, ist die Eingabe
 * wirklich unbrauchbar.
 */
async function resolveToMint(address) {
  try {
    const pairs = await ds.getPairsForToken(address);
    if (pairs.some((p) => p.baseToken && p.baseToken.address === address)) return address;
  } catch (err) {
    return address;
  }
  try {
    const viaPair = await ds.getPairByAddress(address);
    if (viaPair && viaPair.baseToken && viaPair.baseToken.address) return viaPair.baseToken.address;
  } catch (err) {
    /* egal - dann bleibt es bei der Eingabe */
  }
  return address;
}

async function scan(rawInput) {
  const candidate = extractAddress(rawInput);
  const address = candidate ? await resolveToMint(candidate) : null;
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
    jup.byMint(address),
  ]);

  const pairs = settled[0].status === "fulfilled" ? settled[0].value : [];
  const rc = settled[1].status === "fulfilled" ? settled[1].value : null;
  const dist = settled[2].status === "fulfilled" ? settled[2].value : null;
  const mintInfo = settled[3].status === "fulfilled" ? settled[3].value : null;
  const jupAsset = settled[4].status === "fulfilled" ? settled[4].value : null;
  const j = jupAsset ? jup.normalize(jupAsset, null) : null;

  if (settled[0].status === "rejected") warnings.push("DexScreener antwortet nicht - ohne Marktdaten ist der Check wertlos.");
  if (!rc) warnings.push("Rugcheck stumm (Rate-Limit oder Ausfall) - Contract-Zweitmeinung fehlt.");
  if (!j) warnings.push("Jupiter stumm - Holder-Zahl und die Bot-Volumen-Erkennung fehlen für diesen Coin.");
  if (!dist && (!j || j.topHoldersPct == null)) {
    warnings.push("Holder-Verteilung nicht abrufbar - für exakte Werte einen eigenen RPC in SOLANA_RPC hinterlegen.");
  }

  if (!pairs.length && !j) {
    const err = new Error("Kein Handelspaar gefunden. Entweder ist die Adresse falsch oder der Coin ist so neu, dass ihn noch keine Quelle kennt.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const pair = ds.primaryPair(pairs);
  // Jupiter kennt den Graduation-Zeitpunkt exakt; die DEX-Heuristik ist nur Rückfallebene.
  const stage = j && j.stage !== "unknown" ? j.stage : ds.detectStage(pairs);
  const ageMinutes = ds.ageMinutesOf(pairs) != null ? ds.ageMinutesOf(pairs) : j ? j.ageMinutes : null;
  const market = pairs.length ? ds.marketStats(pairs) : marketFromJupiter(j);
  const socials = mergeSocials(ds.extractSocials(pair), j);

  const holders = {
    top10Pct: dist ? dist.top10Pct : null,
    topHolderPct: dist ? dist.topHolderPct : null,
    poolSharePct: dist ? dist.poolSharePct : null,
    topHoldersPctExternal: dist ? null : j ? j.topHoldersPct : null,
    creatorPct: rc ? rc.creatorPct : null,
    totalHolders: rc && rc.totalHolders != null ? rc.totalHolders : j ? j.holderCount : null,
    excludedPools: dist ? dist.excludedPools : [],
    source: [].concat(dist ? ["rpc"] : [], rc ? ["rugcheck"] : [], j ? ["jupiter"] : []),
  };

  // Drei Zustände statt zwei. "Wir wissen es nicht" darf nie als
  // "abgeschaltet" durchgehen - das ist die Frage, an der ein Rug hängt.
  const auth = resolveAuthority(mintInfo, j, rc);
  const authorities = {
    mintAuthority: auth.mint,
    freezeAuthority: auth.freeze,
    authoritiesKnown: auth.known,
    lpLockedPct: rc ? rc.lpLockedPct : null,
  };

  const organic = j
    ? {
        shareH1: j.organicShareH1,
        shareH24: j.organicShareH24,
        scoreLabel: j.organicScoreLabel,
        score: j.organicScore,
        buyersH1: j.organicBuyersH1,
        holderChangeH1: j.holderChangeH1,
      }
    : {};

  const input = {
    market: market,
    holders: holders,
    authorities: authorities,
    socials: socials,
    stage: stage,
    ageMinutes: ageMinutes,
    organic: organic,
    isToken2022: j ? j.isToken2022 : false,
    authoritiesKnown: auth.known,
    rugcheck: rc,
  };

  const result = evaluate(input);
  const fit = strategyFit(input, result.score, result.verdict);

  return {
    address: address,
    chain: "solana",
    name: (pair && pair.baseToken && pair.baseToken.name) || (j && j.name) || null,
    symbol: (pair && pair.baseToken && pair.baseToken.symbol) || (j && j.symbol) || null,
    imageUrl: (pair && pair.info && pair.info.imageUrl) || (j && j.imageUrl) || null,
    launchpad: j ? j.launchpad : null,
    bondingCurvePct: j ? j.bondingCurvePct : null,
    organic: organic,
    holderChangeH1: j ? j.holderChangeH1 : null,
    isToken2022: j ? j.isToken2022 : false,
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
    sources: { dexscreener: pairs.length > 0, rugcheck: !!rc, rpc: !!dist || !!mintInfo, jupiter: !!j },
    fetchedAt: new Date().toISOString(),
    warnings: warnings,
  };
}

/**
 * Mint- und Freeze-Rechte aus der zuverlässigsten verfügbaren Quelle.
 * `known` sagt, ob überhaupt eine Quelle geantwortet hat - ohne das
 * würde eine stumme Kette als "alles sauber" durchgehen.
 */
function resolveAuthority(mintInfo, j, rc) {
  if (mintInfo) return { mint: mintInfo.mintAuthority, freeze: mintInfo.freezeAuthority, known: true };
  if (j && j.mintAuthorityActive !== null && j.freezeAuthorityActive !== null) {
    return {
      mint: j.mintAuthorityActive ? "aktiv" : null,
      freeze: j.freezeAuthorityActive ? "aktiv" : null,
      known: true,
    };
  }
  if (rc && rc.mintAuthority !== undefined) {
    return { mint: rc.mintAuthority, freeze: rc.freezeAuthority, known: true };
  }
  return { mint: null, freeze: null, known: false };
}

/** Rückfallebene, wenn DexScreener den Coin (noch) nicht kennt, Jupiter aber schon. */
function marketFromJupiter(j) {
  if (!j) {
    return {
      priceUsd: null, marketCap: null, fdv: null, liquidityUsd: null,
      volume: { m5: 0, h1: 0, h6: 0, h24: 0 },
      priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
      txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } },
      volumeToLiquidity: null, liquidityToMcap: null, buySellRatioH1: null,
    };
  }
  return {
    priceUsd: j.priceUsd,
    marketCap: j.marketCap,
    fdv: j.marketCap,
    liquidityUsd: j.liquidityUsd,
    volume: { m5: 0, h1: j.volumeH1, h6: 0, h24: j.volumeH24 },
    priceChange: { m5: j.priceChangeM5, h1: j.priceChangeH1, h6: 0, h24: j.priceChangeH24 },
    txns: { m5: { buys: 0, sells: 0 }, h1: { buys: j.buysH1, sells: j.sellsH1 }, h24: { buys: 0, sells: 0 } },
    volumeToLiquidity: j.liquidityUsd ? j.volumeH24 / j.liquidityUsd : null,
    liquidityToMcap: j.liquidityUsd && j.marketCap ? j.liquidityUsd / j.marketCap : null,
    buySellRatioH1: j.buySellRatioH1,
  };
}

function mergeSocials(fromDex, j) {
  return {
    website: (fromDex && fromDex.website) || (j && j.website) || null,
    twitter: (fromDex && fromDex.twitter) || (j && j.twitter) || null,
    telegram: (fromDex && fromDex.telegram) || (j && j.telegram) || null,
    activeBoosts: (fromDex && fromDex.activeBoosts) || 0,
  };
}

module.exports = { scan, extractAddress };
