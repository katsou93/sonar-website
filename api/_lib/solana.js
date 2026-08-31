"use strict";
/**
 * Solana-RPC: Authorities und echte Holder-Verteilung.
 *
 * Der entscheidende Trick steckt in classifyHolders(): die größten
 * "Holder" eines pump.fun-Coins sind die Bonding Curve bzw. der AMM-Pool.
 * Wer die mitzählt, sieht bei JEDEM frischen Coin "ein Wallet hält 79%"
 * und der ganze Indikator ist wertlos. Wir lösen jedes Token-Konto zu
 * seinem Besitzer auf und prüfen dann, ob dieser Besitzer selbst einem
 * bekannten AMM-/Launchpad-Programm gehört. Nur was danach übrig bleibt,
 * ist Streubesitz - und nur der kann dir in den Chart kotzen.
 *
 * Ohne eigenen RPC-Key läuft das gegen den öffentlichen Endpunkt, der
 * getTokenLargestAccounts häufig drosselt. Ein kostenloser Helius-Key in
 * SOLANA_RPC macht diesen Teil zuverlässig.
 */

const { postJson, cached } = require("./http");

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

/** Programme, deren Konten Pools/Kurven sind - niemals Streubesitz. */
const POOL_PROGRAMS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // pump.fun bonding curve
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap AMM
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS", // Raydium Router
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora Pools
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca v2
  "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG", // Moonshot
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX", // OpenBook v2
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", // Serum/OpenBook v3
]);

/** Bekannte Verbrenn-/Systemadressen, die kein echter Holder sind. */
const BURN_OWNERS = new Set([
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
]);

let requestId = 0;

async function rpc(method, params, timeoutMs) {
  const body = { jsonrpc: "2.0", id: ++requestId, method: method, params: params };
  const res = await postJson(RPC, body, { source: "solana-rpc", timeoutMs: timeoutMs || 4000 });
  if (res && res.error) {
    const err = new Error(res.error.message || "RPC-Fehler");
    err.source = "solana-rpc";
    throw err;
  }
  return res && res.result;
}

async function rpcBatch(calls, timeoutMs) {
  const body = calls.map((c) => ({ jsonrpc: "2.0", id: ++requestId, method: c.method, params: c.params }));
  const res = await postJson(RPC, body, { source: "solana-rpc", timeoutMs: timeoutMs || 5000 });
  const list = Array.isArray(res) ? res : [res];
  return list.map((r) => (r && r.result) || null);
}

/** Mint-Daten: Authorities, Decimals, Gesamtmenge. */
async function getMintInfo(mint) {
  return cached("rpc:mint:" + mint, 30000, () => loadMintInfo(mint));
}

async function loadMintInfo(mint) {
  const result = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = result && result.value && result.value.data && result.value.data.parsed
    ? result.value.data.parsed.info
    : null;
  if (!info) return null;
  return {
    mintAuthority: info.mintAuthority || null,
    freezeAuthority: info.freezeAuthority || null,
    decimals: info.decimals,
    supply: Number(info.supply) / Math.pow(10, info.decimals || 0),
  };
}

/**
 * Holder-Verteilung mit herausgerechneten Pools.
 * Gibt Prozentwerte bezogen auf den VERTEILBAREN Supply zurück
 * (Gesamtmenge minus alles, was in Pools/Kurven liegt).
 */
async function getHolderDistribution(mint, knownMintInfo) {
  const largest = await rpc("getTokenLargestAccounts", [mint]);
  const accounts = (largest && largest.value) || [];
  if (!accounts.length) return null;

  // Der Aufrufer hat die Mint-Daten meist schon parallel geholt - ein
  // zweiter identischer Request gegen den gedrosselten öffentlichen
  // Endpunkt kostet nur Zeit und Rate-Limit.
  const mintInfo = knownMintInfo || (await getMintInfo(mint));
  const totalSupply = mintInfo ? mintInfo.supply : null;

  // Schritt 1: Token-Konto -> Besitzer
  const tokenAccounts = accounts.map((a) => a.address);
  const parsed = await rpc("getMultipleAccounts", [tokenAccounts, { encoding: "jsonParsed" }]);
  const values = (parsed && parsed.value) || [];
  const owners = values.map((v) =>
    v && v.data && v.data.parsed && v.data.parsed.info ? v.data.parsed.info.owner : null,
  );

  // Schritt 2: Besitzer -> gehört der Besitzer selbst einem Programm?
  const uniqueOwners = Array.from(new Set(owners.filter(Boolean)));
  let ownerPrograms = new Map();
  if (uniqueOwners.length) {
    const ownerAccounts = await rpc("getMultipleAccounts", [uniqueOwners, { encoding: "base64" }]);
    const ov = (ownerAccounts && ownerAccounts.value) || [];
    uniqueOwners.forEach((addr, i) => {
      ownerPrograms.set(addr, ov[i] ? ov[i].owner : null);
    });
  }

  const excludedPools = [];
  const holders = [];
  let poolHeld = 0;

  accounts.forEach((acc, i) => {
    const amount = Number(acc.uiAmount || (acc.uiAmountString ? Number(acc.uiAmountString) : 0)) || 0;
    const owner = owners[i];
    const ownerProgram = owner ? ownerPrograms.get(owner) : null;
    const isPool =
      (owner && POOL_PROGRAMS.has(owner)) ||
      (ownerProgram && POOL_PROGRAMS.has(ownerProgram)) ||
      (owner && BURN_OWNERS.has(owner));

    if (isPool) {
      poolHeld += amount;
      if (owner) excludedPools.push(owner);
    } else {
      holders.push({ owner: owner || acc.address, amount: amount });
    }
  });

  if (!totalSupply) return null;

  // Zwei Fälle, in denen wir NICHTS wissen und das auch sagen müssen:
  //
  // 1. Alle zwanzig grössten Konten gehören Pools. Bei frischen Coins ist
  //    das normal - dann liegt der Streubesitz komplett unterhalb der
  //    Grenze, die der RPC zurückgibt. Früher kam hier 0% heraus, und
  //    0% liest sich wie "perfekt gestreut". Genau falsch herum.
  // 2. Der Pool hält rechnerisch (fast) alles, der Nenner geht gegen null
  //    und jede Prozentangabe wird Unsinn.
  //
  // In beiden Fällen ist null die ehrliche Antwort; die Bewertung zieht
  // dafür Punkte ab, statt Sicherheit vorzutäuschen.
  if (!holders.length) return null;
  const distributable = totalSupply - poolHeld;
  if (!(distributable > totalSupply * 0.0005)) return null;

  holders.sort((a, b) => b.amount - a.amount);
  const top10 = holders.slice(0, 10).reduce((s, h) => s + h.amount, 0);

  return {
    top10Pct: (top10 / distributable) * 100,
    topHolderPct: holders.length ? (holders[0].amount / distributable) * 100 : 0,
    poolSharePct: (poolHeld / totalSupply) * 100,
    excludedPools: Array.from(new Set(excludedPools)),
    holders: holders.slice(0, 10),
    totalSupply: totalSupply,
  };
}

module.exports = { rpc, rpcBatch, getMintInfo, getHolderDistribution, RPC };
