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

  console.log(failures === 0 ? "\nAlle Tests bestanden.\n" : "\n" + failures + " Test(s) fehlgeschlagen.\n");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
