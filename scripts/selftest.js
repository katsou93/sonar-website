"use strict";
/**
 * Selbsttest ohne Netzwerk.
 *
 * Ersetzt global.fetch durch Fixtures und lässt die komplette Kette laufen:
 * DexScreener -> Rugcheck -> RPC -> Holder-Bereinigung -> Score -> Strategie.
 * Damit ist geprüft, dass die Verdrahtung stimmt und die Pool-Erkennung
 * das tut, wofür sie da ist. Echte Daten testet ihr danach live gegen die
 * deployte URL.
 *
 * Aufruf:  node scripts/selftest.js
 */

const assert = require("assert");

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MINT = "So11111111111111111111111111111111111111112";
const CURVE_OWNER = "CurveOwner1111111111111111111111111111111111";
const WALLETS = ["Wal1et11111111111111111111111111111111111111", "Wal1et22222222222222222222222222222222222222"];

let scenario = "healthy";

function jsonResponse(payload) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  });
}

function dexPayload(overrides) {
  const pair = Object.assign(
    {
      chainId: "solana",
      dexId: "pumpswap",
      url: "https://dexscreener.com/solana/test",
      pairAddress: "PairAddr",
      baseToken: { address: MINT, name: "Testcoin", symbol: "TEST" },
      quoteToken: { address: "SOL", name: "Wrapped SOL", symbol: "SOL" },
      priceUsd: "0.00042",
      txns: { m5: { buys: 20, sells: 8 }, h1: { buys: 180, sells: 90 }, h24: { buys: 900, sells: 700 } },
      volume: { m5: 4000, h1: 42000, h6: 120000, h24: 310000 },
      priceChange: { m5: 3, h1: 24, h6: 60, h24: 120 },
      liquidity: { usd: 78000 },
      fdv: 640000,
      marketCap: 640000,
      pairCreatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      info: { imageUrl: "https://example.com/i.png", socials: [{ type: "twitter", url: "https://x.com/test" }] },
      boosts: { active: 0 },
    },
    overrides || {},
  );
  return { pairs: [pair] };
}

function rpcPayload(method) {
  if (method === "getAccountInfo" && scenario === "no-authority-data") {
    return { result: { value: null } };
  }
  if (method === "getTokenLargestAccounts") {
    if (scenario === "only-pools") {
      return { result: { value: [{ address: "TokenAccCurve", uiAmount: 1000000000 }] } };
    }
    return {
      result: {
        value: [
          { address: "TokenAccCurve", uiAmount: 790000000 }, // Bonding Curve / Pool
          { address: "TokenAcc1", uiAmount: 20000000 },
          { address: "TokenAcc2", uiAmount: 10000000 },
        ],
      },
    };
  }
  if (method === "getAccountInfo") {
    return {
      result: {
        value: {
          data: {
            parsed: {
              info: {
                mintAuthority: scenario === "mintable" ? "SomeAuthority1111111111111111111111111111111" : null,
                freezeAuthority: null,
                decimals: 6,
                supply: "1000000000000000",
              },
            },
          },
        },
      },
    };
  }
  return { result: null };
}

function multiplePayload(params) {
  const addresses = params[0];
  if (scenario === "only-pools") {
    if (addresses[0] === "TokenAccCurve") return { result: { value: [{ data: { parsed: { info: { owner: CURVE_OWNER } } } }] } };
    return { result: { value: addresses.map(() => ({ owner: PUMP_PROGRAM })) } };
  }
  // Erster Aufruf: Token-Konten -> Besitzer
  if (addresses[0] === "TokenAccCurve") {
    return {
      result: {
        value: [
          { data: { parsed: { info: { owner: CURVE_OWNER } } } },
          { data: { parsed: { info: { owner: WALLETS[0] } } } },
          { data: { parsed: { info: { owner: WALLETS[1] } } } },
        ],
      },
    };
  }
  // Zweiter Aufruf: Besitzer -> welchem Programm gehört das Konto?
  return {
    result: {
      value: addresses.map((addr) => ({ owner: addr === CURVE_OWNER ? PUMP_PROGRAM : "11111111111111111111111111111111" })),
    },
  };
}

/** Jupiter-Asset in der echten Form der lite-API. */
function jupAsset(over) {
  const o = over || {};
  return Object.assign(
    {
      id: MINT,
      name: "Testcoin",
      symbol: "TEST",
      icon: "https://example.com/i.png",
      decimals: 6,
      dev: "Creator11111111111111111111111111111111111111",
      circSupply: 1000000000,
      totalSupply: 1000000000,
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      launchpad: "pump.fun",
      graduatedPool: "PoolAddr",
      graduatedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      holderCount: 1240,
      fdv: 640000,
      mcap: 640000,
      usdPrice: 0.00042,
      liquidity: 78000,
      organicScore: 66,
      organicScoreLabel: "medium",
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 17.2 },
      stats1h: {
        priceChange: 24, holderChange: 12, liquidityChange: 8,
        buyVolume: 22000, sellVolume: 20000,
        buyOrganicVolume: 9000, sellOrganicVolume: 8000,
        numBuys: 180, numSells: 90, numTraders: 300, numOrganicBuyers: 90, numNetBuyers: 60,
      },
      stats24h: {
        priceChange: 120, holderChange: 200,
        buyVolume: 160000, sellVolume: 150000,
        buyOrganicVolume: 60000, sellOrganicVolume: 55000,
        numBuys: 900, numSells: 700, numTraders: 1200, numOrganicBuyers: 400, numNetBuyers: 200,
      },
      firstPool: { id: "PoolAddr", createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() },
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      tags: [],
    },
    o,
  );
}

/** Kandidatenliste mit eindeutigen Adressen, um die Entdopplung zu prüfen. */
function jupList(count, prefix) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = jupAsset();
    // Bewusst UNTERSCHIEDLICHE Werte: mit lauter gleichen Zahlen wäre jede
    // Sortier-Assertion automatisch wahr und der Test wertlos.
    const organic = 1000 + i * 700;
    out.push(
      jupAsset({
        id: prefix + String(i).padStart(4, "0") + "1".repeat(34),
        symbol: prefix + i,
        name: prefix + " " + i,
        holderCount: 100 + i * 37,
        liquidity: 20000 + i * 1500,
        stats1h: Object.assign({}, base.stats1h, {
          buyOrganicVolume: organic,
          sellOrganicVolume: organic,
          holderChange: i,
        }),
      }),
    );
  }
  return out;
}

global.fetch = function (url, options) {
  const href = String(url);

  if (href.indexOf("datapi.jup.ag") !== -1) {
    return jsonResponse({ pools: [{ id: "p1", bondingCurve: 0.42, baseAsset: jupAsset({ id: "POOLONLY" + "1".repeat(35), symbol: "POOL", graduatedAt: null }) }] });
  }
  if (href.indexOf("jup.ag") !== -1) {
    if (scenario === "jupiter-down") return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    if (href.indexOf("/search?query=") !== -1) {
      const ids = decodeURIComponent(href.split("query=")[1] || "").split(",");
      if (scenario === "wash") return jsonResponse([jupAsset({ stats1h: Object.assign(jupAsset().stats1h, { buyOrganicVolume: 200, sellOrganicVolume: 150 }) })]);
      // Jupiter sucht auch ueber Namen: ein Treffer mit ANDERER id darf nie
      // als Antwort auf die angefragte Adresse durchgehen.
      if (scenario === "jupiter-wrong-token")
        return jsonResponse([jupAsset({ id: "FREMD" + "1".repeat(38), symbol: "FREMD", name: "Ganz anderer Coin" })]);
      if (scenario === "no-authority-data")
        return jsonResponse(ids.map((id) => jupAsset({ id: id, audit: { topHoldersPercentage: 17.2 } })));
      return jsonResponse(ids.map((id) => jupAsset({ id: id })));
    }
    if (href.indexOf("/recent") !== -1) return jsonResponse(jupList(20, "R"));
    if (href.indexOf("/toporganicscore/") !== -1) return jsonResponse(jupList(15, "O"));
    if (href.indexOf("/toptraded/") !== -1) return jsonResponse(jupList(15, "T"));
    return jsonResponse([]);
  }

  if (href.indexOf("api.dexscreener.com/latest/dex/tokens") !== -1) {
    if (scenario === "thin") return jsonResponse(dexPayload({ liquidity: { usd: 900 } }));
    if (scenario === "dumping")
      return jsonResponse(dexPayload({ txns: { m5: { buys: 1, sells: 9 }, h1: { buys: 20, sells: 120 }, h24: { buys: 100, sells: 400 } } }));
    return jsonResponse(dexPayload());
  }
  if (href.indexOf("api.dexscreener.com/token-profiles") !== -1) {
    return jsonResponse([{ chainId: "solana", tokenAddress: MINT, url: "x" }]);
  }
  if (href.indexOf("api.dexscreener.com/token-boosts") !== -1) {
    return jsonResponse([]);
  }
  if (href.indexOf("rugcheck.xyz") !== -1) {
    if (scenario === "no-authority-data") return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    return jsonResponse({
      score_normalised: 12,
      risks: [{ name: "Mutable metadata", description: "Name und Bild können geändert werden", level: "warn", score: 100 }],
      creator: "Creator11111111111111111111111111111111111111",
      creatorBalance: "10000000000000",
      token: { supply: "1000000000000000", decimals: 6, mintAuthority: null, freezeAuthority: null },
      totalHolders: 1240,
      markets: [{ lp: { lpLockedPct: 100 } }],
      rugged: false,
    });
  }
  if (href.indexOf("solana.com") !== -1 || href.indexOf("helius") !== -1) {
    const body = JSON.parse(options.body);
    const handle = (call) => {
      if (call.method === "getMultipleAccounts") return Object.assign({ id: call.id }, multiplePayload(call.params));
      return Object.assign({ id: call.id }, rpcPayload(call.method));
    };
    return jsonResponse(Array.isArray(body) ? body.map(handle) : handle(body));
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
};

const { isNoise } = require("../api/_lib/feed");
const { scan, extractAddress } = require("../api/_lib/scan");
const { buildFeed } = require("../api/_lib/feed");
const { resetCache } = require("../api/_lib/http");

/** Szenario wechseln heißt: Cache weg, sonst antwortet die alte Fixture. */
function setScenario(name) {
  scenario = name;
  resetCache();
}

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log("  ok   " + name))
    .catch((err) => {
      failures++;
      console.log("  FAIL " + name + "\n       " + err.message);
    });
}

async function main() {
  console.log("\nAdressen erkennen");
  await check("nackte Adresse", () => assert.strictEqual(extractAddress(MINT), MINT));
  await check("pump.fun-Link", () => assert.strictEqual(extractAddress("https://pump.fun/coin/" + MINT), MINT));
  await check("DexScreener-Link", () => assert.strictEqual(extractAddress("https://dexscreener.com/solana/" + MINT + "?maker=x"), MINT));
  await check("Unsinn wird abgelehnt", () => assert.strictEqual(extractAddress("hallo welt"), null));

  console.log("\nGesunder Coin");
  setScenario("healthy");
  const good = await scan(MINT);
  await check("Pool wird aus der Holder-Rechnung entfernt", () => {
    // 790M der 1000M liegen in der Kurve -> verteilbar sind 210M.
    // Größter echter Holder hält 40M = 19% davon, nicht 4%.
    assert.ok(good.holders.poolSharePct > 78, "poolSharePct=" + good.holders.poolSharePct);
    // 20M von 210M verteilbarem Angebot = 9,5% - nicht 2%, wie es mit Pool aussähe.
    assert.ok(good.holders.topHolderPct > 9 && good.holders.topHolderPct < 10, "topHolderPct=" + good.holders.topHolderPct);
  });
  await check("Score und Verdikt plausibel", () => {
    assert.ok(good.score >= 45, "score=" + good.score);
    assert.notStrictEqual(good.verdict, "avoid");
  });
  await check("jedes Flag hat eine Begründung", () => {
    good.flags.forEach((f) => assert.ok(f.title && f.detail !== undefined, "leeres Flag: " + JSON.stringify(f)));
  });
  await check("Score = 100 minus Summe der Abzüge", () => {
    const penalties = good.flags.reduce((s, f) => s + f.penalty, 0);
    assert.strictEqual(good.score, Math.max(0, Math.min(100, 100 - penalties)));
  });
  await check("Strategie A akzeptiert den gereiften Coin", () =>
    assert.strictEqual(good.fit.defensive, true, "Blocker: " + good.fit.defensiveBlockers.join(", ")));
  await check("alle vier Quellen gemeldet", () =>
    assert.deepStrictEqual(good.sources, { dexscreener: true, rugcheck: true, rpc: true, jupiter: true }));

  console.log("\nMint-Authority aktiv");
  setScenario("mintable");
  const mintable = await scan(MINT);
  await check("wird fatal und landet auf avoid", () => {
    assert.strictEqual(mintable.verdict, "avoid");
    assert.ok(mintable.score <= 12, "score=" + mintable.score);
    assert.ok(mintable.flags.some((f) => f.id === "mint_authority" && f.fatal));
  });
  await check("beide Strategien lehnen ab", () => {
    assert.strictEqual(mintable.fit.defensive, false);
    assert.strictEqual(mintable.fit.aggressive, false);
  });

  console.log("\nKeine Liquidität");
  setScenario("thin");
  const thin = await scan(MINT);
  await check("fataler Liquiditäts-Flag", () => {
    assert.ok(thin.flags.some((f) => f.id === "no_liquidity" && f.fatal));
    assert.strictEqual(thin.verdict, "avoid");
  });

  console.log("\nVerkaufsdruck");
  setScenario("dumping");
  const dumping = await scan(MINT);
  await check("Verkaufsdruck wird erkannt", () => assert.ok(dumping.flags.some((f) => f.id === "sell_pressure")));

  console.log("\nBot-Volumen");
  setScenario("wash");
  const wash = await scan(MINT);
  await check("Wash-Trading wird erkannt und rot geflaggt", () => {
    const f = wash.flags.find((x) => x.id === "wash_extreme");
    assert.ok(f, "kein wash_extreme-Flag: " + wash.flags.map((x) => x.id).join(", "));
    assert.strictEqual(f.level, "red");
  });
  await check("Holder-Zahl kommt von Jupiter", () => assert.strictEqual(wash.holders.totalHolders, 1240));

  console.log("\nRadar");
  setScenario("healthy");
  const feed = await buildFeed({ minLiquidity: 1000, minVolumeH1: 100, minAge: 0, limit: 200 });
  await check("liefert Einträge mit Score", () => {
    assert.ok(feed.items.length >= 1);
    assert.ok(typeof feed.items[0].score === "number");
    assert.ok(feed.items[0].heat >= 0);
  });
  await check("viele Kandidaten statt einer Handvoll", () => {
    // 20 aus recent + 15 organic + 15 traded + 1 Pool, über alle Zeiträume entdoppelt
    assert.ok(feed.scanned >= 45, "nur " + feed.scanned + " Kandidaten");
  });
  await check("Adressen sind entdoppelt", () => {
    const seen = new Set(feed.items.map((i) => i.address));
    assert.strictEqual(seen.size, feed.items.length);
  });
  await check("Kurvenfortschritt aus der Pool-Liste kommt an", () => {
    const withCurve = feed.items.find((i) => i.bondingCurvePct != null);
    assert.ok(withCurve, "kein Eintrag mit bondingCurvePct");
    assert.ok(Math.abs(withCurve.bondingCurvePct - 42) < 0.001);
  });
  await check("Filter greifen", async () => {
    const strict = await buildFeed({ minLiquidity: 10000000 });
    assert.strictEqual(strict.items.length, 0);
  });
  await check("Sortierung nach echtem Volumen läuft", async () => {
    const byOrganic = await buildFeed({ minLiquidity: 1000, minVolumeH1: 100, minAge: 0, sort: "organic", limit: 200 });
    for (let i = 1; i < byOrganic.items.length; i++) {
      assert.ok((byOrganic.items[i - 1].organicShareH1 || 0) >= (byOrganic.items[i].organicShareH1 || 0));
    }
  });

  console.log("\nJupiter fällt aus");
  setScenario("jupiter-down");
  const degraded = await buildFeed({ minLiquidity: 0, minVolumeH1: 0, minAge: 0 });
  await check("Radar stürzt nicht ab, sondern warnt", () => {
    assert.ok(Array.isArray(degraded.items));
    assert.ok(degraded.warnings.some((w) => /Jupiter/.test(w)), "keine Warnung: " + JSON.stringify(degraded.warnings));
  });
  await check("Scan läuft ohne Jupiter weiter", async () => {
    const still = await scan(MINT);
    assert.strictEqual(still.sources.jupiter, false);
    assert.ok(still.score >= 0);
  });

  console.log("\nRegressionen aus dem Code-Review");

  await check("DexScreener-Link mit ?maker= liefert NICHT die Wallet", () => {
    const maker = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    assert.strictEqual(extractAddress("https://dexscreener.com/solana/" + mint + "?maker=" + maker), mint);
  });
  await check("Fragment und Query werden ignoriert", () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    assert.strictEqual(extractAddress("https://pump.fun/coin/" + mint + "#chart"), mint);
  });

  await check("kein Bericht mit den Daten eines fremden Coins", async () => {
    setScenario("jupiter-wrong-token");
    const r = await scan(MINT);
    // Jupiter liefert hier absichtlich einen anderen Token. Der Bericht darf
    // dessen Zahlen nicht übernehmen.
    assert.notStrictEqual(r.symbol, "FREMD", "fremdes Symbol im Bericht");
    assert.strictEqual(r.sources.jupiter, false, "fremder Treffer wurde als Jupiter-Quelle gezählt");
  });

  await check("alle Top-Konten sind Pools => Verteilung unbekannt, nicht 0%", async () => {
    setScenario("only-pools");
    const r = await scan(MINT);
    assert.strictEqual(r.holders.top10Pct, null, "top10Pct=" + r.holders.top10Pct);
    assert.strictEqual(r.holders.topHolderPct, null);
    assert.ok(!r.flags.some((f) => f.id === "top10_ok"), "meldet faelschlich breite Verteilung");
  });

  await check("unbekannte Contract-Rechte werden bestraft, nicht als sicher gewertet", async () => {
    setScenario("no-authority-data");
    const r = await scan(MINT);
    assert.strictEqual(r.authorities.authoritiesKnown, false);
    assert.ok(r.flags.some((f) => f.id === "authorities_unknown"), "kein Flag fuer unbekannte Rechte");
    assert.ok(r.score < 100);
  });

  setScenario("healthy");
  await check("Coins ohne Alter passieren keinen Altersfilter", async () => {
    const f = await buildFeed({ minLiquidity: 0, minVolumeH1: 0, minAge: 0, maxAge: 240, limit: 200 });
    assert.ok(f.items.every((i) => i.ageMinutes != null), "Eintrag ohne Alter durchgelassen");
  });

  await check("Sortierung nach echtem Volumen ist echt sortiert", async () => {
    const f = await buildFeed({ minLiquidity: 0, minVolumeH1: 0, minAge: 0, sort: "organic", limit: 200 });
    const shares = f.items.map((i) => i.organicShareH1 || 0);
    assert.ok(new Set(shares).size > 3, "Fixtures haben zu wenig Varianz - Test waere gehaltlos");
    for (let i = 1; i < shares.length; i++) assert.ok(shares[i - 1] >= shares[i], "nicht absteigend");
  });

  await check("Coins ohne Liquiditaet dominieren die Hitze nicht", async () => {
    const f = await buildFeed({ minLiquidity: 0, minVolumeH1: 0, minAge: 0, sort: "heat", limit: 200 });
    const top = f.items[0];
    assert.ok(!top || top.liquidityUsd, "Eintrag ohne Liquiditaet steht ganz oben");
  });

  console.log("\nGrundmenge sauber halten");
  // Echte Namen aus zwei Live-Abrufen. Ohne diesen Filter standen
  // tokenisierte Aktien, Gold und Stablecoins im Memecoin-Radar.
  const RAUS = [
    ["cbBTC", "Coinbase Wrapped BTC", 0.004, 3e6], ["USD1", "World Liberty Financial USD", 1.0, 3e6],
    ["ETH", "Ether (Portal)", 0.004, 3e6], ["JupUSD", "Jupiter USD", 1.0, 3e6],
    ["NVDAx", "NVIDIA xStock", 180, 3e6], ["SPYx", "SP500 xStock", 600, 3e6],
    ["MU", "Micron Technology - Backpack Securities", 90, 3e6], ["RAY", "Raydium", 2, 3e6],
    ["PAXG", "PAX Gold", 3900, 3e6], ["XAUt0", "Tether Gold", 3900, 3e6],
    ["tSpaceX", "SpaceX Pre-IPO", 0.5, 3e6], ["jlUSDC", "Jupiter Lend USDC", 1.0, 2e5],
  ];
  const DRIN = [
    ["OTC", "OTC", 0.004], ["USELESS", "USELESS COIN", 0.2], ["jailstool", "Stool Prisondente", 0.004],
    ["CYBERLEEK", "CyberLeek", 0.004], ["Fartcoin", "Fartcoin", 0.9], ["PENGU", "Pudgy Penguins", 0.03],
    ["TRUMP", "OFFICIAL TRUMP", 8], ["Jimothy", "Jimothy The Raccoon", 0.004],
    ["HeeHaw", "Justice for HeeHaw", 0.004], ["SPX", "SPX6900", 1.4], ["Bonk", "Bonk", 0.00002],
  ];
  await check("Aktien, Gold und Stablecoins fliegen raus", () => {
    RAUS.forEach(function (row) {
      assert.ok(isNoise({ symbol: row[0], name: row[1], priceUsd: row[2], marketCap: row[3], tags: [] }),
        row[0] + " (" + row[1] + ") haette rausfliegen muessen");
    });
  });
  await check("echte Memecoins bleiben drin", () => {
    DRIN.forEach(function (row) {
      assert.ok(!isNoise({ symbol: row[0], name: row[1], priceUsd: row[2], marketCap: 3e6, tags: [] }),
        row[0] + " wurde faelschlich aussortiert");
    });
  });
  await check("ein Memecoin bei genau einem Dollar ueberlebt", () => {
    assert.ok(!isNoise({ symbol: "EINS", name: "Ein Dollar Coin", priceUsd: 1.0, marketCap: 120000, tags: [] }));
  });

  console.log("\nThemen erkennen");
  const nar = require("../api/_lib/narrative");
  const sectorOf = nar.sectorOf;

  const ZUORDNUNG = [
    ["popcat", "Popcat", "katze"],
    ["MICHI", "michi", "katze"],
    ["WIF", "dogwifhat", "hund"],
    ["BONK", "Bonk", "hund"],
    ["PEPE", "Pepe", "frosch"],
    ["GOAT", "Goatseus Maximus", "tier"],
    ["FARTCOIN", "Fartcoin", null],
    ["CHILLGUY", "Just a chill guy", null],
    ["AI16Z", "ai16z", "ki"],
    ["TRUMP", "OFFICIAL TRUMP", "politik"],
    ["BANANA", "Banana Gun", "essen"],
    ["CHAD", "Gigachad", "kultur"],
    ["MOON", "Moonshot", "weltraum"],
    ["CAPY", "Capybara Nation", "tier"],
  ];
  for (const row of ZUORDNUNG) {
    await check("\"" + row[1] + "\" landet bei " + (row[2] || "keiner Ecke"), () => {
      assert.strictEqual(sectorOf({ symbol: row[0], name: row[1] }), row[2]);
    });
  }

  // Die gefaehrlichen Faelle: kurze Begriffe duerfen NICHT als Teilstring
  // treffen. Sonst ist jeder Coin mit "chain" im Namen ein KI-Coin.
  const KEINE_FEHLTREFFER = [
    ["CHAIN", "Chainlink Wrapped"],
    ["ESCAPE", "Escape Velocity"],
    ["CATALYST", "Catalyst Protocol"],
    ["PAPER", "Paper Hands"],
    ["LOCATION", "Location Token"],
    ["GRAPE", "Grape Protocol"],
    ["DOGMA", "Dogma"],
  ];
  for (const row of KEINE_FEHLTREFFER) {
    await check("\"" + row[1] + "\" wird keiner Ecke zugeordnet", () => {
      assert.strictEqual(sectorOf({ symbol: row[0], name: row[1] }), null,
        row[1] + " wurde faelschlich einsortiert");
    });
  }

  await check("eine Ecke mit zwei Mitgliedern ist noch kein Thema", () => {
    const res = nar.measure([
      { address: "a", symbol: "CAT1", name: "Cat One", priceChangeH1: 40, volumeH1: 1000 },
      { address: "b", symbol: "CAT2", name: "Cat Two", priceChangeH1: 50, volumeH1: 1000 },
    ]);
    assert.strictEqual(res.sectors.length, 0);
  });

  await check("vier steigende Katzen ergeben ein heisses Thema", () => {
    const katzen = [30, 25, 18, 22].map((chg, i) => ({
      address: "cat" + i, symbol: "CAT" + i, name: "Cat " + i,
      priceChangeH1: chg, volumeH1: 50000, volumeSurge: 2.5, liquidityUsd: 80000,
    }));
    const res = nar.measure(katzen);
    assert.strictEqual(res.sectors.length, 1);
    assert.strictEqual(res.sectors[0].key, "katze");
    assert.ok(res.sectors[0].hot, "Ecke haette heiss sein muessen, Hitze " + res.sectors[0].heat);
    assert.strictEqual(res.sectors[0].up, 4);
  });

  await check("ein einzelner Ausreisser macht die Ecke NICHT heiss", () => {
    // Genau der Fehler, den ein naiver Durchschnitt machen wuerde: einer
    // steht auf +400, die anderen drei liegen flach. Der Mittelwert waere
    // +100 - die Breite verrät, dass da kein Thema laeuft.
    const froesche = [400, -2, 1, -4].map((chg, i) => ({
      address: "frog" + i, symbol: "PEPE" + i, name: "Pepe " + i,
      priceChangeH1: chg, volumeH1: 20000, volumeSurge: 1.0, liquidityUsd: 50000,
    }));
    const res = nar.measure(froesche);
    assert.strictEqual(res.sectors[0].key, "frosch");
    assert.ok(!res.sectors[0].hot, "Ausreisser hat die Ecke faelschlich heiss gemacht, Hitze " + res.sectors[0].heat);
  });

  await check("der Nachzuegler in einer heissen Ecke wird gefunden", () => {
    const hunde = [
      { address: "d1", symbol: "DOG1", name: "Dog One", priceChangeH1: 35, volumeH1: 90000, volumeSurge: 3, liquidityUsd: 200000 },
      { address: "d2", symbol: "DOG2", name: "Dog Two", priceChangeH1: 28, volumeH1: 80000, volumeSurge: 2.6, liquidityUsd: 180000 },
      { address: "d3", symbol: "DOG3", name: "Dog Three", priceChangeH1: 22, volumeH1: 70000, volumeSurge: 2.2, liquidityUsd: 160000 },
      { address: "d4", symbol: "DOG4", name: "Dog Four", priceChangeH1: 2, volumeH1: 40000, volumeSurge: 1.9, liquidityUsd: 120000 },
    ];
    const res = nar.measure(hunde);
    const ecke = res.sectors[0];
    assert.ok(ecke.hot);
    assert.ok(ecke.laggards.length >= 1, "kein Nachzuegler gefunden");
    assert.strictEqual(ecke.laggards[0].symbol, "DOG4");
    assert.strictEqual(hunde[3].sectorLaggard, true);
    assert.strictEqual(hunde[0].sectorLaggard, false);
  });

  await check("ein Nachzuegler ohne Volumen zaehlt nicht als Nachzuegler", () => {
    const hunde = [
      { address: "e1", symbol: "INU1", name: "Inu One", priceChangeH1: 35, volumeH1: 90000, volumeSurge: 3, liquidityUsd: 200000 },
      { address: "e2", symbol: "INU2", name: "Inu Two", priceChangeH1: 28, volumeH1: 80000, volumeSurge: 2.6, liquidityUsd: 180000 },
      { address: "e3", symbol: "INU3", name: "Inu Three", priceChangeH1: 22, volumeH1: 70000, volumeSurge: 2.2, liquidityUsd: 160000 },
      { address: "e4", symbol: "INU4", name: "Inu Four", priceChangeH1: 1, volumeH1: 500, volumeSurge: 0.4, liquidityUsd: 120000 },
    ];
    const res = nar.measure(hunde);
    assert.strictEqual(res.sectors[0].laggards.length, 0);
  });

  await check("eine kalte Ecke meldet gar keine Nachzuegler", () => {
    const kalt = [1, -3, 0, 2].map((chg, i) => ({
      address: "cold" + i, symbol: "MOON" + i, name: "Moon " + i,
      priceChangeH1: chg, volumeH1: 10000, volumeSurge: 1.5, liquidityUsd: 60000,
    }));
    const res = nar.measure(kalt);
    assert.ok(!res.sectors[0].hot);
    assert.strictEqual(res.sectors[0].laggards.length, 0);
  });

  await check("ein spezifischer Treffer schlaegt einen allgemeinen", () => {
    // "Capybara Moon" enthaelt "moon" (Wort) und "capybara" (Teilstring).
    // Der spezifischere gewinnt.
    assert.strictEqual(sectorOf({ symbol: "CAPYMOON", name: "Capybara Moon" }), "tier");
  });

  await check("Mehrzahl wird erkannt, schlaegt aber keine Einzahl", () => {
    assert.strictEqual(sectorOf({ symbol: "FROGS", name: "Frogs United" }), "frosch");
    // Der echte Fall: MEW heisst "cat in a dogs world". Die Einzahl "cat"
    // muss die Mehrzahl "dogs" schlagen, sonst ist der bekannteste
    // Katzen-Coin ein Hunde-Coin.
    assert.strictEqual(sectorOf({ symbol: "MEW", name: "cat in a dogs world" }), "katze");
  });

  await check("camelCase wird korrekt zerlegt", () => {
    assert.deepStrictEqual(nar.tokenize("dogWifHat"), ["dog", "wif", "hat"]);
  });

  console.log("\nWortwellen");
  await check("fuenf frische Coins mit demselben Wort ergeben eine Welle", () => {
    const mk = (sym, name, age, chg) => ({ address: sym, symbol: sym, name: name, ageMinutes: age, priceChangeH1: chg, volumeH1: 30000, volumeSurge: 2 });
    const waves = nar.discoverWaves([
      mk("JIMO", "Jimothy Raccoon", 40, 60), mk("RACC", "Raccoon Seattle", 90, 35),
      mk("JIM2", "jimothy the raccoon", 25, 120), mk("SPIN", "Short Spine Raccoon", 60, 20),
      mk("TRSH", "Trash Panda Raccoon", 120, -5),
    ]);
    assert.strictEqual(waves[0].word, "raccoon");
    assert.strictEqual(waves[0].coins, 5);
    assert.ok(waves[0].strength >= 55, "zu schwach bewertet: " + waves[0].strength);
  });

  await check("dieselbe Welle unter uralten Coins ist viel schwaecher", () => {
    const mk = (sym, name) => ({ address: sym, symbol: sym, name: name, ageMinutes: 60000, priceChangeH1: 1, volumeH1: 30000, volumeSurge: 1 });
    const waves = nar.discoverWaves([
      mk("A", "Raccoon One"), mk("B", "Raccoon Two"), mk("C", "Raccoon Three"),
      mk("D", "Raccoon Four"), mk("E", "Raccoon Five"),
    ]);
    assert.ok(waves[0].strength < 55, "alte Coins haetten keine starke Welle sein duerfen: " + waves[0].strength);
  });

  await check("Fuellwoerter bilden keine Welle", () => {
    const mk = (sym, name) => ({ address: sym, symbol: sym, name: name, ageMinutes: 30, priceChangeH1: 30, volumeH1: 10000 });
    const waves = nar.discoverWaves([
      mk("A", "Alpha Coin Token"), mk("B", "Beta Coin Token"), mk("C", "Gamma Coin Token"),
      mk("D", "Delta Coin Token"),
    ]);
    assert.strictEqual(waves.length, 0, "gefunden: " + waves.map((w) => w.word).join(","));
  });

  await check("zwei Coins sind noch keine Welle", () => {
    const mk = (sym, name) => ({ address: sym, symbol: sym, name: name, ageMinutes: 20, priceChangeH1: 50, volumeH1: 10000 });
    assert.strictEqual(nar.discoverWaves([mk("A", "Raccoon One"), mk("B", "Raccoon Two")]).length, 0);
  });

  await check("eine Mint-Farm wird erkannt und abgewertet", () => {
    // Live beobachtet: drei Coins "leagle", alle exakt +0%, alle drei
    // Minuten alt. Ein Bot, kein Thema.
    const klon = (i) => ({ address: "k" + i, symbol: "leagle", name: "leagle", ageMinutes: 3, priceChangeH1: 0, volumeH1: 30 });
    const wave = nar.discoverWaves([klon(1), klon(2), klon(3)])[0];
    assert.strictEqual(wave.farmSuspect, true);
    assert.ok(wave.strength < 25, "Farm haette abgewertet werden muessen: " + wave.strength);
  });

  await check("eine echte Welle wird NICHT als Farm abgetan", () => {
    const mk = (i, chg, vol) => ({ address: "c" + i, symbol: "CRIME" + i, name: "Crime " + i, ageMinutes: 2, priceChangeH1: chg, volumeH1: vol, volumeSurge: 2 });
    const wave = nar.discoverWaves([mk(1, 149, 40000), mk(2, 285, 90000), mk(3, 28, 20000)])[0];
    assert.strictEqual(wave.farmSuspect, false);
    assert.ok(wave.strength >= 55, "echte Welle zu schwach: " + wave.strength);
  });

  await check("ein einzelner echter Coin rettet eine Farm nicht", () => {
    const echt = { address: "e", symbol: "CRIME", name: "Crime Boss", ageMinutes: 2, priceChangeH1: 149, volumeH1: 40000, volumeSurge: 3 };
    const klon = (i) => ({ address: "f" + i, symbol: "CR" + i, name: "Crime Clone", ageMinutes: 2, priceChangeH1: 0, volumeH1: 5 });
    const wave = nar.discoverWaves([echt, klon(1), klon(2), klon(3)])[0];
    assert.strictEqual(wave.farmSuspect, true, "drei von vier tot - das ist eine Farm");
  });

  console.log("\nStichwort-Wache");
  const ww = require("../api/_lib/watchwords");

  await check("kurze Stichworte treffen nur als ganzes Wort", () => {
    assert.strictEqual(ww.matchWord({ symbol: "PAPER", name: "Paper Hands" }, ["ape"]), null);
    assert.strictEqual(ww.matchWord({ symbol: "APE", name: "Ape Strong" }, ["ape"]), "ape");
  });

  await check("lange Stichworte treffen auch mitten im Namen", () => {
    assert.strictEqual(ww.matchWord({ symbol: "JIMO", name: "JimothyRaccoonCoin" }, ["raccoon"]), "raccoon");
  });

  await check("zu kurze oder leere Stichworte fliegen raus", () => {
    assert.deepStrictEqual(ww.parseWords("ai, x, , raccoon, RACCOON, hormuz"), ["raccoon", "hormuz"]);
  });

  await check("ein Betrugs-Coin mit passendem Namen kommt nicht in Stufe 2", () => {
    const res = ww.scan([{
      address: "scam", symbol: "RACCOON", name: "Jimothy Raccoon",
      liquidityUsd: 400, volumeH1: 900, organicShareH1: 0, holderCount: 12,
      mintAuthorityActive: true, topFlags: [],
    }], ["raccoon"]);
    assert.strictEqual(res.substance.length, 0, "Betrugs-Coin haette Alarm ausgeloest");
    assert.strictEqual(res.seen.length, 1);
    assert.ok(res.seen[0].watchReasons.length >= 3);
  });

  await check("ein Coin mit Substanz kommt in Stufe 2", () => {
    const res = ww.scan([{
      address: "gut", symbol: "RACC", name: "Raccoon Seattle",
      liquidityUsd: 95000, volumeH1: 140000, organicShareH1: 0.42, holderCount: 1400,
      mintAuthorityActive: false, freezeAuthorityActive: false, topFlags: [],
    }], ["raccoon"]);
    assert.strictEqual(res.substance.length, 1);
    assert.strictEqual(res.substance[0].watchLevel, "substanz");
  });

  await check("unbekannte Echtheit reicht nicht fuer Stufe 2", () => {
    const res = ww.scan([{
      address: "unklar", symbol: "RACC", name: "Raccoon", liquidityUsd: 95000,
      volumeH1: 140000, organicShareH1: null, holderCount: 900, topFlags: [],
    }], ["raccoon"]);
    assert.strictEqual(res.substance.length, 0);
  });

  await check("leere Wortliste schaltet die Wache ab", () => {
    const res = ww.scan([{ address: "x", symbol: "RACC", name: "Raccoon", liquidityUsd: 95000, volumeH1: 140000, organicShareH1: 0.4, holderCount: 900, topFlags: [] }], "");
    assert.strictEqual(res.substance.length, 0);
    assert.strictEqual(res.seen.length, 0);
  });

  console.log("\nAussenwelt");
  const bz = require("../api/_lib/buzz");

  const TRENDS_XML =
    '<rss><channel>' +
    '<item><title>Jimothy the Raccoon</title><ht:approx_traffic>20,000+</ht:approx_traffic></item>' +
    '<item><title><![CDATA[Ford Field &amp; Weather Today]]></title><ht:approx_traffic>5,000+</ht:approx_traffic></item>' +
    '<item><title>GME Stock Price</title></item>' +
    '</channel></rss>';

  await check("RSS-Titel werden samt CDATA und Entities gelesen", () => {
    const titles = bz.rssTitles(TRENDS_XML);
    assert.strictEqual(titles.length, 3);
    assert.strictEqual(titles[0].title, "Jimothy the Raccoon");
    assert.strictEqual(titles[0].traffic, 20000);
    assert.strictEqual(titles[1].title, "Ford Field & Weather Today");
  });

  await check("kaputtes RSS wirft nicht, sondern liefert nichts", () => {
    assert.deepStrictEqual(bz.rssTitles("<html>kein rss</html>"), []);
    assert.deepStrictEqual(bz.rssTitles(null), []);
  });

  await check("Nachrichten-Fuellwoerter werden aussortiert", () => {
    const bucket = new Map();
    bz.termsFromTitles(bz.rssTitles(TRENDS_XML), bucket, "trends_us");
    const terms = Array.from(bucket.keys());
    for (const junk of ["weather", "today", "stock", "price", "the"]) {
      assert.ok(terms.indexOf(junk) === -1, junk + " haette rausfliegen muessen");
    }
    assert.ok(terms.indexOf("raccoon") !== -1, "raccoon fehlt");
    assert.ok(terms.indexOf("jimothy") !== -1, "jimothy fehlt");
  });

  await check("ein Begriff aus zwei Quellen merkt sich beide", () => {
    const bucket = new Map();
    bz.termsFromTitles([{ title: "Raccoon sighting", traffic: 1000 }], bucket, "trends_us");
    bz.termsFromTitles([{ title: "The raccoon returns", traffic: 0 }], bucket, "news");
    const hit = bucket.get("raccoon");
    assert.deepStrictEqual(Array.from(hit.sources).sort(), ["news", "trends_us"]);
    assert.strictEqual(hit.traffic, 1000, "das hoehere Volumen muss gewinnen");
  });

  await check("Wikipedia fragt gestern ab, nicht heute", () => {
    // Heutige Tagesstatistik ist noch nicht fertig - das gaebe einen 404.
    assert.strictEqual(bz.wikiPath(Date.parse("2026-09-01T07:00:00Z")), "2026/08/30");
    assert.strictEqual(bz.wikiPath(Date.parse("2026-03-02T23:00:00Z")), "2026/03/01");
  });

  await check("die Kreuzung findet nur Begriffe, die auch als Coin existieren", () => {
    const terms = [
      { term: "raccoon", sources: ["trends_us", "news"], traffic: 20000 },
      { term: "portugal", sources: ["trends_us"], traffic: 50000 },
    ];
    const coins = [
      { address: "gut", symbol: "RACC", name: "Raccoon Seattle", ageMinutes: 40, volumeH1: 140000,
        liquidityUsd: 95000, organicShareH1: 0.42, holderCount: 1400, priceChangeH1: 30, topFlags: [] },
      { address: "muell", symbol: "RACCOON", name: "Raccoon Inu", ageMinutes: 8, volumeH1: 500,
        liquidityUsd: 300, organicShareH1: 0, holderCount: 9, topFlags: [] },
      { address: "egal", symbol: "DOGE", name: "Dogecoin", ageMinutes: 90000, volumeH1: 1e6,
        liquidityUsd: 1e7, organicShareH1: 0.5, holderCount: 9e5, topFlags: [] },
    ];
    const crossings = bz.crossWithCoins(coins, terms);
    assert.strictEqual(crossings.length, 1, "portugal hat keinen Coin und darf nicht auftauchen");
    assert.strictEqual(crossings[0].term, "raccoon");
    assert.strictEqual(crossings[0].coins, 2);
    assert.strictEqual(crossings[0].withSubstance, 1, "nur einer der beiden hat Substanz");
    assert.strictEqual(crossings[0].youngestMinutes, 8);
    assert.strictEqual(crossings[0].examples[0].level, "substanz", "der mit Substanz muss vorne stehen");
  });

  await check("die Aussenwelt beruehrt die Stichwort-Felder nicht", () => {
    // Beide Systeme laufen ueber dieselben Coins. Wuerden sie sich das
    // gleiche Feld teilen, ueberschriebe eins das andere.
    const coin = { address: "a", symbol: "RACC", name: "Raccoon", ageMinutes: 10, volumeH1: 140000,
      liquidityUsd: 95000, organicShareH1: 0.42, holderCount: 1400, topFlags: [] };
    ww.scan([coin], ["raccoon"]);
    bz.crossWithCoins([coin], [{ term: "raccoon", sources: ["news"], traffic: 0 }]);
    assert.strictEqual(coin.watchWord, "raccoon");
    assert.strictEqual(coin.buzzWord, "raccoon");
    assert.strictEqual(coin.watchLevel, "substanz");
    assert.strictEqual(coin.buzzLevel, "substanz");
  });

  console.log("\nSpuren: Wallets verfolgen");
  const wl = require("../api/_lib/wallets");
  const W = "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K";
  const MEME = "MemeMint111111111111111111111111111111111111";
  const swap = (opts) => ({
    signature: opts.sig, timestamp: opts.ts, source: opts.source || "PUMP_FUN",
    nativeTransfers: opts.native || [], tokenTransfers: opts.tokens || [],
  });

  await check("ein Kauf wird als Kauf erkannt, samt SOL-Einsatz", () => {
    const move = wl.buyFromSwap(swap({
      sig: "s1", ts: 1770000000,
      native: [{ fromUserAccount: W, toUserAccount: "pool", amount: 2500000000 }],
      tokens: [{ fromUserAccount: "pool", toUserAccount: W, mint: MEME, tokenSymbol: "RACC", tokenAmount: 1250000 }],
    }), W);
    assert.strictEqual(move.side, "kauf");
    assert.strictEqual(move.mint, MEME);
    assert.strictEqual(move.solAmount, 2.5);
  });

  await check("ein Verkauf wird als Verkauf erkannt", () => {
    const move = wl.buyFromSwap(swap({
      sig: "s2", ts: 1770000100,
      native: [{ fromUserAccount: "pool", toUserAccount: W, amount: 4100000000 }],
      tokens: [{ fromUserAccount: W, toUserAccount: "pool", mint: MEME, tokenSymbol: "RACC", tokenAmount: 1250000 }],
    }), W);
    assert.strictEqual(move.side, "verkauf");
    assert.strictEqual(move.solAmount, 4.1);
  });

  await check("USDC in SOL zu tauschen ist kein Coin-Kauf", () => {
    // Sonst meldet die App jedes Nachladen als "er hat was gekauft".
    const move = wl.buyFromSwap(swap({
      sig: "s3", ts: 1770000200, source: "JUPITER",
      native: [{ fromUserAccount: "pool", toUserAccount: W, amount: 1000000000 }],
      tokens: [{ fromUserAccount: W, toUserAccount: "pool", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenSymbol: "USDC", tokenAmount: 200 }],
    }), W);
    assert.strictEqual(move, null);
  });

  await check("die Bewegung einer FREMDEN Wallet zaehlt nicht als unsere", () => {
    // Ein Swap beruehrt viele Konten. Nur was bei DER beobachteten Wallet
    // ankommt, ist ihr Kauf.
    const move = wl.buyFromSwap(swap({
      sig: "s4", ts: 1770000300,
      native: [{ fromUserAccount: "jemand", toUserAccount: "pool", amount: 5000000000 }],
      tokens: [{ fromUserAccount: "pool", toUserAccount: "jemandAnderes", mint: MEME, tokenSymbol: "RACC", tokenAmount: 999 }],
    }), W);
    assert.strictEqual(move, null);
  });

  await check("nur echte Solana-Adressen werden angenommen", () => {
    assert.ok(wl.isAddress(W));
    assert.ok(!wl.isAddress("0x1234567890abcdef1234567890abcdef12345678"), "Ethereum-Adresse abgelehnt");
    assert.ok(!wl.isAddress("viel zu kurz"));
    assert.ok(!wl.isAddress(W + "0"), "0 ist kein Base58-Zeichen");
  });

  await check("die Wallet-Liste entdoppelt und deckelt bei acht", () => {
    const viele = new Array(20).fill(W).join(",");
    assert.deepStrictEqual(wl.parseAddresses(viele), [W], "dieselbe Adresse zwanzigmal ist eine Adresse");
    assert.deepStrictEqual(wl.parseAddresses("muell, " + W + ", 0xabc"), [W]);
  });

  await check("zwei Wallets im selben Coin ergeben einen Zusammenlauf", () => {
    const cl = wl.clusters([
      { side: "kauf", mint: "A", wallet: "w1", solAmount: 2, timestamp: 100, symbol: "RACC" },
      { side: "kauf", mint: "A", wallet: "w2", solAmount: 5, timestamp: 140, symbol: "RACC" },
      { side: "kauf", mint: "B", wallet: "w1", solAmount: 1, timestamp: 150, symbol: "XYZ" },
    ]);
    assert.strictEqual(cl.length, 1, "B hat nur eine Wallet und ist kein Zusammenlauf");
    assert.strictEqual(cl[0].wallets, 2);
    assert.strictEqual(cl[0].solTotal, 7);
  });

  await check("dieselbe Wallet zweimal ist KEIN Zusammenlauf", () => {
    // Nachkaufen ist kein zweiter Beleg - es ist derselbe Beleg.
    const cl = wl.clusters([
      { side: "kauf", mint: "A", wallet: "w1", solAmount: 2, timestamp: 100 },
      { side: "kauf", mint: "A", wallet: "w1", solAmount: 3, timestamp: 200 },
    ]);
    assert.strictEqual(cl.length, 0);
  });

  await check("Verkaeufe bilden keinen Zusammenlauf", () => {
    const cl = wl.clusters([
      { side: "verkauf", mint: "A", wallet: "w1", solAmount: 2, timestamp: 100 },
      { side: "verkauf", mint: "A", wallet: "w2", solAmount: 3, timestamp: 200 },
    ]);
    assert.strictEqual(cl.length, 0);
  });

  await check("ohne Helius-Schluessel antwortet die Verfolgung sauber statt zu werfen", () => {
    const alt = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    return wl.watch(W).then((res) => {
      if (alt) process.env.HELIUS_API_KEY = alt;
      assert.strictEqual(res.keyMissing, true);
      assert.deepStrictEqual(res.moves, []);
      // Und der Fehler, der genau das kaputt gemacht hat: die Antwort
      // darf KEIN eigenes ok mitbringen. Die Route setzt ok:true, und ein
      // ok:false von hier hat es beim Zusammenfuehren ueberschrieben - die
      // App zeigte eine leere rote Fehlerbox statt der Anleitung.
      assert.ok(!("ok" in res), "watch() darf kein eigenes ok setzen");
      assert.strictEqual(Object.assign({ ok: true }, res).ok, true);
    });
  });

  await check("der Median der Einstiege trennt Streuer von Positionen", () => {
    // Der Live-Befund, der diese Einstufung ausgeloest hat: drei Wallets
    // mit echten Treffern, aber 0,003 bis 0,09 SOL pro Position.
    assert.strictEqual(wl.kindOf(0.003), "streuer");
    assert.strictEqual(wl.kindOf(0.09), "streuer");
    assert.strictEqual(wl.kindOf(0.3), "klein");
    assert.strictEqual(wl.kindOf(2.5), "position");
    assert.strictEqual(wl.kindOf(0), "streuer", "ohne Einsatz kein Vertrauen");
  });

  await check("der Median ist gegen einen einzelnen Grosskauf robust", () => {
    // Ein Streuer, der einmal 20 SOL setzt, bleibt ein Streuer.
    assert.strictEqual(wl.medianOf([0.01, 0.02, 0.03, 0.02, 20]), 0.02);
    assert.strictEqual(wl.kindOf(wl.medianOf([0.01, 0.02, 0.03, 0.02, 20])), "streuer");
  });

  await check("der Median kommt auch mit leeren Daten klar", () => {
    assert.strictEqual(wl.medianOf([]), 0);
    assert.strictEqual(wl.medianOf(null), 0);
    assert.strictEqual(wl.medianOf([1, 3]), 2);
  });

  await check("die Schwelle fuer eine echte Position steht bei einem halben SOL", () => {
    assert.strictEqual(wl.POSITION_SOL, 0.5);
  });

  console.log("\nRelevanz: was ist eine Meldung wert?");
  const POS = { wallet: "w1", kind: "position", medianSol: 0.05 };
  const rel = (move, scout) => { wl.relevanceOf(move, scout || POS, 150); return move; };

  await check("derselbe Betrag zaehlt in einem kleinen Coin mehr", () => {
    // Der Kern der ganzen Umstellung: 0,3 SOL sind in einem 5k-Coin ein
    // Prozent des Dings, in einem 5M-Coin nichts.
    const klein = rel({ wallet: "w1", solAmount: 0.3, score: 66, coin: { marketCap: 5000 } });
    const gross = rel({ wallet: "w1", solAmount: 0.3, score: 66, coin: { marketCap: 5000000 } });
    assert.ok(klein.relevance > gross.relevance,
      "kleiner Coin haette hoeher liegen muessen: " + klein.relevance + " vs " + gross.relevance);
    assert.ok(klein.sharePct > 0.5, "Anteil am Coin fehlt: " + klein.sharePct);
  });

  await check("ein grosser Einsatz in Schrott loest KEINEN Alarm aus", () => {
    // Live-Befund: 2 SOL in einen Coin mit unserem Score 31 kamen auf 65
    // Relevanz, weil die Qualitaet nur ein Abzug war. Wie ueberzeugt
    // jemand reingeht, aendert nichts daran, ob der Contract nachdrucken
    // kann - deshalb ist die Qualitaet jetzt ein Faktor.
    const schrott = rel({ wallet: "w1", solAmount: 2, score: 31, coin: { marketCap: 8000 } });
    assert.ok(schrott.relevance < 40, "haette unter der Meldeschwelle bleiben muessen: " + schrott.relevance);
  });

  await check("der Ueberzeugungskauf schlaegt alles", () => {
    const gut = rel({ wallet: "w1", solAmount: 1, score: 82, coin: { marketCap: 5000 } });
    assert.ok(gut.relevance >= 90, "zu niedrig bewertet: " + gut.relevance);
    assert.ok(gut.why.join(" ").indexOf("üblicher Einsatz") !== -1);
  });

  await check("ein Streuer mit Centbetrag bleibt unten", () => {
    const streuer = rel({ wallet: "w2", solAmount: 0.03, score: 55, coin: { marketCap: 3000 } },
      { wallet: "w2", kind: "streuer", medianSol: 0.03 });
    assert.ok(streuer.relevance < 40, "Streuer haette nicht melden duerfen: " + streuer.relevance);
  });

  await check("ohne eigene Pruefung wird gedaempft, nicht geglaubt", () => {
    const ohne = rel({ wallet: "w1", solAmount: 1, score: null, coin: { marketCap: 5000 } });
    const mit = rel({ wallet: "w1", solAmount: 1, score: 82, coin: { marketCap: 5000 } });
    assert.ok(ohne.relevance < mit.relevance);
  });

  await check("die Begruendung ist immer lesbar, nie eine nackte Zahl", () => {
    const m = rel({ wallet: "w1", solAmount: 1, score: 82, coin: { marketCap: 5000 } });
    assert.ok(Array.isArray(m.why) && m.why.length >= 2, "zu wenig Begruendung: " + JSON.stringify(m.why));
    m.why.forEach((w) => assert.ok(typeof w === "string" && w.length > 3));
  });

  await check("ein Coin, aus dem man nicht rauskommt, meldet nicht", () => {
    // Live-Befund: drei Alarme fuer Coins mit 3000 Dollar Pool. Kaufen
    // geht, verkaufen nicht - die eigene Order frisst den Gewinn. Das
    // ist schlimmer als kein Alarm, weil es nach Gelegenheit aussieht.
    const eng = rel({ wallet: "w1", solAmount: 0.25, score: 56, coin: { marketCap: 2800, liquidityUsd: 3000 } });
    const weit = rel({ wallet: "w1", solAmount: 0.25, score: 56, coin: { marketCap: 2800, liquidityUsd: 40000 } });
    assert.ok(eng.relevance < weit.relevance,
      "flacher Pool haette daempfen muessen: " + eng.relevance + " vs " + weit.relevance);
    assert.ok(eng.why.join(" ").indexOf("Ausstieg") !== -1, "Grund fehlt: " + JSON.stringify(eng.why));
  });

  await check("kein echtes Volumen zaehlt erst, wenn der Coin alt genug dafuer ist", () => {
    // Ein zwei Minuten alter Coin HAT noch kein organisches Volumen.
    // Ihn dafuer zu bestrafen wuerde genau die fruehen Faelle killen,
    // wegen derer das Werkzeug ueberhaupt existiert.
    const frisch = rel({ wallet: "w1", solAmount: 0.5, score: 60, coin: { marketCap: 9000, liquidityUsd: 30000, organicShareH1: 0, ageMinutes: 3 } });
    const alt = rel({ wallet: "w1", solAmount: 0.5, score: 60, coin: { marketCap: 9000, liquidityUsd: 30000, organicShareH1: 0, ageMinutes: 120 } });
    assert.ok(alt.relevance < frisch.relevance,
      "der alte Bot-Coin haette daempfen muessen: " + alt.relevance + " vs " + frisch.relevance);
  });

  await check("dieselbe Wallet meldet nicht dreimal in Folge dasselbe Signal", () => {
    // Live-Befund: drei fast identische Alarme, eine Wallet, zwei
    // Minuten. Das ist ein Signal, das dreimal erscheint - nicht drei.
    const bau = (mint, r) => ({ wallet: "w1", mint: mint, side: "kauf", relevance: r, why: [] });
    const liste = wl.dampenBursts([bau("a", 60), bau("b", 58), bau("c", 55), bau("d", 50)]);
    const nach = new Map(liste.map((m) => [m.mint, m.relevance]));
    assert.strictEqual(nach.get("a"), 60, "der staerkste Kauf bleibt unangetastet");
    assert.ok(nach.get("b") < 58 && nach.get("c") < 55 && nach.get("d") < 50);
    assert.ok(nach.get("d") < nach.get("c"), "je weiter gestreut, desto leiser");
  });

  await check("ein einzelner Kauf wird nicht als Streuen bestraft", () => {
    const einer = wl.dampenBursts([{ wallet: "w9", mint: "x", side: "kauf", relevance: 71, why: [] }]);
    assert.strictEqual(einer[0].relevance, 71);
  });

  await check("der Puls verlangt einen Schluessel, wirft aber nicht", () => {
    const alt = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    return wl.pulseSignatures("M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K").then((res) => {
      if (alt) process.env.HELIUS_API_KEY = alt;
      assert.strictEqual(res.keyMissing, true);
      assert.deepStrictEqual(res.wallets, []);
    });
  });

  await check("der Puls filtert Muell-Adressen genauso wie alles andere", () => {
    // Der Puls laeuft im 15-Sekunden-Takt. Eine ungeprueft
    // durchgereichte Adresse waere hier besonders teuer.
    assert.deepStrictEqual(wl.parseAddresses("0xabc, muell"), []);
  });

  await check("ein Coin kann nicht in beiden Durchgaengen zaehlen", () => {
    // Live beobachtet: MADE erfuellte die Kriterien beider Listen. Eine
    // Wallet haette dadurch zwei Treffer aus einem Coin bekommen - und
    // die Mindestzahl von zwei waere sinnlos geworden.
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "api", "_lib", "wallets.js"), "utf8");
    assert.ok(src.indexOf("coin.ageMinutes > 10080) continue") !== -1,
      "die Launch-Suche muss bei 7 Tagen aufhoeren");
    assert.ok(src.indexOf("jobSeen") !== -1, "es fehlt der Riegel gegen doppelte Coins");
  });

  await check("die Suche nach etablierten Coins ist verdrahtet", () => {
    assert.strictEqual(typeof wl.buyersBefore, "function");
    assert.strictEqual(typeof wl.establishedRunners, "function");
  });

  await check("ohne Schluessel liefert buyersBefore nichts statt zu werfen", () => {
    const alt = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    return wl.buyersBefore("MemeMint111111111111111111111111111111111111").then((res) => {
      if (alt) process.env.HELIUS_API_KEY = alt;
      assert.deepStrictEqual(res, []);
    });
  });

  await check("ohne Schluessel liefert die Selbstsuche keine Kundschafter", () => {
    const alt = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    return wl.findScouts().then((res) => {
      if (alt) process.env.HELIUS_API_KEY = alt;
      assert.strictEqual(res.keyMissing, true);
      assert.deepStrictEqual(res.scouts, []);
    });
  });

  await check("zwei Treffer bleiben das starke Signal", () => {
    // Genau die Stelle, an der so ein System sonst luegt: an jedem Tag
    // sind tausende Wallets zufaellig einmal frueh dabei.
    assert.strictEqual(wl.SCOUT_MIN_HITS, 2);
  });

  console.log("\nEin einzelner Treffer: wann zaehlt er trotzdem?");
  const einTreffer = (over) => ({ coins: [Object.assign(
    { stage: "launch", rank: 4, sol: 1.2, priceChangeH24: 800 }, over || {}) ] });

  await check("frueh, mit echtem Geld, in einem Coin der gelaufen ist - das zaehlt", () => {
    // Live gemessen: vier untersuchte Coins, 95 gefundene Kaeufer, keine
    // einzige Wallet in zweien davon. Zwei Treffer zu verlangen ist eine
    // Wette auf einen Zufall, der meistens ausbleibt - und dann steht da
    // "keine Ergebnisse", obwohl 95 Leute untersucht wurden.
    assert.strictEqual(wl.qualifiesAlone(einTreffer()), true);
  });

  await check("ein Centbetrag zaehlt auch bei Rang 1 nicht", () => {
    // Der Sniper, der hundert Launches mit 0,003 SOL beschiesst, ist
    // per Definition immer frueh dabei. Das ist keine Leistung.
    assert.strictEqual(wl.qualifiesAlone(einTreffer({ sol: 0.02, rank: 1 })), false);
  });

  await check("spaet eingestiegen zaehlt nicht", () => {
    assert.strictEqual(wl.qualifiesAlone(einTreffer({ rank: 40 })), false);
  });

  await check("frueh in einem Coin, der nicht gelaufen ist, zaehlt nicht", () => {
    // Frueh dabei zu sein ist nur dann etwas wert, wenn danach etwas
    // passiert ist. Sonst ist es nur frueh.
    assert.strictEqual(wl.qualifiesAlone(einTreffer({ priceChangeH24: 30 })), false);
  });

  await check("bei einem etablierten Coin sagt der Rang gar nichts", () => {
    // Dort ist "Rang 3" nur der dritte im untersuchten Zeitfenster -
    // eine beliebige Zahl, kein frueher Einstieg.
    assert.strictEqual(wl.qualifiesAlone(einTreffer({ stage: "etabliert" })), false);
  });

  await check("wer zwei Treffer hat, laeuft nicht ueber diese Ausnahme", () => {
    const zwei = { coins: [
      { stage: "launch", rank: 2, sol: 2, priceChangeH24: 900 },
      { stage: "launch", rank: 5, sol: 2, priceChangeH24: 400 },
    ] };
    assert.strictEqual(wl.qualifiesAlone(zwei), false);
  });

  await check("qualifiesAlone wirft nie, egal was reinkommt", () => {
    [null, undefined, {}, { coins: [] }, { coins: [{}] }].forEach((x) => {
      assert.strictEqual(wl.qualifiesAlone(x), false);
    });
  });

  console.log("\nDie Bilanz: verdient diese Wallet ueberhaupt Geld?");

  // Eine Wallet, ein Coin: gekauft fuer solIn, verkauft fuer solOut.
  const handel = (mint, tokIn, solIn, tokOut, solOut) => {
    const txs = [{
      signature: "b" + mint, timestamp: 1, tokenTransfers: [
        { mint: mint, tokenAmount: tokIn, toUserAccount: "W", fromUserAccount: "P", tokenSymbol: mint },
      ], nativeTransfers: [{ fromUserAccount: "W", toUserAccount: "P", amount: solIn * 1e9 }],
    }];
    if (tokOut > 0) txs.push({
      signature: "s" + mint, timestamp: 2, tokenTransfers: [
        { mint: mint, tokenAmount: tokOut, fromUserAccount: "W", toUserAccount: "P", tokenSymbol: mint },
      ], nativeTransfers: [{ toUserAccount: "W", fromUserAccount: "P", amount: solOut * 1e9 }],
    });
    return txs;
  };
  const viele = (n, gewinnAnteil, x) => {
    let txs = [];
    for (let i = 0; i < n; i++) {
      const gut = i < Math.round(n * gewinnAnteil);
      txs = txs.concat(handel("m" + i, 1000, 1, 1000, gut ? x : 0.2));
    }
    return txs;
  };

  await check("wer verliert, faellt durch - egal wie frueh er dabei war", () => {
    // Der teuerste blinde Fleck: zu jedem Coin, der laeuft, gibt es
    // vierzig fruehe Kaeufer, und die meisten davon verlieren bei
    // hundertsiebenundneunzig von zweihundert Versuchen. Sie standen in
    // der Liste, WEIL der Coin lief - nicht, weil sie gut sind.
    const b = wl.ledgerFromSwaps(viele(10, 0.1, 3), "W");
    assert.strictEqual(b.genug, true);
    assert.strictEqual(b.trades, 10);
    assert.ok(b.quote <= 20, "Quote haette niedrig sein muessen: " + b.quote);
  });

  await check("wer gewinnt, wird als solcher erkannt", () => {
    const b = wl.ledgerFromSwaps(viele(12, 0.75, 4), "W");
    assert.ok(b.quote >= 70, "Quote zu niedrig: " + b.quote);
    assert.ok(b.median > 1, "Median haette ueber 1 liegen muessen: " + b.median);
  });

  await check("zu wenige geschlossene Positionen heisst zu wenige - keine erfundene Quote", () => {
    // Eine Trefferquote aus drei Trades ist Rauschen mit Nachkommastelle.
    const b = wl.ledgerFromSwaps(viele(3, 1, 5), "W");
    assert.strictEqual(b.genug, false);
    assert.strictEqual(b.quote, null);
    assert.strictEqual(b.trades, 3);
  });

  await check("wer nur haelt, hat nichts bewiesen", () => {
    // Offene Positionen sind keine Gewinne. Wer zwanzig Coins kauft und
    // keinen verkauft, hat zwanzig Wetten laufen, nicht zwanzig Treffer.
    let txs = [];
    for (let i = 0; i < 20; i++) txs = txs.concat(handel("h" + i, 1000, 1, 0, 0));
    const b = wl.ledgerFromSwaps(txs, "W");
    assert.strictEqual(b.genug, false);
    assert.strictEqual(b.offen, 20);
    assert.strictEqual(b.trades, 0);
  });

  await check("teilverkauf zaehlt nicht als geschlossen", () => {
    // 30% verkauft heisst: er sitzt noch zu 70% drin. Das Ergebnis
    // steht noch nicht fest.
    const b = wl.ledgerFromSwaps(handel("x", 1000, 1, 300, 2), "W");
    assert.strictEqual(b.trades, 0);
    assert.strictEqual(b.offen, 1);
  });

  await check("die Versechsfachung wird eigens gezaehlt", () => {
    // Fuer das Ziel "5 Euro rein, 30 Euro raus" zaehlt genau diese Zahl -
    // und zwar nur bei tatsaechlich verkauften Positionen.
    const b = wl.ledgerFromSwaps(viele(10, 0.5, 7), "W");
    assert.strictEqual(b.sechsfach, 5);
  });

  await check("die Bilanz wirft nie, egal was reinkommt", () => {
    [null, undefined, [], [{}], [{ tokenTransfers: [] }]].forEach((x) => {
      const b = wl.ledgerFromSwaps(x, "W");
      assert.strictEqual(b.genug, false);
    });
  });

  await check("ein Verkauf ohne den zugehoerigen Kauf zaehlt nicht mit", () => {
    // Der Fehler, der die Bilanz zuerst wertlos machte: live verkaufte
    // eine Wallet einen Coin in neunzehn Tranchen, der Kauf lag aber
    // ausserhalb des abgefragten Fensters. Ohne diese Regel haette das
    // wie ein Gewinn aus dem Nichts ausgesehen.
    const nurVerkauf = [{
      signature: "s1", timestamp: 2, tokenTransfers: [
        { mint: "RIPE", tokenAmount: 2500000, fromUserAccount: "W", toUserAccount: "P", tokenSymbol: "RIPE" },
      ], nativeTransfers: [{ toUserAccount: "W", fromUserAccount: "P", amount: 1.1e9 }],
    }];
    const b = wl.ledgerFromSwaps(nurVerkauf, "W");
    assert.strictEqual(b.trades, 0);
    assert.strictEqual(b.genug, false);
  });

  console.log("\nPump and Dump: die Wallet, die grossartig aussieht und dich braucht");

  const handeln = (n, x, haltSek) => {
    let t = [];
    for (let i = 0; i < n; i++) {
      t.push({ signature: "b" + i, timestamp: 1000, tokenTransfers: [
        { mint: "m" + i, tokenAmount: 1000, toUserAccount: "W", fromUserAccount: "P" }],
        nativeTransfers: [{ fromUserAccount: "W", toUserAccount: "P", amount: 1e9 }] });
      t.push({ signature: "s" + i, timestamp: 1000 + haltSek, tokenTransfers: [
        { mint: "m" + i, tokenAmount: 1000, fromUserAccount: "W", toUserAccount: "P" }],
        nativeTransfers: [{ toUserAccount: "W", fromUserAccount: "P", amount: x * 1e9 }] });
    }
    return t;
  };

  await check("eine Wallet, die nach vier Minuten alles abstoesst, ist ein Dumper", () => {
    // Der Fall, der jede Statistik austrickst: 100% Trefferquote,
    // sauberer Multiplikator, immer frueh dabei. Sie gewinnt auch - nur
    // auf Kosten derer, die ihr folgen. Wer ihrem Kauf nachlaeuft,
    // kauft ihr das Paket ab, kurz bevor sie es loswerden will.
    const b = wl.ledgerFromSwaps(handeln(10, 2, 240), "W");
    assert.strictEqual(b.quote, 100, "sie gewinnt ja tatsaechlich");
    assert.strictEqual(b.muster, "dumper", "trotzdem darf sie nicht empfohlen werden");
  });

  await check("wer stundenlang haelt und gewinnt, ist das Gegenteil", () => {
    const b = wl.ledgerFromSwaps(handeln(10, 3, 18000), "W");
    assert.strictEqual(b.muster, "geduldig");
    assert.ok(b.haltMin >= 60);
  });

  await check("die Haltedauer wird gemessen, nicht geschaetzt", () => {
    const b = wl.ledgerFromSwaps(handeln(9, 2, 3600), "W");
    assert.strictEqual(b.haltMin, 60);
    assert.strictEqual(b.schnellAnteil, 0);
  });

  await check("ohne Zeitstempel wird kein Muster behauptet", () => {
    // Lieber "unklar" als eine Einordnung, die auf nichts beruht.
    assert.strictEqual(wl.musterVon(80, null, null, 3), "unklar");
  });

  await check("ein Verkauf ueber 0 SOL eine Sekunde nach dem Kauf ist kein Verkauf", () => {
    // Der Befund, der mich fast zur falschen Schlussfolgerung gebracht
    // haette: bei allen fuenf live gefundenen Wallets folgte auf jeden
    // Kauf eine Sekunde spaeter ein "Verkauf" ueber 0 SOL. Nach der
    // ersten Rechnung waren das fuenf Totalverluste - in Wahrheit sieht
    // man nur die halbe Bewegung, weil der Erloes auf einem
    // Unterkonto landet.
    const tx = (sig, mint, sol, ts, kauf) => ({
      signature: sig, timestamp: ts,
      tokenTransfers: [kauf
        ? { mint: mint, tokenAmount: 1000, toUserAccount: "W", fromUserAccount: "P" }
        : { mint: mint, tokenAmount: 1000, fromUserAccount: "W", toUserAccount: "P" }],
      nativeTransfers: [kauf
        ? { fromUserAccount: "W", toUserAccount: "P", amount: sol * 1e9 }
        : { toUserAccount: "W", fromUserAccount: "P", amount: sol * 1e9 }],
    });
    let a = [];
    for (let i = 0; i < 12; i++) { a.push(tx("b" + i, "m" + i, 0.5, 1000, true)); a.push(tx("s" + i, "m" + i, 0, 1001, false)); }
    const b = wl.ledgerFromSwaps(a, "W");
    assert.strictEqual(b.trades, 0, "das darf keine abgeschlossene Position sein");
    assert.strictEqual(b.unklar, 12);
    assert.strictEqual(b.muster, "unlesbar", "so handelt kein Mensch - das ist eine Maschine");

    // Aber: derselbe Nullverkauf NACH zwei Stunden ist ein echter
    // Totalverlust und gehoert sehr wohl in die Bilanz.
    let c = [];
    for (let i = 0; i < 12; i++) { c.push(tx("b" + i, "n" + i, 0.5, 1000, true)); c.push(tx("s" + i, "n" + i, 0, 9000, false)); }
    const d = wl.ledgerFromSwaps(c, "W");
    assert.strictEqual(d.trades, 12);
    assert.strictEqual(d.quote, 0);
  });

  await check("zwanzig Minuten ist die Grenze zum Dumpen", () => {
    assert.strictEqual(wl.DUMP_MINUTEN, 20);
  });

  await check("acht geschlossene Positionen sind die Untergrenze", () => {
    assert.strictEqual(wl.BILANZ_MIN_TRADES, 8);
  });

  await check("der Selbstsuche-Modus haengt nicht an einer Wortliste", () => {
    // Reine Verdrahtungspruefung: autoScout existiert und ist aufrufbar.
    assert.strictEqual(typeof wl.autoScout, "function");
    assert.strictEqual(typeof wl.earlyBuyers, "function");
    assert.strictEqual(typeof wl.winners, "function");
  });

  console.log(failures === 0 ? "\nAlle Tests bestanden.\n" : "\n" + failures + " Test(s) fehlgeschlagen.\n");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
