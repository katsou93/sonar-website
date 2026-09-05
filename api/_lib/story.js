"use strict";
/**
 * Die Story hinter dem Coin.
 *
 * Auf Axiom ist das der Teil, den man nicht messen kann und trotzdem
 * jedes Mal macht: Beschreibung lesen, auf den Twitter-Link klicken,
 * einschaetzen ob da ein Mensch dahintersteht oder ein Skript.
 *
 * Ganz ersetzen laesst sich das nicht - aber der groesste Teil der
 * Handarbeit ist mechanisch, und Mechanisches kann eine Maschine
 * uebernehmen. Vier Fragen sind es im Kern:
 *
 *   1. Gibt es ueberhaupt eine Beschreibung, oder steht da "the first
 *      dog coin on solana" wie bei den anderen dreitausend?
 *   2. Wohin zeigt der Twitter-Link WIRKLICH? Ein Link auf einen
 *      einzelnen Beitrag heisst: jemand hat etwas gepostet. Ein Link
 *      auf eine Suchseite heisst: es gibt nichts, und man tut so.
 *   3. Hat dieses X-Konto schon andere Coins begleitet? Ein
 *      wiederverwendeter Griff ist die haeufigste Recycling-Masche
 *      ueberhaupt.
 *   4. Trifft der Name das, was heute draussen wirklich besprochen wird?
 *
 * Nichts davon kostet Guthaben. Punkt 3 braucht ein Gedaechtnis, und das
 * fuehrt die Oberflaeche - hier wird nur geprueft, was uebergeben wird.
 */

const { getJson, cached } = require("./http");
const narrative = require("./narrative");

/**
 * Floskeln, die in jeder zweiten Beschreibung stehen und deshalb nichts
 * aussagen. Wer nur daraus besteht, hat keine Story, sondern eine
 * Vorlage ausgefuellt.
 */
const FLOSKELN = [
  "first", "community", "to the moon", "moon", "hodl", "diamond hands",
  "next 1000x", "1000x", "100x", "lfg", "wagmi", "gm", "just a", "no utility",
  "meme coin", "memecoin", "coin on solana", "on solana", "join us", "believe",
  "take over", "we are", "let's", "lets go", "dev is based", "cto",
];

/** Zu kurz, um irgendetwas zu erzaehlen. */
const MIN_LAENGE = 25;

/**
 * Einen X-/Twitter-Link einordnen.
 *
 * Die Unterscheidung, die zaehlt: ein Link auf einen EINZELNEN Beitrag
 * ist ein Beleg, dass ausserhalb dieses Coins etwas existiert. Alles
 * andere ist eine Behauptung.
 */
function twitterArt(url) {
  const roh = String(url || "").trim();
  if (!roh) return { art: "keiner", handle: null, text: "Kein X-Link hinterlegt." };

  let u;
  try {
    u = new URL(roh.indexOf("http") === 0 ? roh : "https://" + roh);
  } catch (err) {
    return { art: "kaputt", handle: null, text: "X-Link ist kein gueltiger Link." };
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "twitter.com" && host !== "x.com" && host !== "mobile.twitter.com") {
    return { art: "fremd", handle: null, text: "Der X-Link zeigt gar nicht zu X (" + host + ")." };
  }

  const pfad = u.pathname.replace(/^\/+|\/+$/g, "");
  const teile = pfad ? pfad.split("/") : [];

  if (!teile.length) {
    return { art: "leer", handle: null, text: "X-Link zeigt nur auf die Startseite." };
  }

  if (teile[0] === "search" || teile[0] === "hashtag" || teile[0] === "explore") {
    return {
      art: "suche",
      handle: null,
      text: "Der X-Link ist eine Suchseite, kein Konto. Das heisst: es gibt kein Konto.",
    };
  }

  // .../status/123... = ein konkreter Beitrag
  if (teile.length >= 3 && (teile[1] === "status" || teile[1] === "statuses")) {
    return {
      art: "beitrag",
      handle: teile[0],
      text: "Zeigt auf einen einzelnen Beitrag von @" + teile[0] + " - da hat jemand wirklich gepostet.",
    };
  }

  if (teile.length === 1) {
    return { art: "profil", handle: teile[0], text: "Zeigt auf das Profil @" + teile[0] + "." };
  }

  return { art: "profil", handle: teile[0], text: "Zeigt in den Bereich von @" + teile[0] + "." };
}

/**
 * Wie viel Substanz steckt in der Beschreibung?
 *
 * Nicht "ist sie gut" - das kann niemand messen. Sondern: bleibt nach
 * Abzug aller Floskeln noch Text uebrig, der etwas Eigenes sagt?
 */
function beschreibungPruefen(text) {
  const roh = String(text || "").trim();
  if (!roh) return { hat: false, laenge: 0, eigen: 0, floskeln: [], text: "Keine Beschreibung." };

  const klein = roh.toLowerCase();
  const gefunden = FLOSKELN.filter((f) => klein.indexOf(f) >= 0);

  let rest = klein;
  for (const f of gefunden) rest = rest.split(f).join(" ");
  const eigen = rest.replace(/[^a-z0-9äöüß ]+/g, " ").split(/\s+/).filter((w) => w.length > 2).length;

  let satz;
  if (roh.length < MIN_LAENGE) satz = "Beschreibung ist ein Halbsatz - da wurde nichts erzaehlt.";
  else if (eigen < 4) satz = "Beschreibung besteht praktisch nur aus Floskeln.";
  else if (gefunden.length >= 4) satz = "Viel Floskel, wenig Eigenes.";
  else satz = "Beschreibung sagt etwas Eigenes.";

  return { hat: true, laenge: roh.length, eigen: eigen, floskeln: gefunden.slice(0, 6), text: satz };
}

/**
 * Die Beschreibung eines pump.fun-Coins besorgen.
 *
 * Strikt optional: faellt die Quelle aus, ist die Beschreibung unbekannt,
 * und unbekannt wird als unbekannt angezeigt - nicht als "keine".
 * Der Unterschied ist wichtig, sonst bestraft die Bewertung einen Coin
 * fuer einen Ausfall auf unserer Seite.
 */
async function beschreibungHolen(mint) {
  return cached("story:desc:" + mint, 6 * 60 * 60 * 1000, async () => {
    const versuche = [
      "https://frontend-api-v3.pump.fun/coins/" + encodeURIComponent(mint),
      "https://frontend-api.pump.fun/coins/" + encodeURIComponent(mint),
    ];
    for (const url of versuche) {
      try {
        const d = await getJson(url, { source: "pumpfun", timeoutMs: 5000, retries: 0 });
        if (d && typeof d === "object") {
          return {
            ok: true,
            beschreibung: d.description || null,
            twitter: d.twitter || null,
            telegram: d.telegram || null,
            website: d.website || null,
            ersteller: d.creator || null,
            antwortenGesamt: typeof d.reply_count === "number" ? d.reply_count : null,
          };
        }
      } catch (err) {
        // naechste Quelle
      }
    }
    return { ok: false };
  });
}

/**
 * Der Abgleich mit dem, was draussen wirklich los ist.
 *
 * `tagesBegriffe` kommt aus der Heute-Seite: die Woerter, die in Google
 * Trends, News, Reddit und Wikipedia gerade oben stehen. Trifft der
 * Coin-Name einen davon, ist das der wertvollste Treffer, den dieses
 * Werkzeug erzeugen kann - dann laeuft er nicht auf einer Erfindung,
 * sondern auf etwas, wonach heute Menschen suchen.
 */
function themaTreffer(coin, tagesBegriffe) {
  const text = ((coin && coin.name) || "") + " " + ((coin && coin.symbol) || "");
  const woerter = new Set(
    text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3),
  );
  const treffer = [];
  for (const b of tagesBegriffe || []) {
    const wort = String((b && b.wort) || b || "").toLowerCase();
    if (!wort || wort.length < 3) continue;
    if (woerter.has(wort)) {
      treffer.push({ wort: wort, quellen: (b && b.quellen) || null, gewicht: (b && b.gewicht) || null });
    }
  }
  return treffer.sort((a, b) => (b.gewicht || 0) - (a.gewicht || 0)).slice(0, 4);
}

/**
 * Alles zusammen zu einem Urteil ueber die Erzaehlung.
 *
 * Bewusst getrennt vom Bundle-Urteil: ein Coin kann eine wunderbare
 * Geschichte haben und trotzdem zu 40% dem Ersteller gehoeren. Das sind
 * zwei verschiedene Fragen, und sie zu einer Zahl zu verruehren waere
 * genau die Blackbox, die dieses Werkzeug nicht sein soll.
 */
function storyUrteil(coin, extra, tagesBegriffe, handleHistorie) {
  const gruende = [];
  const e = extra || {};

  // Wie beim Bundle: die Oberflaeche zeigt EINEN Satz, und der muss der
  // sein, der das Urteil traegt. Live stand sonst eine gruene Ampel
  // neben "Beschreibung nicht abrufbar" - gruen war sie wegen des
  // verlinkten Beitrags, aber der Satz dazu war ein anderer.
  let kern = null;
  let kernGewicht = 0;
  const merke = (satz, gewicht) => {
    gruende.push(satz);
    if (Math.abs(gewicht) > kernGewicht) { kernGewicht = Math.abs(gewicht); kern = satz; }
  };

  const beschr = beschreibungPruefen(e.beschreibung);
  const tw = twitterArt((coin && coin.twitter) || e.twitter);
  const sektor = narrative.sectorOf ? narrative.sectorOf(coin) : null;
  const themen = themaTreffer(coin, tagesBegriffe);

  let punkte = 50;

  if (e.unbekannt) {
    merke("Beschreibung nicht abrufbar - dazu kann ich nichts sagen.", 0);
  } else if (!beschr.hat) {
    punkte -= 15;
    merke("Keine Beschreibung. Wer nichts erzaehlt, hat nichts zu erzaehlen.", 15);
  } else {
    const g = beschr.eigen >= 8 ? 15 : beschr.eigen >= 4 ? 6 : -10;
    punkte += g;
    merke(beschr.text, g);
  }

  if (tw.art === "beitrag") {
    punkte += 20;
    merke(tw.text, 20);
  } else if (tw.art === "profil") {
    punkte += 6;
    merke(tw.text + " Kein einzelner Beitrag verlinkt.", 6);
  } else if (tw.art === "suche") {
    punkte -= 20;
    merke(tw.text, 20);
  } else if (tw.art === "keiner") {
    punkte -= 10;
    merke(tw.text, 10);
  } else {
    punkte -= 15;
    merke(tw.text, 15);
  }

  // Wiederverwendeter Griff: das Gedaechtnis fuehrt die Oberflaeche,
  // hier wird nur ausgewertet, was sie mitgibt.
  const handle = tw.handle ? tw.handle.toLowerCase() : null;
  const frueher = handle && handleHistorie ? handleHistorie[handle] : null;
  let wiederverwendet = null;
  if (handle && frueher && frueher.coins && frueher.coins.length) {
    const andere = frueher.coins.filter((c) => c !== (coin && coin.address));
    if (andere.length) {
      wiederverwendet = andere.length;
      const ab = Math.min(25, 10 + andere.length * 5);
      punkte -= ab;
      merke(
        "Dasselbe X-Konto @" + handle + " hing schon an " + andere.length +
        " anderen Coins. Das ist ein Wiederholungstaeter.",
        ab,
      );
    }
  }

  if (themen.length) {
    punkte += 20;
    merke(
      "Trifft ein Thema, das heute draussen wirklich laeuft: " +
      themen.map((t) => t.wort).join(", ") + ".",
      21,
    );
  }

  if (sektor && sektor.key) {
    gruende.push("Ecke: " + (sektor.label || sektor.key) + ".");
  }

  punkte = Math.max(0, Math.min(100, punkte));
  const stufe = punkte >= 65 ? "stark" : punkte >= 40 ? "duenn" : "leer";

  const kernSatz = kern || gruende[0] || null;
  const rest = kernSatz ? gruende.filter((g) => g !== kernSatz) : gruende;

  return {
    punkte: punkte,
    stufe: stufe,
    kern: kernSatz,
    gruende: kernSatz ? [kernSatz].concat(rest) : gruende,
    beschreibung: e.beschreibung || null,
    beschreibungPruefung: beschr,
    twitter: tw,
    handleWiederverwendet: wiederverwendet,
    sektor: sektor,
    themen: themen,
  };
}

/**
 * Bequemlichkeitshuelle: Beschreibung holen und bewerten.
 */
async function storyCheck(coin, tagesBegriffe, handleHistorie) {
  let extra = { unbekannt: true };
  try {
    const d = await beschreibungHolen(coin && coin.address);
    if (d && d.ok) extra = { beschreibung: d.beschreibung, twitter: d.twitter, unbekannt: false };
  } catch (err) {
    extra = { unbekannt: true };
  }
  return storyUrteil(coin, extra, tagesBegriffe, handleHistorie);
}

module.exports = {
  storyCheck,
  storyUrteil,
  twitterArt,
  beschreibungPruefen,
  themaTreffer,
  beschreibungHolen,
  FLOSKELN,
  MIN_LAENGE,
};
