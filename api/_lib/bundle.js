"use strict";
/**
 * Launch-Forensik: Bundles und zusammenhaengende Wallets.
 *
 * Das ist die Frage, die dieses Werkzeug bisher nie gestellt hat, und die
 * auf Axiom die meiste Handarbeit kostet: WEM gehoert dieser Coin
 * eigentlich, seit der ersten Sekunde?
 *
 * Ein "Bundle" heisst: der Ersteller hat die Erstellung und mehrere Kaeufe
 * in EINEM Block zusammengepackt (ueber Jito). Vor dem ersten fremden
 * Menschen liegen dann schon 20, 30, manchmal 60 Prozent des Vorrats in
 * Wallets, die alle einer Person gehoeren. Der Chart sieht danach aus wie
 * Nachfrage. Er ist eine Aufstellung. Und wenn du kaufst, bist du der
 * Ausgang, auf den seit Block eins gewartet wird.
 *
 * Das Entscheidende: das laesst sich BEWEISEN, nicht schaetzen. Ein Block
 * hat eine Nummer. Entweder ein Kauf steht im selben Block wie die
 * Erstellung oder nicht. Deshalb ist dieses Modul das verlaesslichste im
 * ganzen Werkzeug - im Gegensatz zu allem, was mit "wahrscheinlich" und
 * "sieht aus wie" arbeitet.
 *
 * Vier Spuren werden gelesen, und jede fuer sich ist verraeterisch:
 *
 *   1. Gleicher Block      Kauf im Erstell-Slot. Kein Mensch ist so
 *                          schnell. Das ist gebaut, nicht gehandelt.
 *   2. Gleicher Zahler     Wallet A kauft, aber Wallet B bezahlt die
 *                          Gebuehr. Dann gehoeren A und B zusammen -
 *                          das ist die Blasenkarte, nur hart statt bunt.
 *   3. Gleiche Betraege    Fuenf Wallets kaufen fuer exakt 0,4321 SOL.
 *                          Menschen tippen keine identischen Betraege.
 *   4. Immer noch drin     Wie viele der Bundle-Wallets stehen HEUTE noch
 *                          in den groessten Haltern? Das ist die Menge,
 *                          die dir jederzeit auf den Kopf fallen kann.
 *
 * Kosten: ein Helius-Aufruf pro Coin (rund 110 Guthaben) plus die
 * Halterverteilung. Die ersten hundert Transaktionen eines Coins aendern
 * sich nie wieder, deshalb wird das Ergebnis zwoelf Stunden gehalten.
 */

const { getJson, cached } = require("./http");
const { getMintInfo, getHolderDistribution } = require("./solana");

const HELIUS = "https://api.helius.xyz";
const WSOL = "So11111111111111111111111111111111111111112";

/** Bundle im engeren Sinn: alles, was im Erstell-Block passiert ist. */
const SNIPER_SEKUNDEN = 20;

/** Ab hier ist ein Anteil kein Detail mehr, sondern das Wesentliche. */
const ANTEIL_WARNUNG = 12;
const ANTEIL_ALARM = 25;

/** Weniger Wallets als das ist kein Bundle, sondern Zufall. */
const MIN_BUNDLE_WALLETS = 2;

function hatSchluessel() {
  return !!process.env.HELIUS_API_KEY;
}

/**
 * Die ersten hundert Transaktionen eines Mints, aelteste zuerst.
 *
 * Bewusst OHNE type=SWAP-Filter: die Erstellung selbst ist kein Swap, und
 * ohne sie kennen wir weder den Erstell-Block noch den Entwickler - also
 * genau die beiden Bezugsgroessen, um die es hier geht.
 */
async function ersteTransaktionen(mint) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  const url =
    HELIUS + "/v0/addresses/" + mint + "/transactions?api-key=" + encodeURIComponent(key) +
    "&sort-order=asc&limit=100";
  return cached("bundle:tx:" + mint, 12 * 60 * 60 * 1000, async () => {
    const data = await getJson(url, { source: "helius", timeoutMs: 10000, retries: 0 });
    return Array.isArray(data) ? data : [];
  });
}

/** Wie viel SOL hat diese Wallet in dieser Transaktion abgegeben? */
function solAbgang(tx, wallet) {
  let raus = 0;
  for (const n of (tx && tx.nativeTransfers) || []) {
    if (n && n.fromUserAccount === wallet) raus += Number(n.amount || 0) / 1e9;
  }
  for (const t of (tx && tx.tokenTransfers) || []) {
    if (t && t.mint === WSOL && t.fromUserAccount === wallet) raus += Number(t.tokenAmount || 0);
  }
  return raus;
}

/**
 * Aus den Rohtransaktionen die Kaeufe herausloesen.
 *
 * Die Falle, ueber die eine naive Fassung stolpert: die Bonding Curve
 * bekommt beim Erstellen fast den gesamten Vorrat ueberwiesen und saehe
 * damit aus wie der groesste Kaeufer aller Zeiten. Bei jedem Verkauf
 * bekommt sie die Token ausserdem zurueck.
 *
 * Der naheliegende Ausweg - "wer jemals abgibt, ist die Kurve" - waere
 * falsch und zwar an der teuersten Stelle: ein Entwickler, der spaeter
 * verkauft, wuerde damit aus seinen eigenen Kaeufen herausfallen, und
 * ausgerechnet sein Anteil ist die Zahl, um die es geht.
 *
 * Deshalb drei Merkmale statt einem:
 *
 *   - Wer in DREI oder mehr Transaktionen abgibt, ist Infrastruktur.
 *     Ein Mensch verkauft ein paar Mal, eine Kurve bei jedem Verkauf.
 *   - Wer in derselben Transaktion gibt UND nimmt, ist eine Route.
 *   - Wer auf einen Schlag mehr als die Haelfte des Vorrats bekommt,
 *     hat nichts gekauft. Auf einer Bindungskurve ist das rechnerisch
 *     unmoeglich - das ist die Erstbefuellung.
 */
const POOL_MIN_SENDUNGEN = 3;

function poolAdressen(txs, mint) {
  const sendetIn = new Map();
  const pools = new Set();

  for (const tx of txs) {
    const gibt = new Set();
    const nimmt = new Set();
    for (const t of (tx && tx.tokenTransfers) || []) {
      if (!t || t.mint !== mint) continue;
      if (t.fromUserAccount) gibt.add(t.fromUserAccount);
      if (t.toUserAccount) nimmt.add(t.toUserAccount);
    }
    for (const a of gibt) {
      sendetIn.set(a, (sendetIn.get(a) || 0) + 1);
      if (nimmt.has(a)) pools.add(a);
    }
  }

  for (const [a, n] of sendetIn.entries()) {
    if (n >= POOL_MIN_SENDUNGEN) pools.add(a);
  }
  return pools;
}

function kaeufeAus(txs, mint, supply) {
  const pools = poolAdressen(txs, mint);
  const grenze = supply > 0 ? supply * 0.5 : null;

  const kaeufe = [];
  for (const tx of txs) {
    if (!tx) continue;
    // Pro Transaktion pro Empfaenger nur EIN Eintrag - manche Routen
    // splitten eine Fuellung in mehrere Teiltransfers auf.
    const proEmpfaenger = new Map();
    for (const t of (tx.tokenTransfers) || []) {
      if (!t || t.mint !== mint) continue;
      const an = t.toUserAccount;
      if (!an || pools.has(an)) continue;
      proEmpfaenger.set(an, (proEmpfaenger.get(an) || 0) + Number(t.tokenAmount || 0));
    }
    for (const [wallet, tokens] of proEmpfaenger.entries()) {
      if (!(tokens > 0)) continue;
      if (grenze != null && tokens >= grenze) continue;
      kaeufe.push({
        wallet: wallet,
        tokens: tokens,
        slot: typeof tx.slot === "number" ? tx.slot : null,
        zeit: typeof tx.timestamp === "number" ? tx.timestamp : null,
        zahler: tx.feePayer || null,
        sol: Math.round(solAbgang(tx, wallet) * 10000) / 10000,
        signatur: tx.signature || null,
      });
    }
  }
  return kaeufe;
}

/** Gruppen gleicher Werte finden - fuer Zahler und Betraege. */
function gruppen(liste, schluessel) {
  const map = new Map();
  for (const e of liste) {
    const k = schluessel(e);
    if (k == null || k === "") continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

/**
 * Fremdfinanzierte Kaeufe: Wallet kauft, jemand anderes zahlt die Gebuehr.
 *
 * Das ist der harte Beweis fuer Zusammengehoerigkeit, den die bunte
 * Blasenkarte optisch andeutet. Wer fuer fuenf fremde Wallets die Gebuehr
 * uebernimmt, steuert fuenf Wallets.
 */
function zahlerCluster(kaeufe) {
  const fremd = kaeufe.filter((k) => k.zahler && k.zahler !== k.wallet);
  const map = gruppen(fremd, (k) => k.zahler);
  const cluster = [];
  for (const [zahler, eintraege] of map.entries()) {
    const wallets = Array.from(new Set(eintraege.map((e) => e.wallet)));
    if (wallets.length < 2) continue;
    cluster.push({
      zahler: zahler,
      wallets: wallets,
      anzahl: wallets.length,
      tokens: eintraege.reduce((s, e) => s + e.tokens, 0),
    });
  }
  return cluster.sort((a, b) => b.anzahl - a.anzahl);
}

/**
 * Identische Einsaetze.
 *
 * Auf vier Nachkommastellen gerundet, weil genau das der Unterschied ist:
 * ein Skript setzt fuenfmal 0,4321 SOL, ein Mensch setzt 0,43 und dann
 * 0,5 und dann 0,25. Kleinstbetraege werden ausgelassen - unter 0,01 SOL
 * treffen sich Zufallswerte von allein.
 */
function betragCluster(kaeufe) {
  const echte = kaeufe.filter((k) => k.sol >= 0.01);
  const map = gruppen(echte, (k) => k.sol.toFixed(4));
  const cluster = [];
  for (const [betrag, eintraege] of map.entries()) {
    const wallets = Array.from(new Set(eintraege.map((e) => e.wallet)));
    if (wallets.length < 3) continue;
    cluster.push({ sol: Number(betrag), wallets: wallets, anzahl: wallets.length });
  }
  return cluster.sort((a, b) => b.anzahl - a.anzahl);
}

function anteil(tokens, supply) {
  if (!(supply > 0)) return null;
  return (tokens / supply) * 100;
}

/**
 * Das Urteil.
 *
 * Getrennt nach Beweislage: was im Erstell-Block steht, ist bewiesen. Was
 * in den ersten zwanzig Sekunden passiert, sind Sniper - laestig, aber
 * nicht zwingend derselbe Mensch. Beides wird deshalb getrennt gemeldet
 * und nicht zu einer Zahl verruehrt, die dann keiner mehr nachrechnen kann.
 */
function urteilen(d) {
  const gruende = [];
  let stufe = "sauber";

  const hoch = (s) => {
    const rang = { sauber: 0, auffaellig: 1, gebuendelt: 2 };
    if (rang[s] > rang[stufe]) stufe = s;
  };

  if (d.bundleAnteil != null && d.bundleAnteil >= ANTEIL_ALARM) {
    hoch("gebuendelt");
    gruende.push(
      d.bundleWallets + " Wallets haben im Erstell-Block " + d.bundleAnteil.toFixed(1) +
      "% des Vorrats genommen. Das ist kein Handel, das ist eine Aufstellung.",
    );
  } else if (d.bundleAnteil != null && d.bundleAnteil >= ANTEIL_WARNUNG) {
    hoch("auffaellig");
    gruende.push(
      d.bundleWallets + " Wallets im Erstell-Block mit " + d.bundleAnteil.toFixed(1) +
      "% des Vorrats. Auffaellig viel für Block eins.",
    );
  } else if (d.bundleWallets >= MIN_BUNDLE_WALLETS && d.bundleAnteil != null) {
    gruende.push(
      d.bundleWallets + " Wallets im Erstell-Block, zusammen aber nur " +
      d.bundleAnteil.toFixed(1) + "% - das kann man aushalten.",
    );
  } else if (d.bundleWallets === 0) {
    gruende.push("Kein Kauf im Erstell-Block. Der Start war offen.");
  }

  if (d.zahlerCluster.length) {
    const c = d.zahlerCluster[0];
    hoch(c.anzahl >= 4 ? "gebuendelt" : "auffaellig");
    gruende.push(
      "Eine Adresse hat die Gebuehr fuer " + c.anzahl +
      " verschiedene Wallets bezahlt. Diese Wallets gehoeren zusammen.",
    );
  }

  if (d.betragCluster.length) {
    const c = d.betragCluster[0];
    hoch("auffaellig");
    gruende.push(
      c.anzahl + " Wallets haben fuer exakt denselben Betrag gekauft (" +
      c.sol + " SOL). Das tippt kein Mensch.",
    );
  }

  if (d.devAnteil != null && d.devAnteil >= 5) {
    hoch(d.devAnteil >= 15 ? "gebuendelt" : "auffaellig");
    gruende.push(
      "Der Ersteller haelt selbst " + d.devAnteil.toFixed(1) +
      "% - er kann den Kurs allein umlegen.",
    );
  }

  if (d.bundleNochDrinAnteil != null && d.bundleNochDrinAnteil >= 8) {
    hoch(d.bundleNochDrinAnteil >= 20 ? "gebuendelt" : "auffaellig");
    gruende.push(
      "Von den Bundle-Wallets stehen heute noch " + d.bundleNochDrinAnteil.toFixed(1) +
      "% des Streubesitzes in den groessten Haltern. Die haengen dir ueber dem Kopf.",
    );
  } else if (d.bundleWallets > 0 && d.bundleNochDrin === 0 && d.holderGeprueft) {
    gruende.push("Die Bundle-Wallets stehen nicht mehr in den groessten Haltern - sie sind raus.");
  }

  if (d.sniperWallets >= 8 && stufe === "sauber") {
    stufe = "auffaellig";
    gruende.push(
      d.sniperWallets + " Wallets waren in den ersten " + SNIPER_SEKUNDEN +
      " Sekunden drin. Viele Bots, wenig Mensch.",
    );
  }

  return { stufe: stufe, gruende: gruende };
}

/**
 * Die Hauptfunktion.
 *
 * Gibt IMMER ein Objekt zurueck, nie einen Fehler nach oben. Ein Coin ohne
 * pruefbare Herkunft ist ein Coin mit unbekannter Herkunft - und das ist
 * eine Aussage, die die Oberflaeche anzeigen soll, statt leer zu bleiben.
 */
async function bundleAnalyse(mint) {
  const leer = {
    verfuegbar: false,
    grund: null,
    stufe: "unbekannt",
    gruende: [],
  };

  if (!hatSchluessel()) {
    leer.grund = "Kein Helius-Schluessel gesetzt - die Launch-Pruefung braucht ihn.";
    return leer;
  }

  return cached("bundle:analyse:" + mint, 12 * 60 * 60 * 1000, async () => {
    let txs = [];
    try {
      txs = await ersteTransaktionen(mint);
    } catch (err) {
      return Object.assign({}, leer, { grund: (err && err.message) || "Abfrage fehlgeschlagen." });
    }
    if (!txs.length) {
      return Object.assign({}, leer, { grund: "Keine Transaktionen gefunden." });
    }

    const erste = txs[0];
    const erstellSlot = typeof erste.slot === "number" ? erste.slot : null;
    const erstellZeit = typeof erste.timestamp === "number" ? erste.timestamp : null;
    const dev = erste.feePayer || null;

    let supply = null;
    try {
      const info = await getMintInfo(mint);
      supply = info && info.supply > 0 ? info.supply : null;
    } catch (err) {
      supply = null;
    }

    const kaeufe = kaeufeAus(txs, mint, supply);

    // Pro Wallet den ERSTEN Kauf - wer nachlegt, ist trotzdem eine Wallet.
    const erstkauf = new Map();
    for (const k of kaeufe) {
      if (!erstkauf.has(k.wallet)) erstkauf.set(k.wallet, k);
    }
    const ersteKaeufe = Array.from(erstkauf.values());

    const imBlock = ersteKaeufe.filter((k) => erstellSlot != null && k.slot === erstellSlot);
    const imFenster = ersteKaeufe.filter(
      (k) => erstellZeit != null && k.zeit != null && k.zeit - erstellZeit <= SNIPER_SEKUNDEN,
    );

    // Tokenmengen: fuer den Anteil zaehlen ALLE Kaeufe dieser Wallets im
    // Bundle-Block, nicht nur der erste - sonst rechnet man einen
    // Nachschlag im selben Block klein.
    const bundleWalletSet = new Set(imBlock.map((k) => k.wallet));
    let bundleTokens = 0;
    for (const k of kaeufe) {
      if (k.slot === erstellSlot && bundleWalletSet.has(k.wallet)) bundleTokens += k.tokens;
    }

    let devTokens = 0;
    for (const k of kaeufe) {
      if (dev && k.wallet === dev) devTokens += k.tokens;
    }

    // Halterverteilung: welche Bundle-Wallets stehen HEUTE noch oben?
    let holder = null;
    try {
      holder = await getHolderDistribution(mint);
    } catch (err) {
      holder = null;
    }

    let nochDrin = 0;
    let nochDrinAnteil = null;
    if (holder && Array.isArray(holder.holders) && holder.totalSupply > 0) {
      const verteilbar = holder.totalSupply * (1 - (holder.poolSharePct || 0) / 100);
      let menge = 0;
      for (const h of holder.holders) {
        if (h && bundleWalletSet.has(h.owner)) {
          nochDrin++;
          menge += h.amount || 0;
        }
      }
      if (verteilbar > 0) nochDrinAnteil = (menge / verteilbar) * 100;
    }

    const zCluster = zahlerCluster(ersteKaeufe);
    const bCluster = betragCluster(ersteKaeufe);

    const daten = {
      bundleWallets: imBlock.length,
      bundleAnteil: anteil(bundleTokens, supply),
      bundleSol: Math.round(imBlock.reduce((s, k) => s + k.sol, 0) * 1000) / 1000,
      sniperWallets: imFenster.length,
      devAnteil: dev ? anteil(devTokens, supply) : null,
      zahlerCluster: zCluster,
      betragCluster: bCluster,
      bundleNochDrin: nochDrin,
      bundleNochDrinAnteil: nochDrinAnteil,
      holderGeprueft: !!holder,
    };

    const urteil = urteilen(daten);

    return {
      verfuegbar: true,
      grund: null,
      mint: mint,
      dev: dev,
      erstellSlot: erstellSlot,
      erstellZeit: erstellZeit,
      supply: supply,
      transaktionen: txs.length,
      kaeuferGesamt: ersteKaeufe.length,

      bundleWallets: daten.bundleWallets,
      bundleAnteil: daten.bundleAnteil == null ? null : Math.round(daten.bundleAnteil * 10) / 10,
      bundleSol: daten.bundleSol,
      sniperWallets: daten.sniperWallets,
      devAnteil: daten.devAnteil == null ? null : Math.round(daten.devAnteil * 10) / 10,

      zahlerCluster: zCluster.slice(0, 5),
      betragCluster: bCluster.slice(0, 5),
      clusterWallets: zCluster.reduce((s, c) => s + c.anzahl, 0),

      bundleNochDrin: nochDrin,
      bundleNochDrinAnteil: nochDrinAnteil == null ? null : Math.round(nochDrinAnteil * 10) / 10,
      top10Pct: holder ? Math.round(holder.top10Pct * 10) / 10 : null,

      stufe: urteil.stufe,
      gruende: urteil.gruende,
    };
  });
}

module.exports = {
  bundleAnalyse,
  // fuer die Tests einzeln erreichbar
  kaeufeAus,
  poolAdressen,
  zahlerCluster,
  betragCluster,
  urteilen,
  hatSchluessel,
  SNIPER_SEKUNDEN,
  ANTEIL_WARNUNG,
  ANTEIL_ALARM,
};
