"use strict";
/**
 * Wer geht hier gerade rein - und taugt der etwas?
 *
 * Das ist die Frage, die du beim Chart-Anschauen ohnehin stellst und die
 * ein Werkzeug viel schneller beantworten kann als ein Mensch: nicht
 * "wie viele kaufen", sondern "WER kauft, und was ist von dem zu
 * halten?".
 *
 * Der Unterschied ist alles. Dreissig Kaeufer koennen sein:
 *
 *   - dreissig Bots, die jeden Launch fuer zwei Cent anspringen
 *   - fuenf Wallets einer Person, die wie dreissig aussehen
 *   - drei Leute, die seit Monaten Geld verdienen
 *
 * Im Chart sehen alle drei Faelle identisch aus. Auf der Kette nicht.
 *
 * Was hier gemessen wird, pro Wallet:
 *
 *   Bilanz     Aus den letzten hundert Swaps: wie viele Positionen hat
 *              er geschlossen, wie oft mit Gewinn, wie hoch der Median.
 *              Offene Positionen zaehlen NICHT - wer haelt, hat nichts
 *              bewiesen.
 *   Haltedauer Die Zahl, die einen Kundschafter von einem Pump-and-Dump-
 *              Betreiber trennt. Beide haben gute Quoten. Nur einer
 *              braucht dich als Ausstieg.
 *   Bot        Wie viele verschiedene Coins in welchem Zeitraum, mit
 *              welchem Einsatz. Sechzig Coins in zwei Stunden zu je
 *              zwei Cent ist keine Meinung, das ist eine Schrotflinte.
 *   Cluster    Zahlt jemand anderes die Gebuehr? Kaufen mehrere fuer
 *              exakt denselben Betrag? Dann sind das nicht mehrere
 *              Leute.
 *
 * Kosten, und deshalb ist das ein eigener Knopf und nichts, was
 * nebenbei laeuft: ein Aufruf fuer die Kaeuferliste plus einer pro
 * geprueftem Wallet. Bewusst nur EINE Seite pro Wallet statt drei - als
 * erster Anhaltspunkt reicht das, und es kostet ein Drittel. Wallets
 * tauchen ausserdem in vielen Coins auf, deshalb greift der
 * Zwoelf-Stunden-Cache hier besonders oft.
 */

const { getJson, cached } = require("./http");
const wl = require("./wallets");

const HELIUS = "https://api.helius.xyz";

/** Unter dem Betrag ist ein Kauf keine Meinung, sondern ein Streuschuss. */
const ERNST_SOL = 0.25;

/** So viele Wallets werden tatsaechlich durchleuchtet. Jede kostet. */
const MAX_PRUEFEN = 4;

/** Ab so vielen verschiedenen Coins pro Stunde ist es eine Maschine. */
const BOT_COINS_PRO_STUNDE = 12;

function hatSchluessel() {
  return !!process.env.HELIUS_API_KEY;
}

/**
 * Die Kaeufe der letzten Minuten - mit Zahler und Block, damit sich
 * daraus auch Cluster lesen lassen. `recentBuyersOf` in wallets.js
 * liefert nur Wallet und Betrag; fuer die Cluster-Frage brauchen wir
 * mehr, deshalb hier eine eigene, vollstaendigere Auswertung derselben
 * Abfrage.
 */
async function frischeKaeufe(mint, minuten) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  const seit = Math.floor(Date.now() / 1000 - minuten * 60);
  const url =
    HELIUS + "/v0/addresses/" + mint + "/transactions?api-key=" + encodeURIComponent(key) +
    "&type=SWAP&sort-order=desc&limit=100&gte-time=" + seit;

  const txs = await cached("kaeufer:tx:" + mint + ":" + minuten, 5 * 60 * 1000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 9000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });

  const out = [];
  for (const tx of txs) {
    const wallet = tx && tx.feePayer;
    if (!wallet) continue;
    const move = wl.buyFromSwap(tx, wallet);
    if (!move || move.mint !== mint) continue;
    out.push({
      wallet: wallet,
      seite: move.side,
      sol: move.solAmount || 0,
      zeit: move.timestamp || null,
      slot: typeof tx.slot === "number" ? tx.slot : null,
      zahler: tx.feePayer || null,
      signatur: tx.signature || null,
    });
  }
  return out;
}

/**
 * Die letzten Swaps einer Wallet - EINE Seite.
 *
 * Bewusst derselbe Cache-Schluessel, den walletLedger benutzt: taucht
 * dieselbe Wallet in mehreren Coins auf (und das tun die interessanten
 * staendig), wird die Abfrage nur einmal bezahlt. Aus denselben
 * Transaktionen entstehen danach Bilanz UND Bot-Merkmale - zwei
 * Aussagen aus einem Aufruf statt zwei Aufrufen.
 */
async function swapsVon(wallet) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  const url =
    HELIUS + "/v0/addresses/" + wallet + "/transactions?api-key=" + encodeURIComponent(key) +
    "&type=SWAP&limit=100";
  return cached("ledger:" + wallet + ":1", 12 * 60 * 60 * 1000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 9000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });
}

/**
 * Zusammengehoerige Wallets unter den aktuellen Kaeufern.
 *
 * Dasselbe Prinzip wie bei der Launch-Pruefung, nur auf das Jetzt
 * angewandt: identische Betraege auf vier Nachkommastellen und Kaeufe
 * im selben Block. Wer im selben Block wie zwei andere fuer exakt
 * denselben Betrag kauft, ist nicht der dritte Interessent.
 */
function clusterUnter(kaeufe) {
  const nurKauf = kaeufe.filter((k) => k.seite === "kauf" && k.sol >= 0.01);

  const nachBetrag = new Map();
  const nachSlot = new Map();
  for (const k of nurKauf) {
    const b = k.sol.toFixed(4);
    if (!nachBetrag.has(b)) nachBetrag.set(b, new Set());
    nachBetrag.get(b).add(k.wallet);
    if (k.slot != null) {
      if (!nachSlot.has(k.slot)) nachSlot.set(k.slot, new Set());
      nachSlot.get(k.slot).add(k.wallet);
    }
  }

  const betragGruppen = [];
  for (const [betrag, set] of nachBetrag.entries()) {
    if (set.size >= 3) betragGruppen.push({ sol: Number(betrag), wallets: Array.from(set) });
  }
  const slotGruppen = [];
  for (const [slot, set] of nachSlot.entries()) {
    if (set.size >= 3) slotGruppen.push({ slot: slot, wallets: Array.from(set) });
  }

  const verdaechtig = new Set();
  betragGruppen.forEach((g) => g.wallets.forEach((w) => verdaechtig.add(w)));
  slotGruppen.forEach((g) => g.wallets.forEach((w) => verdaechtig.add(w)));

  return {
    betragGruppen: betragGruppen.sort((a, b) => b.wallets.length - a.wallets.length).slice(0, 3),
    slotGruppen: slotGruppen.sort((a, b) => b.wallets.length - a.wallets.length).slice(0, 3),
    wallets: Array.from(verdaechtig),
  };
}

/**
 * Bot-Merkmale aus den Swaps einer Wallet.
 *
 * Absichtlich getrennt von der Bilanz: eine Maschine kann eine
 * hervorragende Bilanz haben. Sie ist trotzdem niemand, dem ein Mensch
 * folgen koennte - bis du ihren Kauf siehst, ist sie wieder draussen.
 */
function botMerkmale(txs, wallet) {
  const zeiten = [];
  const mints = new Set();
  const einsaetze = [];
  for (const tx of txs || []) {
    const move = wl.buyFromSwap(tx, wallet);
    if (!move) continue;
    if (move.timestamp) zeiten.push(move.timestamp);
    if (move.mint) mints.add(move.mint);
    if (move.side === "kauf" && move.solAmount > 0) einsaetze.push(move.solAmount);
  }
  if (zeiten.length < 5) return { messbar: false };

  zeiten.sort((a, b) => a - b);
  const spanneStd = Math.max(0.05, (zeiten[zeiten.length - 1] - zeiten[0]) / 3600);
  const coinsProStunde = mints.size / spanneStd;
  const median = wl.medianOf(einsaetze);

  return {
    messbar: true,
    coins: mints.size,
    spanneStd: Math.round(spanneStd * 10) / 10,
    coinsProStunde: Math.round(coinsProStunde * 10) / 10,
    medianSol: Math.round(median * 1000) / 1000,
    art: wl.kindOf(median),
    // Zwei Merkmale muessen zusammenkommen: Tempo UND Centbetraege. Ein
    // schneller Haendler mit ernsthaften Positionen ist kein Bot, und
    // ein langsamer mit Kleinbetraegen ist nur vorsichtig.
    bot: coinsProStunde >= BOT_COINS_PRO_STUNDE && median < 0.1,
  };
}

/** Aus Bilanz, Bot-Merkmalen und Cluster ein Urteil in einem Satz. */
function walletUrteil(b, bot, imCluster) {
  if (imCluster) {
    return {
      stufe: "schlecht",
      wort: "Cluster",
      text: "Gehoert zu einer Gruppe, die gleichzeitig und in gleichen Betraegen kauft. Das ist eine Person, nicht mehrere.",
    };
  }
  if (bot && bot.bot) {
    return {
      stufe: "schlecht",
      wort: "Bot",
      text: bot.coins + " verschiedene Coins in " + bot.spanneStd + " Stunden, Median " + bot.medianSol +
        " SOL. Eine Schrotflinte - dem zu folgen ist sinnlos.",
    };
  }
  if (!b || b.muster === "unlesbar") {
    return {
      stufe: "unbekannt",
      wort: "Unlesbar",
      text: "Bewegt ueber Unterkonten - was diese Wallet wirklich tut, ist von aussen nicht zu sehen.",
    };
  }
  if (!b.genug) {
    return {
      stufe: "unbekannt",
      wort: "Zu wenig",
      text: "Nur " + (b.trades || 0) + " abgeschlossene Positionen sichtbar" +
        (b.offen ? " (" + b.offen + " noch offen)" : "") + ". Zu wenig fuer ein Urteil.",
    };
  }

  const kern = b.quote + "% Trefferquote ueber " + b.trades + " geschlossene Positionen, Median " +
    b.median + "x, haelt im Schnitt " + (b.haltMin == null ? "?" : minutenTxt(b.haltMin)) + ".";

  if (b.muster === "dumper") {
    return {
      stufe: "schlecht",
      wort: "Dumper",
      text: kern + " Verkauft so schnell, dass seine Kaeufer sein Ausstieg sind - du waerst sein Abnehmer.",
    };
  }
  if (b.muster === "verlierer") {
    return { stufe: "schlecht", wort: "Verlierer", text: kern + " Der verliert Geld." };
  }
  if (b.muster === "treffer") {
    return {
      stufe: "gut",
      wort: "Trifft",
      text: kern + " Hat " + b.sechsfach + " Positionen versechsfacht UND verkauft - genau deine Sorte.",
    };
  }
  if (b.muster === "geduldig") {
    return { stufe: "gut", wort: "Geduldig", text: kern + " Haelt lange und gewinnt. Kein Schnellschuss." };
  }
  return { stufe: "mittel", wort: "Normal", text: kern };
}

function minutenTxt(m) {
  if (m == null) return "?";
  if (m < 60) return Math.round(m) + " Min";
  if (m < 1440) return Math.round(m / 60) + " Std";
  return Math.round(m / 1440) + " Tage";
}

/**
 * Das Gesamtbild.
 *
 * Gibt IMMER ein Objekt zurueck, auch wenn nichts geht - "nicht
 * pruefbar" ist eine Aussage, eine leere Flaeche nicht.
 */
async function kaeuferBild(mint, minuten, wieViele) {
  const fenster = Math.min(360, Math.max(10, minuten || 60));
  const anzahl = Math.min(MAX_PRUEFEN, Math.max(1, wieViele || MAX_PRUEFEN));

  if (!hatSchluessel()) {
    return { verfuegbar: false, grund: "Kein Helius-Schluessel gesetzt.", wallets: [] };
  }

  let kaeufe = [];
  try {
    kaeufe = await frischeKaeufe(mint, fenster);
  } catch (err) {
    return { verfuegbar: false, grund: (err && err.message) || "Abfrage fehlgeschlagen.", wallets: [] };
  }
  if (!kaeufe.length) {
    return { verfuegbar: true, grund: null, fenster: fenster, kaeufer: 0, wallets: [], gruende: ["Keine Kaeufe im Fenster."] };
  }

  const cluster = clusterUnter(kaeufe);
  const imCluster = new Set(cluster.wallets);

  // Pro Wallet den Gesamteinsatz - wer dreimal nachlegt, ist eine
  // Meinung, nicht drei.
  const proWallet = new Map();
  for (const k of kaeufe) {
    if (k.seite !== "kauf") continue;
    proWallet.set(k.wallet, (proWallet.get(k.wallet) || 0) + k.sol);
  }
  const alle = Array.from(proWallet.entries())
    .map(([wallet, sol]) => ({ wallet: wallet, sol: Math.round(sol * 1000) / 1000 }))
    .sort((a, b) => b.sol - a.sol);

  const ernst = alle.filter((e) => e.sol >= ERNST_SOL);

  // Nur die groessten ernsthaften Einsaetze werden durchleuchtet, und
  // Cluster-Wallets zuerst uebersprungen: ueber die ist schon alles
  // gesagt, und eine Bilanz dafuer waere verschwendetes Guthaben.
  const kandidaten = ernst.filter((e) => !imCluster.has(e.wallet)).slice(0, anzahl);

  const geprueft = [];
  const frist = Date.now() + 20000;
  for (let i = 0; i < kandidaten.length; i++) {
    if (Date.now() > frist) break;
    if (i > 0) await new Promise((r) => setTimeout(r, 550));
    const w = kandidaten[i].wallet;
    let bilanz = null;
    let bot = { messbar: false };
    try {
      // Eine Seite reicht als erster Anhaltspunkt und kostet ein Drittel
      // von dem, was die volle Bilanz kostet. Aus demselben Abruf
      // entstehen Bilanz und Bot-Merkmale.
      const txs = await swapsVon(w);
      bilanz = wl.ledgerFromSwaps(txs, w);
      bilanz.gesehen = txs.length;
      bot = botMerkmale(txs, w);
    } catch (err) {
      bilanz = null;
    }
    geprueft.push(Object.assign(
      { wallet: w, sol: kandidaten[i].sol, bilanz: bilanz, bot: bot },
      { urteil: walletUrteil(bilanz, bot, false) },
    ));
  }

  // Die Cluster-Wallets kommen ungeprueft, aber benannt dazu - sie
  // gehoeren ins Bild, nur eben mit ihrem eigenen Urteil.
  for (const e of ernst.filter((x) => imCluster.has(x.wallet)).slice(0, 3)) {
    geprueft.push({
      wallet: e.wallet, sol: e.sol, bilanz: null, bot: null,
      urteil: walletUrteil(null, null, true),
    });
  }

  const gute = geprueft.filter((g) => g.urteil.stufe === "gut");
  const schlechte = geprueft.filter((g) => g.urteil.stufe === "schlecht");

  const gruende = [];
  if (gute.length) {
    gruende.push(
      gute.length === 1
        ? "Eine Wallet mit nachweisbar guter Bilanz ist hier drin."
        : gute.length + " Wallets mit nachweisbar guter Bilanz sind hier drin.",
    );
  }
  if (cluster.wallets.length >= 3) {
    gruende.push(
      cluster.wallets.length + " der Kaeufer kaufen in gleichen Betraegen oder im selben Block. Das ist eine Gruppe, kein Interesse.",
    );
  }
  if (!gute.length && schlechte.length >= 2) {
    gruende.push("Von den groessten Kaeufern taugt keiner - Bots, Dumper oder Cluster.");
  }
  if (!gruende.length) {
    gruende.push("Nichts Auffaelliges, aber auch niemand, ueber den sich etwas Gutes sagen laesst.");
  }

  return {
    verfuegbar: true,
    grund: null,
    fenster: fenster,
    kaeufer: alle.length,
    ernsthaft: ernst.length,
    streuer: alle.length - ernst.length,
    summeSol: Math.round(alle.reduce((s, e) => s + e.sol, 0) * 100) / 100,
    clusterWallets: cluster.wallets.length,
    betragGruppen: cluster.betragGruppen,
    slotGruppen: cluster.slotGruppen,
    wallets: geprueft,
    gute: gute.length,
    schlecht: schlechte.length,
    gruende: gruende,
  };
}

module.exports = {
  kaeuferBild,
  frischeKaeufe,
  swapsVon,
  clusterUnter,
  botMerkmale,
  walletUrteil,
  minutenTxt,
  ERNST_SOL,
  MAX_PRUEFEN,
  BOT_COINS_PRO_STUNDE,
};
