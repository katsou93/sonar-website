"use strict";
/**
 * Spuren - was kaufen die Leute, denen du folgst?
 *
 * Die naheliegende Idee waere, den X-Account eines bekannten Traders zu
 * ueberwachen. Das ist aus drei Gruenden die schlechtere Loesung:
 *
 *   1. Er postet NACH dem Kauf. Oder gar nicht. Oder erst, wenn er
 *      Abnehmer sucht - dann bist du der Abnehmer.
 *   2. Ein Post kann bezahlt sein. Eine Transaktion nicht.
 *   3. Der X-Zugang kostet Geld, die Kette ist oeffentlich und gratis.
 *
 * Deshalb schauen wir stattdessen auf die WALLET. Sie zeigt den Kauf in
 * dem Moment, in dem er passiert, in voller Hoehe, ohne Erzaehlung
 * drumherum. Das ist frueher als jeder Tweet und es laesst sich nicht
 * faelschen.
 *
 * Woher die Adressen kommen: von dir. Auf pump.fun steht unter jedem Coin
 * eine Activity-Liste mit allen Kaeufern. Laeuft ein Coin, schaust du
 * nach, wer frueh drin war, und legst die Adresse hier ab. Cloudflare
 * blockt uns beim automatischen Auslesen dieser Seite - deinen Browser
 * nicht. Diese Arbeitsteilung ist der ganze Trick: du erntest, die App
 * bewacht.
 *
 * Was diese App zusaetzlich tut, und was reines Copy-Trading nicht tut:
 * jeder erkannte Kauf wird sofort durch unsere eigene Pruefung geschickt.
 * "Er hat gekauft" ist keine Aussage. "Er hat gekauft, aber der Coin hat
 * 3% echtes Volumen und der Contract kann nachdrucken" ist eine.
 */

const { cached, getJson } = require("./http");
const jup = require("./jupiter");
const { evaluate } = require("./score");

const HELIUS = "https://api.helius.xyz";

/**
 * Was wir NICHT als "hat gekauft" melden wollen: den Tausch in SOL,
 * Stablecoins oder Liquid-Staking-Token. Wer USDC in SOL tauscht, hat
 * keinen Coin gekauft, er hat nur nachgeladen.
 */
const BORING_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // jitoSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", // bSOL
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", // jupSOL
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
]);

function hasKey() {
  return !!process.env.HELIUS_API_KEY;
}

/** Adressen sind Base58, 32-44 Zeichen. Alles andere fliegt raus. */
function isAddress(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function parseAddresses(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === "string") list = input.split(/[,\s;]+/);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const addr = String(raw || "").trim();
    if (!isAddress(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
    // Harte Obergrenze: jede Wallet kostet einen Aufruf, und das
    // Helius-Freikontingent ist endlich.
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Eine geparste Swap-Transaktion in "was wurde gekauft" uebersetzen.
 *
 * Helius liefert tokenTransfers. Aus Sicht der beobachteten Wallet ist
 * gekauft, was BEI IHR ankommt (toUserAccount), und verkauft, was sie
 * weggibt. Ein Swap hat beides - interessant ist die Seite, die kein
 * SOL und kein Stablecoin ist.
 */
function buyFromSwap(tx, wallet) {
  const transfers = (tx && tx.tokenTransfers) || [];
  let bought = null;
  let sold = null;

  for (const t of transfers) {
    if (!t || !t.mint) continue;
    if (t.toUserAccount === wallet && !BORING_MINTS.has(t.mint)) {
      const amount = Number(t.tokenAmount || 0);
      if (!bought || amount > bought.amount) bought = { mint: t.mint, amount: amount, symbol: t.tokenSymbol || null };
    }
    if (t.fromUserAccount === wallet && !BORING_MINTS.has(t.mint)) {
      const amount = Number(t.tokenAmount || 0);
      if (!sold || amount > sold.amount) sold = { mint: t.mint, amount: amount, symbol: t.tokenSymbol || null };
    }
  }

  // Wie viel SOL ist geflossen? Das ist die eigentlich interessante Zahl -
  // eine Position von 0,05 SOL ist ein Versuchsballon, eine von 20 SOL
  // eine Ansage.
  let solOut = 0;
  let solIn = 0;
  for (const n of (tx && tx.nativeTransfers) || []) {
    if (!n) continue;
    const sol = Number(n.amount || 0) / 1e9;
    if (n.fromUserAccount === wallet) solOut += sol;
    if (n.toUserAccount === wallet) solIn += sol;
  }
  for (const t of transfers) {
    if (!t || t.mint !== "So11111111111111111111111111111111111111112") continue;
    const sol = Number(t.tokenAmount || 0);
    if (t.fromUserAccount === wallet) solOut += sol;
    if (t.toUserAccount === wallet) solIn += sol;
  }

  if (bought) {
    return {
      side: "kauf",
      mint: bought.mint,
      symbol: bought.symbol,
      tokenAmount: bought.amount,
      solAmount: Math.round(solOut * 1000) / 1000,
      signature: tx.signature,
      timestamp: tx.timestamp || null,
      source: tx.source || null,
    };
  }
  if (sold) {
    return {
      side: "verkauf",
      mint: sold.mint,
      symbol: sold.symbol,
      tokenAmount: sold.amount,
      solAmount: Math.round(solIn * 1000) / 1000,
      signature: tx.signature,
      timestamp: tx.timestamp || null,
      source: tx.source || null,
    };
  }
  return null;
}

/** Die letzten Swaps einer Wallet holen. Ein Aufruf pro Wallet. */
async function recentSwaps(wallet, opts) {
  const options = opts || {};
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY fehlt");
  const limit = Math.min(25, Math.max(1, options.limit || 12));

  let url =
    HELIUS + "/v0/addresses/" + wallet + "/transactions?api-key=" + encodeURIComponent(key) + "&type=SWAP&limit=" + limit;
  if (options.sinceSeconds) url += "&gte-time=" + Math.floor(Date.now() / 1000 - options.sinceSeconds);

  // 45 Sekunden Cache: mehrere gleichzeitige Aufrufe derselben Wallet
  // teilen sich eine Abfrage. Jede Abfrage kostet Guthaben.
  return cached("helius:swaps:" + wallet + ":" + limit + ":" + (options.sinceSeconds || 0), 45000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 8000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });
}

/**
 * Alle beobachteten Wallets abklappern und die Bewegungen zusammentragen.
 *
 * Bewusst sequenziell mit Pause: das Helius-Freikontingent erlaubt nur
 * zwei Anfragen pro Sekunde an die Enhanced-API. Parallel abzufeuern
 * bringt nur 429er.
 */
async function trackWallets(addresses, opts) {
  const options = opts || {};
  const wallets = parseAddresses(addresses);
  const result = { wallets: wallets, moves: [], errors: {} };
  if (!wallets.length || !hasKey()) return result;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 550));
    try {
      const txs = await recentSwaps(wallet, options);
      for (const tx of txs) {
        const move = buyFromSwap(tx, wallet);
        if (!move) continue;
        if (options.buysOnly && move.side !== "kauf") continue;
        move.wallet = wallet;
        result.moves.push(move);
      }
    } catch (err) {
      result.errors[wallet] = (err && err.message) || "nicht erreichbar";
    }
  }

  result.moves.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  result.moves = result.moves.slice(0, options.max || 40);
  return result;
}

/**
 * Der Teil, der reines Copy-Trading schlaegt: zu jedem Kauf sofort
 * unsere eigene Bewertung dazu.
 *
 * Ein Kauf ohne Pruefung ist eine Behauptung. Mit Pruefung ist es eine
 * Entscheidungsgrundlage - und manchmal ist die Antwort "der ist gerade
 * in etwas reingelaufen, in das du nicht reinlaufen willst".
 */
async function enrich(moves) {
  const mints = Array.from(new Set(moves.map((m) => m.mint))).slice(0, 40);
  if (!mints.length) return moves;

  let assets = [];
  try {
    assets = await jup.byMints(mints);
  } catch (err) {
    assets = [];
  }
  const byMint = new Map();
  for (const asset of assets) {
    if (!asset || !asset.id) continue;
    byMint.set(asset.id, jup.normalize(asset, null));
  }

  for (const move of moves) {
    const coin = byMint.get(move.mint);
    if (!coin) {
      move.coin = null;
      move.score = null;
      move.verdict = null;
      continue;
    }
    const result = evaluate({
      light: true,
      stage: coin.stage,
      ageMinutes: coin.ageMinutes,
      isToken2022: coin.isToken2022,
      market: {
        priceUsd: coin.priceUsd,
        marketCap: coin.marketCap,
        liquidityUsd: coin.liquidityUsd,
        volume: { m5: 0, h1: coin.volumeH1, h6: 0, h24: coin.volumeH24 },
        priceChange: { m5: coin.priceChangeM5, h1: coin.priceChangeH1, h6: 0, h24: coin.priceChangeH24 },
        txns: { m5: { buys: 0, sells: 0 }, h1: { buys: coin.buysH1, sells: coin.sellsH1 }, h24: { buys: 0, sells: 0 } },
        volumeToLiquidity: coin.liquidityUsd ? coin.volumeH24 / coin.liquidityUsd : null,
        liquidityToMcap: coin.liquidityUsd && coin.marketCap ? coin.liquidityUsd / coin.marketCap : null,
        buySellRatioH1: coin.buySellRatioH1,
      },
      holders: { top10Pct: null, topHoldersPctExternal: coin.topHoldersPct, holderCount: coin.holderCount },
      authorities: { mint: coin.mintAuthorityActive, freeze: coin.freezeAuthorityActive, known: true },
    });
    move.coin = {
      symbol: coin.symbol,
      name: coin.name,
      imageUrl: coin.imageUrl,
      // Der Preis zum Zeitpunkt des Alarms - ohne ihn laesst sich
      // spaeter nicht sagen, ob die Meldung etwas wert war.
      priceUsd: coin.priceUsd,
      marketCap: coin.marketCap,
      liquidityUsd: coin.liquidityUsd,
      priceChangeH1: coin.priceChangeH1,
      organicShareH1: coin.organicShareH1,
      holderCount: coin.holderCount,
      ageMinutes: coin.ageMinutes,
      dexUrl: coin.dexUrl,
    };
    move.symbol = move.symbol || coin.symbol;
    move.score = result.score;
    move.verdict = result.verdict;
    move.topFlags = result.flags.filter((f) => f.level === "red" || f.level === "yellow").slice(0, 3);
  }
  return moves;
}

/**
 * Zusammenlaufen: kaufen MEHRERE beobachtete Wallets denselben Coin?
 *
 * Eine Wallet kann sich irren. Drei unabhaengige Wallets, die innerhalb
 * derselben Stunde in denselben Coin gehen, sind das staerkste Signal,
 * das dieses ganze Werkzeug erzeugen kann - und es ist genau das, was
 * man von Hand niemals sehen wuerde.
 */
function clusters(moves) {
  const byMint = new Map();
  for (const move of moves) {
    if (move.side !== "kauf") continue;
    const list = byMint.get(move.mint) || [];
    list.push(move);
    byMint.set(move.mint, list);
  }

  const out = [];
  for (const [mint, list] of byMint) {
    const wallets = new Set(list.map((m) => m.wallet));
    if (wallets.size < 2) continue;
    const times = list.map((m) => m.timestamp || 0).filter(Boolean);
    out.push({
      mint: mint,
      symbol: list[0].symbol || (list[0].coin && list[0].coin.symbol) || null,
      wallets: wallets.size,
      buys: list.length,
      solTotal: Math.round(list.reduce((s, m) => s + (m.solAmount || 0), 0) * 100) / 100,
      firstAt: times.length ? Math.min.apply(null, times) : null,
      lastAt: times.length ? Math.max.apply(null, times) : null,
      score: list[0].score == null ? null : list[0].score,
      coin: list[0].coin || null,
    });
  }
  out.sort((a, b) => b.wallets - a.wallets || b.solTotal - a.solTotal);
  return out;
}

/** Alles zusammen: verfolgen, anreichern, Zusammenlaeufe finden. */
async function watch(addresses, opts) {
  const tracked = await trackWallets(addresses, opts);
  if (tracked.moves.length) {
    await enrich(tracked.moves);
    // Auch bei selbst eingetragenen Wallets: ohne Vergleichsmass zaehlen
    // Biss und unsere eigene Pruefung, das ist besser als nichts.
    await rankMoves(tracked.moves, []);
  }
  return {
    keyMissing: !hasKey(),
    wallets: tracked.wallets,
    moves: tracked.moves,
    clusters: clusters(tracked.moves),
    errors: tracked.errors,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  watch,
  trackWallets,
  enrich,
  clusters,
  buyFromSwap,
  parseAddresses,
  isAddress,
  hasKey,
  recentSwaps,
  BORING_MINTS,
};

/* ------------------------------------------------------------------ *
 * Die Selbstsuche: gute Wallets finden, ohne dass jemand sie eintraegt
 * ------------------------------------------------------------------ */

/**
 * Adressen von Hand zu sammeln ist Arbeit, und Arbeit, die niemand macht,
 * findet nicht statt. Also macht die App es selbst - und zwar rueckwaerts:
 *
 *   1. Welche Coins sind in den letzten Tagen wirklich gelaufen?
 *   2. Wer hat die GEKAUFT, als sie noch nichts waren?
 *   3. Welche dieser Wallets war bei MEHREREN dabei?
 *
 * Schritt 3 ist der ganze Punkt. Einmal frueh in einem Gewinner zu sein
 * ist Glueck - dafuer gibt es an jedem Tag tausende Wallets. Zweimal oder
 * dreimal unabhaengig frueh dabei zu sein, ist es nicht mehr.
 *
 * Und die Grenze, die man kennen muss: das findet auch Insider und Bots,
 * die frueh drin waren, weil sie den Coin selbst gestartet haben. Deshalb
 * fliegen Wallets raus, die in FAST ALLEN untersuchten Coins auftauchen -
 * wer alles kauft, hat nichts gewusst.
 */

const { isNoise } = require("./feed");

/** Coins, die in den letzten Tagen tatsaechlich gelaufen sind. */
async function winners(limit) {
  const max = limit || 10;
  return cached("scout:winners", 60 * 60 * 1000, async () => {
    // Mehr Fenster = mehr Kandidaten. Und darauf kommt alles an: bei
    // vier untersuchten Coins ueberschneidet sich fast nie etwas, bei
    // zehn schon deutlich oefter (die Zahl der moeglichen Paare
    // waechst quadratisch, nicht linear).
    const lists = await Promise.allSettled([
      jup.topOrganic("24h"), jup.topTraded("24h"), jup.topOrganic("6h"),
      jup.topTraded("6h"), jup.topOrganic("1h"),
    ]);
    const seen = new Set();
    const out = [];
    for (const res of lists) {
      if (res.status !== "fulfilled") continue;
      for (const asset of res.value || []) {
        const coin = jup.normalize(asset, null);
        if (!coin || !coin.address || seen.has(coin.address)) continue;
        seen.add(coin.address);
        if (isNoise(coin)) continue;
        // Alt genug, um gelaufen zu sein - jung genug, dass die ersten
        // Kaeufe noch in einer Abfrage erreichbar sind.
        //
        // Erster Live-Lauf: mit 6 Stunden bis 14 Tagen und +40% blieben nur
        // drei Coins uebrig, und bei drei Coins ueberschneidet sich fast
        // nie etwas. Die Spanne ist deshalb weiter - lieber ein paar
        // schwaechere Kandidaten pruefen als gar keine Ueberschneidung
        // finden koennen.
        // Obergrenze 7 Tage, damit sich dieser Durchgang NICHT mit dem
        // fuer etablierte Coins ueberschneidet. Live beobachtet: MADE lag
        // in beiden Listen, und eine Wallet haette dadurch zwei "Treffer"
        // aus einem einzigen Coin bekommen - der Schwellenwert von zwei
        // waere damit wertlos geworden.
        if (coin.ageMinutes == null || coin.ageMinutes < 120 || coin.ageMinutes > 10080) continue;
        // Zweiter Live-Lauf: mit 20k Liquiditaet und +25% blieben WIEDER
        // nur zwei Coins uebrig. Die Grenzen sind hier nur dazu da,
        // offensichtlichen Muell fernzuhalten - die eigentliche Pruefung
        // passiert weiter unten an den Kaeufern.
        if ((coin.liquidityUsd || 0) < 12000) continue;
        if ((coin.priceChangeH24 || 0) < 20) continue;
        out.push(coin);
      }
    }
    out.sort((a, b) => (b.priceChangeH24 || 0) - (a.priceChangeH24 || 0));
    return out.slice(0, max);
  });
}

/**
 * Wer hat diesen Coin als Erstes gekauft?
 *
 * sort-order=asc liefert die AELTESTEN Transaktionen zuerst - genau die,
 * die uns interessieren. Der Unterzeichner (feePayer) ist der Mensch
 * dahinter; ueber buyFromSwap pruefen wir, ob er den Coin auch wirklich
 * bekommen hat und nicht abgegeben.
 */
const ERSTE_RAENGE_BOTS = 15;

async function earlyBuyers(mint, howMany, opts) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  const url =
    HELIUS + "/v0/addresses/" + mint + "/transactions?api-key=" + encodeURIComponent(key) +
    "&type=SWAP&sort-order=asc&limit=100";

  // Zwoelf Stunden Cache: die ersten Kaeufer eines Coins aendern sich nie.
  const txs = await cached("scout:early:" + mint, 12 * 60 * 60 * 1000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 9000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });

  const counts = new Map();
  const first = new Map();
  for (const tx of txs) {
    const wallet = tx && tx.feePayer;
    if (!wallet) continue;
    const move = buyFromSwap(tx, wallet);
    if (!move || move.side !== "kauf" || move.mint !== mint) continue;
    counts.set(wallet, (counts.get(wallet) || 0) + 1);
    // Der ERSTE Kauf zaehlt: wie viel hat er reingesteckt, als er sich
    // entschieden hat? Nachkaeufe verwaessern diese Aussage.
    if (!first.has(wallet)) first.set(wallet, { wallet: wallet, sol: move.solAmount || 0, rank: first.size + 1 });
  }

  // Wer in EINEM Coin dauernd kauft, ist ein Bot oder der Pool selbst.
  //
  // Und dann die Aenderung, die den ganzen Ansatz erst brauchbar macht.
  //
  // Live gemessen, an fuenf von fuenf gefundenen Wallets: alle waren
  // Bots. Zwei mit unlesbaren Unterkonten, zwei mit anderthalb bis fuenf
  // Minuten Haltedauer. Keine einzige, der ein Mensch folgen koennte.
  //
  // Das lag nicht an der Bewertung, sondern an der Frage. "Wer war als
  // Erster drin?" hat genau eine richtige Antwort, und die lautet immer:
  // ein Sniper-Bot. Er ist in Sekunde null da, weil er nichts anderes
  // tut, als in Sekunde null da zu sein - bei diesem Coin und bei
  // dreihundert anderen am selben Tag. Ihn zu finden ist keine
  // Leistung, und ihm zu folgen ist unmoeglich: bis du seinen Kauf
  // siehst, hat er laengst verkauft.
  //
  // Es gibt zwei Arten von "frueh", und nur eine davon nuetzt dir:
  //
  //   Bot-frueh    Sekunde 0 bis 60, Rang 1 bis etwa 15. Maschinen.
  //   Mensch-frueh Danach, vor dem Anstieg. Jemand hat den Coin
  //                gesehen, gepruefT und sich entschieden.
  //
  // Deshalb ueberspringen wir die ersten Raenge. Wir suchen nicht mehr
  // den Schnellsten, sondern den Ersten, der nachgedacht hat.
  const abRang = opts && opts.abRang != null ? opts.abRang : ERSTE_RAENGE_BOTS;
  return Array.from(first.values())
    .filter((b) => counts.get(b.wallet) <= 3)
    .filter((b) => b.rank > abRang)
    .slice(0, howMany || 40);
}

/**
 * Die Einstufung, die den ersten Live-Lauf gerettet hat.
 *
 * Beim ersten Test fand die Suche drei Wallets, die tatsaechlich mehrfach
 * frueh in Gewinnern waren. Ein Blick auf ihre laufenden Kaeufe zeigte
 * aber: 0,003 bis 0,09 SOL pro Position, in Coins, die null bis zwei
 * Minuten alt waren. Das sind keine Trader, das sind Schrotflinten - sie
 * kaufen im Minutentakt hunderte frische Launches fuer Centbetraege, und
 * einer davon geht ab. Genau deshalb landen sie in jeder
 * Gewinner-Rueckwaertssuche.
 *
 * Wer denen mit ernsthaften Betraegen folgt, verliert: ihre Rechnung geht
 * nur mit hundert Mini-Wetten auf, nicht mit drei richtigen.
 *
 * Also messen wir, was sie selbst gesetzt haben. Der Median ueber ihre
 * Ersteinstiege trennt die beiden Sorten sauber.
 */
function medianOf(numbers) {
  const list = (numbers || []).filter((n) => typeof n === "number" && isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** Ab welchem Median-Einsatz reden wir von einer echten Position? */
const POSITION_SOL = 0.5;

function kindOf(medianSol) {
  if (!medianSol || medianSol < 0.1) return "streuer";
  if (medianSol < POSITION_SOL) return "klein";
  return "position";
}

/**
 * Die zweite Suche: etablierte Coins, die gelaufen sind.
 *
 * Die Rueckwaertssuche ueber frische Launches findet zwangslaeufig
 * Schrotflinten - "wer war frueh in einem Coin, der 5000% gemacht hat"
 * IST die Beschreibung eines Launch-Snipers. Fuer die Sorte Handel, um
 * die es hier eigentlich geht, braucht es eine andere Frage:
 *
 *   Welche ALTEN Coins sind gelaufen - und wer hatte die schon vorher?
 *
 * Das findet Leute, die eine Position aufbauen und warten, statt hundert
 * Lose zu kaufen. Genau die Sorte, der man mit ernsthaften Betraegen
 * folgen kann.
 */
async function establishedRunners(limit) {
  const max = limit || 3;
  return cached("scout:established", 60 * 60 * 1000, async () => {
    const lists = await Promise.allSettled([
      jup.topOrganic("24h"), jup.topTraded("24h"), jup.topOrganic("6h"),
    ]);
    const seen = new Set();
    const out = [];
    for (const res of lists) {
      if (res.status !== "fulfilled") continue;
      for (const asset of res.value || []) {
        const coin = jup.normalize(asset, null);
        if (!coin || !coin.address || seen.has(coin.address)) continue;
        seen.add(coin.address);
        if (isNoise(coin)) continue;
        // Mindestens eine Woche alt, richtig gross, und in 24 Stunden
        // deutlich gelaufen.
        if (coin.ageMinutes == null || coin.ageMinutes < 10080) continue;
        if ((coin.marketCap || 0) < 500000) continue;
        if ((coin.liquidityUsd || 0) < 60000) continue;
        if ((coin.priceChangeH24 || 0) < 20) continue;
        out.push(coin);
      }
    }
    out.sort((a, b) => (b.priceChangeH24 || 0) - (a.priceChangeH24 || 0));
    return out.slice(0, max);
  });
}

/**
 * Wer hat diesen Coin gekauft, BEVOR er lief?
 *
 * Bei einem alten Coin sind die ersten hundert Transaktionen Monate her
 * und wertlos. Interessant ist das Fenster kurz vor der Bewegung: von
 * drei Tagen zurueck bis acht Stunden zurueck. Wer da eingestiegen ist,
 * hat vor dem Anstieg gekauft.
 */
async function buyersBefore(mint, howMany) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  const now = Math.floor(Date.now() / 1000);
  const url =
    HELIUS + "/v0/addresses/" + mint + "/transactions?api-key=" + encodeURIComponent(key) +
    "&type=SWAP&sort-order=asc&limit=100" +
    "&gte-time=" + (now - 3 * 24 * 3600) +
    "&lte-time=" + (now - 8 * 3600);

  const txs = await cached("scout:before:" + mint, 6 * 60 * 60 * 1000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 9000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });

  const counts = new Map();
  const first = new Map();
  for (const tx of txs) {
    const wallet = tx && tx.feePayer;
    if (!wallet) continue;
    const move = buyFromSwap(tx, wallet);
    if (!move || move.side !== "kauf" || move.mint !== mint) continue;
    counts.set(wallet, (counts.get(wallet) || 0) + 1);
    if (!first.has(wallet)) first.set(wallet, { wallet: wallet, sol: move.solAmount || 0, rank: first.size + 1 });
  }
  return Array.from(first.values())
    .filter((b) => counts.get(b.wallet) <= 3)
    .slice(0, howMany || 40);
}

/** Wie viele Coins muss eine Wallet frueh getroffen haben, um zu zaehlen? */
const SCOUT_MIN_HITS = 2;

/**
 * Die Kundschafter finden. Ein Aufruf pro untersuchtem Gewinner-Coin,
 * sequenziell wegen des Zwei-pro-Sekunde-Limits, zwoelf Stunden gecacht.
 */
/* ------------------------------------------------------------------ *
 * Die Bilanz: verdient diese Wallet ueberhaupt Geld?
 * ------------------------------------------------------------------ */

/**
 * Der teuerste blinde Fleck des ganzen Werkzeugs, und er war von Anfang
 * an da.
 *
 * Bisher lief die Auswahl so: nimm Coins, die gelaufen sind, schau wer
 * frueh drin war, nenne die Leute Kundschafter. Das beantwortet aber
 * nur die Frage "wer war bei einem Gewinner dabei?" - nicht die Frage,
 * auf die es ankommt: "verdient dieser Mensch Geld?"
 *
 * Der Unterschied ist alles. Zu jedem Coin, der laeuft, gibt es vierzig
 * fruehe Kaeufer. Die allermeisten davon kaufen zweihundert frische
 * Launches pro Woche und verlieren bei hundertsiebenundneunzig. Sie
 * stehen in unserer Liste, WEIL der Coin gelaufen ist - nicht, weil sie
 * gut sind. Das ist Auswahl nach dem Ueberlebenden, und sie fuehlt sich
 * von innen wie eine Erkenntnis an.
 *
 * Diese Funktion dreht das um. Sie nimmt die letzten Swaps einer Wallet
 * und rechnet pro Coin nach, was hineinging und was herauskam:
 *
 *   geschlossen - er hat mindestens 80% seiner Token wieder verkauft.
 *                 Nur solche Positionen sagen etwas aus.
 *   offen       - er sitzt noch drin. Kann ein Gewinner sein, kann eine
 *                 Leiche sein. Wir zaehlen es NICHT als Erfolg.
 *
 * Was dabei ehrlich bleiben muss: hundert Transaktionen sind ein
 * Ausschnitt, keine Lebensgeschichte. Unter acht geschlossenen
 * Positionen sagen wir "zu wenig Daten" statt eine Quote zu erfinden.
 */
const BILANZ_MIN_TRADES = 8;

function ledgerFromSwaps(txs, wallet) {
  const perMint = new Map();
  for (const tx of txs || []) {
    const move = buyFromSwap(tx, wallet);
    if (!move || !move.mint) continue;
    const m = perMint.get(move.mint) ||
      { mint: move.mint, symbol: move.symbol, tokIn: 0, tokOut: 0, solIn: 0, solOut: 0, ersterKauf: null, letzterVerkauf: null };
    if (move.side === "kauf") {
      m.tokIn += move.tokenAmount || 0;
      m.solIn += move.solAmount || 0;
      // Wann ist er eingestiegen? Zusammen mit dem Ausstieg ergibt das
      // die Haltedauer - und die ist die verraeterischste Zahl von allen.
      if (move.timestamp && (!m.ersterKauf || move.timestamp < m.ersterKauf)) m.ersterKauf = move.timestamp;
    } else {
      m.tokOut += move.tokenAmount || 0;
      m.solOut += move.solAmount || 0;
      if (move.timestamp && (!m.letzterVerkauf || move.timestamp > m.letzterVerkauf)) m.letzterVerkauf = move.timestamp;
    }
    if (!m.symbol && move.symbol) m.symbol = move.symbol;
    perMint.set(move.mint, m);
  }

  const zu = [];
  let offen = 0;
  let unklar = 0;
  for (const m of perMint.values()) {
    // Ohne Einsatz keine Aussage - das sind Airdrops oder Reste.
    if (m.solIn <= 0 || m.tokIn <= 0) continue;
    const verkauftAnteil = m.tokOut / m.tokIn;
    if (verkauftAnteil < 0.8) { offen++; continue; }
    const haltMin = (m.ersterKauf && m.letzterVerkauf && m.letzterVerkauf > m.ersterKauf)
      ? (m.letzterVerkauf - m.ersterKauf) / 60 : null;

    // Der Fall, der mich fast zur falschen Schlussfolgerung gebracht
    // haette: bei fuenf von fuenf gefundenen Wallets folgte auf jeden
    // Kauf EINE SEKUNDE spaeter ein "Verkauf" ueber 0 SOL. Nach der
    // ersten Rechnung waren das fuenf Totalverluste und damit fuenf
    // Verlierer - in Wahrheit ist es gar kein Verkauf. Die Token gehen
    // an ein Unterkonto oder der Erloes landet auf einer anderen
    // Adresse; wir sehen nur die halbe Bewegung.
    //
    // Ein Verkauf ueber 0 SOL NACH einer echten Haltedauer ist dagegen
    // sehr wohl eine Aussage: dann ist der Coin gestorben und der
    // Totalverlust gehoert in die Bilanz. Die Uhr trennt die beiden
    // Faelle sauber.
    if (m.solOut <= 0 && (haltMin == null || haltMin < 1)) { unklar++; continue; }

    zu.push({ mint: m.mint, symbol: m.symbol, x: m.solOut / m.solIn, solIn: m.solIn, haltMin: haltMin });
  }

  if (zu.length < BILANZ_MIN_TRADES) {
    // Eine Wallet, deren Bewegungen fast alle unlesbar sind, ist keine
    // Wallet mit zu wenig Daten - sie ist eine Maschine mit
    // Unterkonten. Live gemessen: bei allen fuenf gefundenen
    // Kandidaten folgte auf jeden Kauf eine Sekunde spaeter ein
    // Nullverkauf. Ein Mensch handelt nicht so. Wir koennen so jemanden
    // nicht pruefen, und was man nicht pruefen kann, empfiehlt man
    // nicht.
    const botartig = unklar >= 8 && zu.length === 0;
    return {
      trades: zu.length, offen: offen, unklar: unklar, genug: false,
      quote: null, median: null, bestX: null,
      muster: botartig ? "unlesbar" : null,
    };
  }

  const gewinne = zu.filter((t) => t.x >= 1.05).length;
  const xs = zu.map((t) => t.x).sort((a, b) => a - b);
  const mitte = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mitte] : (xs[mitte - 1] + xs[mitte]) / 2;

  // Wie lange haelt dieser Mensch? Die Zahl, die einen Kundschafter von
  // einem Pump-and-Dump-Betreiber unterscheidet.
  const halten = zu.map((t) => t.haltMin).filter((h) => h != null).sort((a, b) => a - b);
  const hm = Math.floor(halten.length / 2);
  const haltMedian = halten.length
    ? Math.round((halten.length % 2 ? halten[hm] : (halten[hm - 1] + halten[hm]) / 2) * 10) / 10
    : null;
  const schnellAnteil = halten.length
    ? Math.round((halten.filter((h) => h <= DUMP_MINUTEN).length / halten.length) * 100) / 100
    : null;
  const quoteZahl = Math.round((gewinne / zu.length) * 100);
  const sechs = zu.filter((t) => t.x >= 6).length;
  const muster = musterVon(quoteZahl, haltMedian, schnellAnteil, sechs);

  return {
    trades: zu.length,
    offen: offen,
    genug: true,
    quote: Math.round((gewinne / zu.length) * 100),
    median: Math.round(median * 100) / 100,
    bestX: Math.round(xs[xs.length - 1] * 10) / 10,
    // Fuer das Ziel "5 Euro rein, 30 Euro raus" zaehlt genau eine Zahl:
    // wie oft hat dieser Mensch eine Position wirklich versechsfacht
    // UND sie dann auch verkauft? Papiergewinne zaehlen hier nicht.
    sechsfach: zu.filter((t) => t.x >= 6).length,
    offen: offen,
    unklar: unklar,
    haltMin: haltMedian,
    schnellAnteil: schnellAnteil,
    // Das Urteil, das vorher gefehlt hat.
    muster: muster,
  };
}

/**
 * Ist das ein Kundschafter - oder jemand, der dich als Ausstieg braucht?
 *
 * Der Unterschied ist mit blossem Auge nicht zu sehen, und genau das ist
 * das Problem: eine Pump-and-Dump-Wallet sieht in JEDER Statistik
 * grossartig aus. Hohe Trefferquote, gute Multiplikatoren, immer frueh
 * dabei. Sie gewinnt ja auch - nur eben auf Kosten derer, die ihr
 * folgen.
 *
 * Was sie verraet, ist die Uhr. Wer eine Position nach vier Minuten
 * komplett aufloest, hat nicht an den Coin geglaubt. Er hat gekauft,
 * gewartet bis genug Leute nachgezogen sind, und in deren Kaufdruck
 * hinein verkauft. Wenn du seinem Kauf folgst, kaufst du ihm sein Paket
 * ab, kurz bevor er es loswerden will - du bist nicht sein Nachahmer,
 * du bist sein Abnehmer.
 *
 * Deshalb ist eine hohe Trefferquote OHNE Haltedauer wertlos als
 * Empfehlung. Erst beides zusammen ergibt eine Aussage.
 */
const DUMP_MINUTEN = 20;

function musterVon(quote, haltMin, schnellAnteil, sechsfach) {
  if (haltMin == null) return "unklar";
  if (schnellAnteil >= 0.6 && haltMin <= DUMP_MINUTEN) return "dumper";
  if (haltMin <= 5) return "dumper";
  if (quote != null && quote < 25) return "verlierer";
  if (haltMin >= 60 && quote != null && quote >= 50) return "geduldig";
  if (sechsfach >= 2) return "treffer";
  return "normal";
}

/** Die Bilanz einer Wallet holen. Ein Helius-Aufruf, zwoelf Stunden gecacht. */
async function walletLedger(wallet, opts) {
  if (!hasKey()) return { trades: 0, genug: false, quote: null, median: null };
  const key = process.env.HELIUS_API_KEY;
  const seiten = (opts && opts.pages) || 3;

  // Warum mehrere Seiten? Live gemessen: eine Wallet verkaufte einen
  // Coin in neunzehn Tranchen, der zugehoerige Kauf lag aber schon
  // ausserhalb der letzten hundert Transaktionen. Ergebnis: null
  // abgeschlossene Positionen, obwohl der Mensch staendig handelt. Bei
  // einem aktiven Haendler liegt fast jede Position halb ausserhalb
  // eines Hundert-Zeilen-Fensters - man muss weiter zurueckschauen,
  // sonst misst man nur den Fensterrand.
  try {
    const txs = await cached("ledger:" + wallet + ":" + seiten, 12 * 60 * 60 * 1000, async () => {
      let alle = [];
      let before = null;
      for (let i = 0; i < seiten; i++) {
        let url =
          HELIUS + "/v0/addresses/" + wallet + "/transactions?api-key=" + encodeURIComponent(key) +
          "&type=SWAP&limit=100";
        if (before) url += "&before=" + before;
        const data = await getJson(url, { source: "helius", timeoutMs: 9000, retries: 0 });
        const seite = Array.isArray(data) ? data : [];
        alle = alle.concat(seite);
        if (seite.length < 100) break;
        before = seite[seite.length - 1] && seite[seite.length - 1].signature;
        if (!before) break;
        await new Promise((r) => setTimeout(r, 550));
      }
      return alle;
    });
    const b = ledgerFromSwaps(txs, wallet);
    b.gesehen = txs.length;
    return b;
  } catch (err) {
    return { trades: 0, genug: false, quote: null, median: null, fehler: true };
  }
}

module.exports.ledgerFromSwaps = ledgerFromSwaps;
module.exports.walletLedger = walletLedger;
module.exports.BILANZ_MIN_TRADES = BILANZ_MIN_TRADES;
module.exports.musterVon = musterVon;
module.exports.DUMP_MINUTEN = DUMP_MINUTEN;

// Frueher stand hier 15 - also genau das Bot-Fenster, das wir jetzt
// ueberspringen. Das Fenster liegt dahinter: die ersten Menschen.
const EINMAL_RANG = 45;
const EINMAL_SOL = 0.3;
const EINMAL_LAUF = 100;

/**
 * Reicht EIN Treffer? Meistens nein - aber manchmal doch.
 *
 * Bedingungen, alle gleichzeitig: es war ein frischer Launch (nur da
 * heisst ein niedriger Rang wirklich "frueh"), er war unter den ersten
 * fuenfzehn Kaeufern, er hat echtes Geld gesetzt statt einen
 * Centbetrag, und der Coin ist danach wirklich gelaufen. Wer das alles
 * erfuellt, hat nicht einfach nur Glueck gehabt.
 */
function qualifiesAlone(hit) {
  if (!hit || !hit.coins || hit.coins.length !== 1) return false;
  const c = hit.coins[0];
  // Bei einem etablierten Coin heisst "Rang 3" nur "der dritte im
  // untersuchten Zeitfenster" - eine beliebige Zahl, kein frueher
  // Einstieg.
  if (c.stage !== "launch") return false;
  if (c.rank > EINMAL_RANG) return false;
  if ((c.sol || 0) < EINMAL_SOL) return false;
  if ((c.priceChangeH24 || 0) < EINMAL_LAUF) return false;
  return true;
}

async function findScouts(opts) {
  const options = opts || {};
  if (!hasKey()) return { keyMissing: true, scouts: [], winners: [] };

  // Zwei Durchgaenge: frische Launches und etablierte Coins. Sie finden
  // voellig unterschiedliche Leute, und genau darum geht es.
  const [fresh, old] = await Promise.all([
    winners(options.coins || 4),
    establishedRunners(options.established == null ? 3 : options.established),
  ]);
  // Zweiter Riegel gegen Doppelzaehlung: selbst wenn sich die
  // Altersgrenzen einmal verschieben, darf ein Coin nur einmal geprueft
  // werden. Ein Coin, zwei Treffer waere gelogen.
  const jobSeen = new Set();
  const jobs = [];
  for (const c of fresh) {
    if (jobSeen.has(c.address)) continue;
    jobSeen.add(c.address);
    jobs.push({ coin: c, stage: "launch" });
  }
  for (const c of old) {
    if (jobSeen.has(c.address)) continue;
    jobSeen.add(c.address);
    jobs.push({ coin: c, stage: "etabliert" });
  }
  if (!jobs.length) return { keyMissing: false, scouts: [], winners: [] };

  const hits = new Map();
  const checked = [];
  for (let i = 0; i < jobs.length; i++) {
    const coin = jobs[i].coin;
    const stage = jobs[i].stage;
    if (i > 0) await new Promise((r) => setTimeout(r, 550));
    let buyers = [];
    try {
      buyers = stage === "launch" ? await earlyBuyers(coin.address, 40) : await buyersBefore(coin.address, 40);
    } catch (err) {
      continue;
    }
    checked.push({
      address: coin.address,
      symbol: coin.symbol,
      priceChangeH24: coin.priceChangeH24,
      ageMinutes: coin.ageMinutes,
      stage: stage,
      buyers: buyers.length,
    });
    buyers.forEach((buyer) => {
      const hit = hits.get(buyer.wallet) || { wallet: buyer.wallet, coins: [], bestRank: 999, sols: [] };
      hit.coins.push({
        symbol: coin.symbol,
        address: coin.address,
        rank: buyer.rank,
        sol: buyer.sol,
        stage: stage,
        priceChangeH24: coin.priceChangeH24,
      });
      hit.bestRank = Math.min(hit.bestRank, buyer.rank);
      hit.sols.push(buyer.sol || 0);
      hits.set(buyer.wallet, hit);
    });
  }

  const total = checked.length;

  // Zwei Wege, als Kundschafter zu gelten - und der zweite ist der
  // Grund, warum ueberhaupt etwas herauskommt.
  //
  // Live gemessen: vier untersuchte Coins, 95 gefundene Kaeufer, null
  // Wallets in zwei davon. Die Ueberschneidung zu verlangen ist eine
  // Wette auf einen Zufall, der meistens ausbleibt - und dann steht da
  // "keine Ergebnisse", obwohl 95 Leute untersucht wurden.
  //
  //   MEHRFACH - in zwei oder mehr der untersuchten Coins frueh dabei.
  //              Das bleibt das starke Signal, und es hat Vorrang.
  //   EINMAL   - nur ein Coin, aber unter den ersten fuenfzehn Kaeufern,
  //              mit echtem Geld (kein Centbetrag), und der Coin ist
  //              danach wirklich gelaufen. Schwaecher, aber nicht
  //              wertlos - und es steht dran, dass es schwaecher ist.
  const scouts = Array.from(hits.values())
    .filter((h) => h.coins.length >= SCOUT_MIN_HITS || qualifiesAlone(h))
    // Wer in fast allen untersuchten Coins drin war, kauft alles. Das ist
    // ein Bot, kein Kundschafter - und sein Treffer sagt nichts aus.
    .filter((h) => total < 4 || h.coins.length <= Math.ceil(total * 0.75))
    .map((h) => {
      const median = medianOf(h.sols);
      return {
        wallet: h.wallet,
        hits: h.coins.length,
        bestRank: h.bestRank,
        medianSol: Math.round(median * 1000) / 1000,
        totalSol: Math.round(h.sols.reduce((x, y) => x + y, 0) * 100) / 100,
        kind: kindOf(median),
        // Woher der Treffer kommt - der Unterschied gehoert dem
        // Benutzer gesagt, nicht in einer Rangliste versteckt.
        tier: h.coins.length >= SCOUT_MIN_HITS ? "mehrfach" : "einmal",
        // Wer in etablierten Coins vor dem Anstieg drin war, spielt ein
        // anderes Spiel als ein Launch-Sniper. Beides ist gueltig - man
        // darf es nur nicht verwechseln.
        onEstablished: h.coins.filter((c) => c.stage === "etabliert").length,
        coins: h.coins.sort((a, b) => a.rank - b.rank).slice(0, 4),
      };
    })
    // Zuerst die mit dem groesseren Einsatz: wer 3 SOL setzt, hat eine
    // Meinung. Wer 0,03 SOL setzt, hat ein Skript.
    .sort((a, b) => b.hits - a.hits || b.medianSol - a.medianSol || a.bestRank - b.bestRank)
    .slice(0, options.max || 8);

  // Die Einmal-Treffer duerfen die Mehrfach-Treffer nie verdraengen:
  // sie sind Auffuellung, kein Ersatz.
  const mehrfach = scouts.filter((x) => x.tier === "mehrfach");
  const platz = Math.max(0, (options.max || 8) - mehrfach.length);
  const einmal = scouts.filter((x) => x.tier === "einmal").slice(0, platz);
  const gereiht = mehrfach.concat(einmal);

  // Die Bilanz wird bewusst NICHT hier geholt. Sie braucht drei Abfragen
  // pro Wallet, und die Coin-Pruefung oben hat schon die Haelfte der
  // dreissig Sekunden verbraucht, die Vercel einer Funktion gibt. Sie
  // laeuft stattdessen als eigener Aufruf (/api/ledger), sobald die
  // Liste steht: erst erscheinen die Kundschafter, eine Sekunde spaeter
  // fuellen sich ihre Zahlen.

  return { keyMissing: false, scouts: gereiht, winners: checked };
}

/**
 * Alles in einem: Kundschafter suchen UND gleich schauen, was sie
 * gerade kaufen. Das ist die Antwort auf "sag mir einfach, welche Coins
 * von guten Leuten gekauft werden" - ohne dass jemand etwas eintragen
 * muss.
 */
async function autoScout(opts) {
  const options = opts || {};
  const found = await findScouts(options);
  if (found.keyMissing || !found.scouts.length) {
    return { keyMissing: found.keyMissing, scouts: found.scouts, winners: found.winners, moves: [], clusters: [] };
  }
  // Wem folgen wir? Zuerst denen mit echtem Einsatz. Einem Streuer zu
  // folgen bringt nichts - er kauft in der Minute den naechsten.
  const ranked = found.scouts.slice().sort((a, b) => {
    const weight = (x) => (x.kind === "position" ? 2 : x.kind === "klein" ? 1 : 0) + (x.onEstablished ? 1 : 0);
    return weight(b) - weight(a) || b.hits - a.hits || b.medianSol - a.medianSol;
  });
  const addresses = ranked.slice(0, options.follow || 4).map((s) => s.wallet);
  const tracked = await trackWallets(addresses, { buysOnly: true, limit: 10, max: 30 });
  if (tracked.moves.length) {
    await enrich(tracked.moves);
    await rankMoves(tracked.moves, found.scouts);
  }
  return {
    keyMissing: false,
    scouts: found.scouts,
    winners: found.winners,
    moves: tracked.moves,
    clusters: clusters(tracked.moves),
    errors: tracked.errors,
  };
}

module.exports.winners = winners;
module.exports.earlyBuyers = earlyBuyers;
module.exports.buyersBefore = buyersBefore;
module.exports.establishedRunners = establishedRunners;
module.exports.kindOf = kindOf;
module.exports.medianOf = medianOf;
module.exports.POSITION_SOL = POSITION_SOL;
module.exports.findScouts = findScouts;
module.exports.autoScout = autoScout;
module.exports.SCOUT_MIN_HITS = SCOUT_MIN_HITS;
module.exports.ERSTE_RAENGE_BOTS = ERSTE_RAENGE_BOTS;
module.exports.qualifiesAlone = qualifiesAlone;

/* ------------------------------------------------------------------ *
 * Der Puls: alle 15 Sekunden schauen, ohne das Guthaben zu verbrennen
 * ------------------------------------------------------------------ */

/**
 * Das Problem mit "alle 15 Sekunden aktualisieren": eine volle Abfrage
 * kostet pro Wallet rund 110 Guthabenpunkte. Vier Wallets im
 * 15-Sekunden-Takt sind 105.000 Punkte pro Stunde - das Freikontingent
 * von einer Million waere nach neun Stunden weg.
 *
 * Deshalb zwei Stufen:
 *
 *   Der PULS fragt nur "gab es ueberhaupt etwas Neues?". Das ist ein
 *   einfacher RPC-Aufruf, der nur Signaturen zurueckgibt - ein Bruchteil
 *   der Kosten, und alle Wallets passen in EINE Anfrage, weil JSON-RPC
 *   Stapel erlaubt.
 *
 *   Erst WENN eine neue Signatur auftaucht, laeuft die teure Abfrage,
 *   die sagt, was gekauft wurde.
 *
 * Im Ruhezustand - und das ist der Normalfall - kostet der 15-Sekunden-
 * Takt damit fast nichts.
 */
async function pulseSignatures(addresses) {
  const key = process.env.HELIUS_API_KEY;
  const wallets = parseAddresses(addresses);
  if (!key || !wallets.length) return { keyMissing: !key, wallets: [] };

  const body = wallets.map((wallet, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "getSignaturesForAddress",
    params: [wallet, { limit: 5 }],
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch("https://mainnet.helius-rpc.com/?api-key=" + encodeURIComponent(key), {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Helius RPC HTTP " + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];

    const out = wallets.map((wallet, i) => {
      const hit = list.find((r) => r && r.id === i);
      const sigs = (hit && hit.result) || [];
      return {
        wallet: wallet,
        sigs: sigs
          .filter((s) => s && s.signature && !s.err)
          .map((s) => ({ signature: s.signature, blockTime: s.blockTime || null })),
      };
    });
    return { keyMissing: false, wallets: out };
  } finally {
    clearTimeout(timer);
  }
}

module.exports.pulseSignatures = pulseSignatures;

/* ------------------------------------------------------------------ *
 * Relevanz: welcher Kauf ist eine Meldung wert?
 * ------------------------------------------------------------------ */

/**
 * Der erste Versuch war eine feste SOL-Schwelle, und die ist falsch.
 *
 * Ein halbes SOL in einen Coin mit 5.000 Dollar Marktwert sind ueber zwei
 * Prozent des ganzen Dings - das ist eine Ansage. Dasselbe halbe SOL in
 * einen Coin mit fuenf Millionen ist ein Rundungsfehler. Eine feste
 * Schwelle wirft beides in denselben Topf und verliert genau die Faelle,
 * um die es geht: kleine Coins, in die jemand mit Ueberzeugung reingeht.
 *
 * Deshalb wird nicht der Betrag bewertet, sondern vier Dinge zusammen:
 *
 *   Ueberzeugung - wie gross ist der Einsatz FUER DIESEN Trader? Wer
 *                  sonst 0,03 SOL setzt und ploetzlich 0,3, hat sich
 *                  entschieden. Wer sonst 2 SOL setzt und jetzt 0,3,
 *                  langweilt sich.
 *   Biss         - welchen Anteil am Coin hat er damit genommen? Das ist
 *                  die Zahl, die einen 5k-Coin von einem 5M-Coin trennt.
 *   Wer          - ein Positionstrader zaehlt mehr als ein Streuer.
 *   Substanz     - unsere eigene Pruefung. Ein Coin mit null echtem
 *                  Volumen und offenem Mint-Recht ist keine Meldung wert,
 *                  egal wer ihn kauft.
 *
 * Ergebnis 0 bis 100, und jeder Punkt laesst sich in einem Satz erklaeren
 * - das steht als "warum" mit in der Antwort.
 */
// 5 Euro rein, 30 Euro raus. Das ist das erklaerte Ziel, und es ist
// eine bessere Zielvorgabe als "moeglichst viel": es ist erreichbar, es
// ist messbar, und es sagt einem, wann man verkauft.
const ZIEL_FAKTOR = 6;

function relevanceOf(move, scout, solUsd) {
  const sol = move.solAmount || 0;
  const why = [];
  let score = 0;

  // 1. Ueberzeugung, relativ zum eigenen Normalmass.
  const median = (scout && scout.medianSol) || 0;
  if (median > 0.005 && sol > 0) {
    const ratio = sol / median;
    const pts = Math.min(35, Math.max(0, Math.log2(ratio + 1) * 18));
    score += pts;
    if (ratio >= 1.8) why.push(Math.round(ratio * 10) / 10 + "× sein üblicher Einsatz");
  } else if (sol >= 1) {
    // Ohne Vergleichsmass zaehlt der Betrag ersatzweise.
    score += 18;
  }

  // 2. Biss: welchen Anteil am Coin hat er gekauft?
  const mcap = move.coin && move.coin.marketCap;
  if (solUsd && mcap && mcap > 0 && sol > 0) {
    const share = (sol * solUsd) / mcap;
    move.sharePct = Math.round(share * 10000) / 100;
    const pts = Math.min(30, share * 1500);
    score += pts;
    if (share >= 0.005) why.push(move.sharePct + "% des ganzen Coins");
  }

  // 3. Wer kauft - und zwar nach seiner Bilanz, nicht nach seinem Ruf.
  const kind = (scout && scout.kind) || null;
  if (kind === "position") {
    score += 20;
    why.push("Positionstrader");
  } else if (kind === "klein") {
    score += 10;
  }
  const bilanz = scout && scout.bilanz;
  if (bilanz && bilanz.genug) {
    if (bilanz.quote >= 55) {
      score += 15;
      why.push(bilanz.quote + "% seiner Trades im Plus (" + bilanz.trades + " gemessen)");
    } else if (bilanz.quote >= 40) {
      score += 5;
    } else {
      score -= 10;
      why.push("nur " + bilanz.quote + "% seiner Trades im Plus");
    }
    if (bilanz.sechsfach >= 2) why.push(bilanz.sechsfach + "× hat er selbst versechsfacht und verkauft");
  }

  // 4. Unsere eigene Pruefung - und zwar als FAKTOR, nicht als Abzug.
  //
  // Beim Testen kam ein Coin mit unserem Score 31 auf 65 Relevanz, weil
  // jemand 2 SOL reingeworfen hatte. Das ist genau falsch herum: wie
  // ueberzeugt jemand reingeht, aendert nichts daran, ob der Contract
  // nachdrucken kann. Ein Multiplikator kann das Ergebnis deckeln, ein
  // Abzug nicht.
  let faktor = 1;
  if (move.score != null) {
    if (move.score >= 70) {
      faktor = 1.15;
      why.push("sauber geprüft (" + move.score + ")");
    } else if (move.score >= 50) {
      faktor = 1;
    } else if (move.score >= 35) {
      faktor = 0.55;
      why.push("aber unser Score nur " + move.score);
    } else {
      faktor = 0.3;
      why.push("unser Score nur " + move.score + " — Finger weg");
    }
  } else {
    // Ohne eigene Pruefung bleibt es eine Behauptung.
    faktor = 0.7;
  }

  // 4b. Ist das Ziel von hier aus ueberhaupt erreichbar?
  //
  // Das Ziel heisst: 5 Euro rein, 30 Euro raus. Das sind Faktor 6, und
  // Faktor 6 ist eine Aussage ueber das Marktkapital, nicht ueber den
  // Coin. Ein Coin bei 8.000 muss auf 48.000 - das passiert an einem
  // normalen Tag dutzendfach. Ein Coin bei 800.000 muss auf 4,8
  // Millionen - das passiert selten, und wenn, dann nicht heute.
  // Deshalb wird hier nach dem WEG gefiltert, nicht nach der Groesse an
  // sich.
  if (mcap && mcap > 0) {
    move.zielMcap = Math.round(mcap * ZIEL_FAKTOR);
    if (mcap <= 50000) {
      faktor *= 1.1;
    } else if (mcap <= 250000) {
      faktor *= 0.8;
      why.push("für 6× müsste er auf $" + Math.round(move.zielMcap / 1000) + "k");
    } else {
      faktor *= 0.45;
      why.push("zu gross für 6× — bräuchte $" + Math.round(move.zielMcap / 1000) + "k");
    }
  }

  // 5. Kommt man wieder raus?
  //
  // Das hier fehlte und war der teuerste blinde Fleck. Ein Coin mit
  // 3000 Dollar Pool laesst sich kaufen, aber nicht verkaufen: die
  // eigene Verkaufsorder bewegt den Preis so stark, dass vom Gewinn
  // nichts uebrig bleibt. Ein Alarm fuer so einen Coin ist schlimmer
  // als kein Alarm, weil er nach einer Gelegenheit aussieht.
  const liq = (move.coin && move.coin.liquidityUsd) || 0;
  if (liq > 0 && liq < 5000) {
    faktor *= 0.35;
    why.push("Pool nur $" + Math.round(liq / 100) / 10 + "k — Ausstieg fraglich");
  } else if (liq > 0 && liq < 12000) {
    faktor *= 0.7;
  }

  // Kein echtes Volumen heisst: es handeln nur Bots miteinander. Bei
  // einem zwei Minuten alten Coin ist das normal, ab einer halben
  // Stunde ist es ein Befund.
  const organic = move.coin && move.coin.organicShareH1;
  const alter = (move.coin && move.coin.ageMinutes) || 0;
  if (organic != null && organic < 0.05 && alter >= 30) {
    faktor *= 0.6;
    why.push("kein echtes Volumen");
  }

  move.relevance = Math.max(0, Math.min(100, Math.round(score * faktor)));
  move.why = why;
  return move.relevance;
}

/**
 * Wer streut, meint es nicht ernst.
 *
 * Beim Livetest kamen drei fast gleiche Alarme hintereinander - dieselbe
 * Wallet, derselbe Betrag, drei verschiedene Coins innerhalb von zwei
 * Minuten. Das ist kein dreifaches Signal, das ist ein Signal, das
 * dreimal erscheint. Wir lassen den staerksten Kauf einer Wallet stehen
 * und daempfen die weiteren, statt sie ganz zu verwerfen - manchmal ist
 * der zweite der richtige.
 */
function dampenBursts(moves) {
  const byWallet = new Map();
  for (const move of moves) {
    if (move.side !== "kauf" || !move.wallet) continue;
    const list = byWallet.get(move.wallet) || [];
    list.push(move);
    byWallet.set(move.wallet, list);
  }
  for (const list of byWallet.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    for (let i = 1; i < list.length; i++) {
      const daempfer = i === 1 ? 0.85 : i === 2 ? 0.6 : 0.35;
      const move = list[i];
      move.relevance = Math.round((move.relevance || 0) * daempfer);
      if (i >= 2) {
        move.why = (move.why || []).concat(["einer von " + list.length + " Käufen dieser Wallet"]);
      }
    }
  }
  return moves;
}

/** Relevanz fuer eine ganze Liste, mit einmalig geholtem SOL-Kurs. */
async function rankMoves(moves, scouts) {
  if (!moves || !moves.length) return moves || [];
  let solUsd = null;
  try {
    solUsd = await jup.solPrice();
  } catch (err) {
    solUsd = null;
  }
  const byWallet = new Map((scouts || []).map((s) => [s.wallet, s]));
  for (const move of moves) {
    const scout = byWallet.get(move.wallet) || null;
    if (scout) {
      move.scoutKind = scout.kind;
      move.scoutMedianSol = scout.medianSol;
    }
    relevanceOf(move, scout, solUsd);
  }
  return dampenBursts(moves);
}

module.exports.relevanceOf = relevanceOf;
module.exports.rankMoves = rankMoves;
module.exports.ZIEL_FAKTOR = ZIEL_FAKTOR;
module.exports.dampenBursts = dampenBursts;
