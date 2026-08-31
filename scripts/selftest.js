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
  if (method === "getTokenLargestAccounts") {
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

global.fetch = function (url, options) {
  const href = String(url);

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
  await check("alle drei Quellen gemeldet", () =>
    assert.deepStrictEqual(good.sources, { dexscreener: true, rugcheck: true, rpc: true }));

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

  console.log("\nRadar");
  setScenario("healthy");
  const feed = await buildFeed({ minLiquidity: 1000, minVolumeH1: 100, minAge: 0 });
  await check("liefert Einträge mit Score", () => {
    assert.ok(feed.items.length >= 1);
    assert.ok(typeof feed.items[0].score === "number");
    assert.ok(feed.items[0].heat >= 0);
  });
  await check("Filter greifen", async () => {
    const strict = await buildFeed({ minLiquidity: 10000000 });
    assert.strictEqual(strict.items.length, 0);
  });

  console.log(failures === 0 ? "\nAlle Tests bestanden.\n" : "\n" + failures + " Test(s) fehlgeschlagen.\n");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
