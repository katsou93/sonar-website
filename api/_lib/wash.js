"use strict";
/**
 * Gemachte Charts erkennen.
 *
 * Das ist die Masche, die du am Chart mit blossem Auge siehst und die
 * jedes Zahlenwerk bisher uebersehen hat: jemand handelt seinen eigenen
 * Coin mit sich selbst. Kauf, Verkauf, Kauf, Verkauf, zwischen ein paar
 * Wallets, die ihm alle gehoeren. Es entsteht eine schoene gruene Kerze
 * nach der anderen, das Volumen sieht gewaltig aus, der Coin taucht in
 * jeder "meistgehandelt"-Liste auf - und in Wahrheit ist nie ein
 * fremder Mensch eingestiegen. Der ganze Aufwand hat genau einen Zweck:
 * Aufmerksamkeit zu kaufen, damit jemand wie du kauft. Dann wird in
 * deinen Kaufdruck hinein verkauft.
 *
 * Der Fehler, den man dabei nicht machen darf, ist, das an EINER Zahl
 * festzumachen. Deshalb drei unabhaengige Spuren, von denen zwei nichts
 * kosten:
 *
 *   1. Handel pro Kopf (gratis)
 *      800 Trades von 12 Haendlern heisst: jeder hat 66 mal gehandelt.
 *      Menschen tun das nicht. Diese Zahl liegt bei Jupiter offen da
 *      und wird von fast niemandem angesehen.
 *
 *   2. Umsatz ohne Halter (gratis)
 *      Echte Nachfrage hinterlaesst Spuren: neue Halter. Grosser
 *      Umsatz bei stehender oder fallender Halterzahl heisst, das Geld
 *      dreht sich im Kreis, statt hereinzukommen.
 *
 *   3. Rundlaeufer (kostet einen Aufruf)
 *      Wer denselben Coin mehrfach kauft UND verkauft, handelt nicht,
 *      er stellt her. Aus den Transaktionen laesst sich das direkt
 *      ablesen, inklusive des Anteils am Gesamtumsatz.
 *
 * Wichtig fuer die Ehrlichkeit der Anzeige: Punkt 1 und 2 sind
 * Hinweise. Sie koennen bei einem echten, wilden Coin auch mal
 * ausschlagen. Punkt 3 ist ein Beweis - eine Wallet, die zwoelfmal
 * hin und her gehandelt hat, hat zwoelfmal hin und her gehandelt.
 */

/** Ab so vielen Trades pro Haendler ist es keine Menschenmenge mehr. */
const PRO_KOPF_VERDACHT = 8;
const PRO_KOPF_ALARM = 20;

/** Ab so vielen Kauf-Verkauf-Wechseln in EINEM Coin ist es Herstellung. */
const RUNDLAUF_MIN = 3;

/**
 * Die freie Ebene: was Jupiter ohnehin mitliefert.
 *
 * `c` ist ein normalisierter Coin. Zurueck kommt eine Liste von
 * Befunden, die die Checkliste direkt anzeigen kann.
 */
function washFrei(c) {
  const coin = c || {};
  const befunde = [];

  const trades = (coin.buysH1 || 0) + (coin.sellsH1 || 0);
  const haendler = coin.tradersH1 || 0;

  if (trades >= 40 && haendler >= 2) {
    const proKopf = trades / haendler;
    if (proKopf >= PRO_KOPF_ALARM) {
      befunde.push({
        art: "prokopf",
        stufe: "schlecht",
        wert: Math.round(proKopf),
        text: trades + " Trades von nur " + haendler + " Haendlern - das sind " + Math.round(proKopf) +
          " pro Kopf. So handelt kein Mensch. Der Chart wird hergestellt.",
      });
    } else if (proKopf >= PRO_KOPF_VERDACHT) {
      befunde.push({
        art: "prokopf",
        stufe: "mittel",
        wert: Math.round(proKopf),
        text: trades + " Trades von " + haendler + " Haendlern - " + Math.round(proKopf) +
          " pro Kopf. Viel fuer echtes Interesse.",
      });
    }
  }

  // Umsatz, der keine Halter hinterlaesst.
  const umsatz = coin.volumeH1 || 0;
  const halterPlus = coin.holderChangeH1;
  const mcap = coin.marketCap || 0;
  if (umsatz >= 15000 && mcap > 0 && umsatz > mcap * 0.5 && halterPlus != null && halterPlus <= 2) {
    befunde.push({
      art: "ohnehalter",
      stufe: "schlecht",
      wert: Math.round(halterPlus),
      text: "In einer Stunde wurde mehr als der halbe Marktwert umgesetzt, und die Halterzahl steht still (" +
        Math.round(halterPlus) + "%). Das Geld dreht sich im Kreis, es kommt keins herein.",
    });
  }

  // Der organische Anteil ist bereits eine eigene Zeile in der
  // Checkliste - hier nur noch der Extremfall, der zusammen mit den
  // anderen Befunden das Bild schliesst.
  if (coin.organicShareH1 != null && coin.organicShareH1 < 0.15 &&
      umsatz >= 20000 && (coin.ageMinutes == null || coin.ageMinutes >= 60)) {
    befunde.push({
      art: "organisch",
      stufe: "schlecht",
      wert: Math.round(coin.organicShareH1 * 100),
      text: "Bei " + Math.round(umsatz / 1000) + "k Umsatz sind nur " +
        Math.round(coin.organicShareH1 * 100) + "% davon echt.",
    });
  }

  const schlimm = befunde.filter((b) => b.stufe === "schlecht").length;
  return {
    befunde: befunde,
    stufe: schlimm >= 2 ? "gemacht" : schlimm === 1 ? "verdaechtig" : befunde.length ? "auffaellig" : "unauffaellig",
  };
}

/**
 * Die tiefe Ebene: Rundlaeufer aus den Transaktionen.
 *
 * `kaeufe` ist die Liste aus kaeufer.frischeKaeufe - Eintraege mit
 * wallet, seite ("kauf"/"verkauf") und sol.
 *
 * Gezaehlt wird nicht "hat gekauft und verkauft" - das macht jeder, der
 * eine Position schliesst - sondern die WECHSEL: Kauf, Verkauf, Kauf,
 * Verkauf. Wer das dreimal macht, schliesst keine Position, der
 * erzeugt Bewegung.
 */
function rundlaeufer(kaeufe) {
  const proWallet = new Map();
  // Die Liste kommt neueste zuerst - fuer die Reihenfolge der Wechsel
  // muss sie chronologisch sein.
  const chronologisch = (kaeufe || []).slice().sort((a, b) => (a.zeit || 0) - (b.zeit || 0));

  for (const k of chronologisch) {
    if (!k || !k.wallet || (k.seite !== "kauf" && k.seite !== "verkauf")) continue;
    const w = proWallet.get(k.wallet) || { wallet: k.wallet, letzte: null, wechsel: 0, kauf: 0, verkauf: 0, sol: 0 };
    if (w.letzte && w.letzte !== k.seite) w.wechsel++;
    w.letzte = k.seite;
    if (k.seite === "kauf") w.kauf++; else w.verkauf++;
    w.sol += k.sol || 0;
    proWallet.set(k.wallet, w);
  }

  const alle = Array.from(proWallet.values());
  const gesamtSol = alle.reduce((s, w) => s + w.sol, 0);
  const dreher = alle.filter((w) => w.wechsel >= RUNDLAUF_MIN).sort((a, b) => b.wechsel - a.wechsel);
  const dreherSol = dreher.reduce((s, w) => s + w.sol, 0);

  return {
    wallets: dreher.slice(0, 8).map((w) => ({
      wallet: w.wallet,
      wechsel: w.wechsel,
      kauf: w.kauf,
      verkauf: w.verkauf,
      sol: Math.round(w.sol * 100) / 100,
    })),
    anzahl: dreher.length,
    anteilProzent: gesamtSol > 0 ? Math.round((dreherSol / gesamtSol) * 1000) / 10 : null,
    haendlerGesamt: alle.length,
  };
}

/**
 * Freie und tiefe Ebene zu einem Urteil.
 */
function washUrteil(frei, tief) {
  const gruende = [];
  let stufe = (frei && frei.stufe) || "unauffaellig";

  for (const b of (frei && frei.befunde) || []) gruende.push({ text: b.text, beweis: false, stufe: b.stufe });

  if (tief && tief.anzahl > 0) {
    const anteil = tief.anteilProzent;
    if (tief.anzahl >= 3 || (anteil != null && anteil >= 40)) {
      stufe = "gemacht";
      gruende.unshift({
        stufe: "schlecht",
        beweis: true,
        text: tief.anzahl + " Wallets haben in diesem Coin mehrfach hin und her gehandelt" +
          (anteil != null ? " und machen " + anteil + "% des Umsatzes aus" : "") +
          ". Das ist kein Handel, das ist Herstellung.",
      });
    } else {
      if (stufe === "unauffaellig") stufe = "auffaellig";
      gruende.unshift({
        stufe: "mittel",
        beweis: true,
        text: tief.anzahl + " Wallet" + (tief.anzahl === 1 ? " hat" : "s haben") +
          " mehrfach hin und her gehandelt. Wenig, aber es faellt auf.",
      });
    }
  } else if (tief && tief.haendlerGesamt > 0) {
    gruende.push({
      stufe: "gut",
      beweis: true,
      text: "Keine Wallet handelt hier mit sich selbst - die Bewegung ist echt.",
    });
    if (stufe === "unauffaellig") stufe = "sauber";
  }

  return { stufe: stufe, gruende: gruende };
}

module.exports = {
  washFrei,
  rundlaeufer,
  washUrteil,
  PRO_KOPF_VERDACHT,
  PRO_KOPF_ALARM,
  RUNDLAUF_MIN,
};
