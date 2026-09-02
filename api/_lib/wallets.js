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
  if (tracked.moves.length) await enrich(tracked.moves);
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
    const lists = await Promise.allSettled([jup.topOrganic("24h"), jup.topTraded("24h"), jup.topOrganic("6h")]);
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
        if ((coin.liquidityUsd || 0) < 20000) continue;
        if ((coin.priceChangeH24 || 0) < 25) continue;
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
async function earlyBuyers(mint, howMany) {
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
  return Array.from(first.values())
    .filter((b) => counts.get(b.wallet) <= 3)
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
    const lists = await Promise.allSettled([jup.topOrganic("24h"), jup.topTraded("24h")]);
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
        if ((coin.marketCap || 0) < 1000000) continue;
        if ((coin.liquidityUsd || 0) < 100000) continue;
        if ((coin.priceChangeH24 || 0) < 25) continue;
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
  const scouts = Array.from(hits.values())
    .filter((h) => h.coins.length >= SCOUT_MIN_HITS)
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

  return { keyMissing: false, scouts: scouts, winners: checked };
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
  if (tracked.moves.length) await enrich(tracked.moves);
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
