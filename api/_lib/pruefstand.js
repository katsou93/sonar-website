"use strict";
/**
 * Der Pruefstand.
 *
 * Das hier ersetzt die Handarbeit auf Axiom: einen frischen Coin
 * durchgehen und entscheiden, ob er glaubwuerdig ist. Es ist bewusst
 * KEIN Score mit einer Zahl, sondern eine Checkliste - dieselbe Reihe
 * von Fragen, jedes Mal, in derselben Reihenfolge, mit den konkreten
 * Zahlen daneben. Genau das, was ein Mensch nach dem dreissigsten Coin
 * nicht mehr diszipliniert durchhaelt und eine Maschine schon.
 *
 * Zwei Ebenen, aus einem harten Grund: Guthaben.
 *
 *   FREI   Alles, was Jupiter ohnehin mitliefert. Kostet nichts, laeuft
 *          fuer jeden Coin in der Liste. Sortiert die dreihundert
 *          Kandidaten auf zehn herunter.
 *   TIEF   Launch-Forensik (Bundle) und Story. Kostet Guthaben, laeuft
 *          nur fuer die zehn - und wird zwoelf Stunden gehalten, weil
 *          sich die Vergangenheit eines Coins nicht mehr aendert.
 *
 * Die freie Ebene darf niemals so tun, als koenne sie ein Bundle
 * beweisen. Sie kann nur sagen "sieht danach aus, sieh nach". Deshalb
 * ist jeder Punkt hier mit "Hinweis" oder "Beweis" gekennzeichnet.
 */

const ZIEL_FAKTOR = 5;

/**
 * Das Fenster, in dem diese Coins tatsaechlich sterben.
 *
 * Nicht ausgedacht, sondern deine eigene Beobachtung ueber mehrere Tage:
 * sie laufen auf 70k, 100k, 200k, manchmal 400k - und kommen dann
 * zurueck. Daraus folgt eine unbequeme, aber sehr nuetzliche Rechnung:
 * der Einstiegs-Marktwert entscheidet mechanisch, welches Vielfache
 * ueberhaupt noch drin ist. Bei 300k Einstieg ist ein Fuenffacher nicht
 * unwahrscheinlich, sondern rechnerisch fast ausgeschlossen - dafuer
 * muesste der Coin auf 1,5 Millionen, und das tut in diesem Fenster
 * praktisch keiner.
 */
const GIPFEL_UNTEN = 70000;
const GIPFEL_TYPISCH = 180000;
const GIPFEL_OBEN = 400000;

const geld = (n) =>
  n == null
    ? "unbekannt"
    : n >= 1e6
      ? "$" + (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? "$" + Math.round(n / 100) / 10 + "k"
        : "$" + Math.round(n);

/**
 * Eine Zeile der Checkliste.
 * stufe: "gut" | "mittel" | "schlecht" | "unbekannt"
 * beweis: true  = das ist auf der Kette nachweisbar
 *         false = das ist ein Hinweis, der auch taeuschen kann
 */
function zeile(schluessel, label, stufe, text, punkte, beweis) {
  return {
    schluessel: schluessel,
    label: label,
    stufe: stufe,
    text: text,
    punkte: punkte || 0,
    beweis: !!beweis,
  };
}

/**
 * Wie viel Platz ist von hier bis in das Fenster, in dem diese Coins
 * ihren Gipfel machen?
 */
function platzNachOben(mcap) {
  if (!(mcap > 0)) return null;
  return {
    bisUnten: GIPFEL_UNTEN / mcap,
    bisTypisch: GIPFEL_TYPISCH / mcap,
    bisOben: GIPFEL_OBEN / mcap,
  };
}

function checkPlatz(c) {
  const p = platzNachOben(c.marketCap);
  if (!p) return zeile("platz", "Platz nach oben", "unbekannt", "Marktwert unbekannt.", -5, false);

  const x = p.bisTypisch;
  if (x >= ZIEL_FAKTOR * 1.5) {
    return zeile(
      "platz", "Platz nach oben", "gut",
      "Bei " + geld(c.marketCap) + " Einstieg sind bis zum ueblichen Gipfel (" + geld(GIPFEL_TYPISCH) +
      ") noch " + x.toFixed(1) + "x drin. Dein Fuenffacher passt locker rein.",
      18, true,
    );
  }
  if (x >= ZIEL_FAKTOR) {
    return zeile(
      "platz", "Platz nach oben", "gut",
      "Bei " + geld(c.marketCap) + " sind bis " + geld(GIPFEL_TYPISCH) + " noch " + x.toFixed(1) +
      "x drin. Genau dein Ziel, ohne Puffer.",
      10, true,
    );
  }
  if (x >= 2.5) {
    return zeile(
      "platz", "Platz nach oben", "mittel",
      "Bei " + geld(c.marketCap) + " sind bis zum ueblichen Gipfel nur noch " + x.toFixed(1) +
      "x. Fuer 5x muesste er ueber " + geld(c.marketCap * ZIEL_FAKTOR) + " - das schafft kaum einer.",
      -8, true,
    );
  }
  return zeile(
    "platz", "Platz nach oben", "schlecht",
    "Bei " + geld(c.marketCap) + " ist der uebliche Gipfel schon erreicht oder ueberschritten. " +
    "Fuer 5x muesste er auf " + geld(c.marketCap * ZIEL_FAKTOR) + ". Du waerst der Ausgang, nicht der Gewinner.",
    -25, true,
  );
}

function checkAusstieg(c) {
  const liq = c.liquidityUsd;
  if (liq == null) return zeile("ausstieg", "Ausstieg", "unbekannt", "Liquiditaet unbekannt.", -5, false);
  if (liq < 5000) {
    return zeile(
      "ausstieg", "Ausstieg", "schlecht",
      "Nur " + geld(liq) + " im Pool. Da kommst du mit 25 Euro nur raus, wenn zufaellig jemand kauft.",
      -22, true,
    );
  }
  if (liq < 15000) {
    return zeile(
      "ausstieg", "Ausstieg", "mittel",
      geld(liq) + " im Pool. Fuer deine Groesse reicht das, aber viel duenner darf es nicht werden.",
      -4, true,
    );
  }
  return zeile("ausstieg", "Ausstieg", "gut", geld(liq) + " im Pool - da kommst du jederzeit raus.", 8, true);
}

function checkEcht(c) {
  const s = c.organicShareH1;
  if (s == null) {
    return zeile("echt", "Echtes Volumen", "unbekannt", "Kein Umsatz in der letzten Stunde messbar.", -5, false);
  }
  const p = Math.round(s * 100);
  if (s >= 0.6) {
    return zeile("echt", "Echtes Volumen", "gut", p + "% des Umsatzes ist echt, nicht Bot-Karussell.", 15, false);
  }
  if (s >= 0.3) {
    return zeile("echt", "Echtes Volumen", "mittel", "Nur " + p + "% des Umsatzes ist echt. Der Rest sind Bots, die sich gegenseitig handeln.", -6, false);
  }
  return zeile(
    "echt", "Echtes Volumen", "schlecht",
    "Nur " + p + "% echt. Der Chart zeigt Nachfrage, die es nicht gibt - dieser Coin sucht einen Abnehmer.",
    -20, false,
  );
}

function checkFluss(c) {
  const kauf = c.buysH1 || 0;
  const verk = c.sellsH1 || 0;
  const netto = c.netBuyersH1;

  if (!kauf && !verk) {
    return zeile("fluss", "Kaeufe gegen Verkaeufe", "unbekannt", "Keine Trades in der letzten Stunde.", -8, false);
  }
  const v = verk > 0 ? kauf / verk : 99;

  if (netto != null && netto <= 0) {
    return zeile(
      "fluss", "Kaeufe gegen Verkaeufe", "schlecht",
      kauf + " Kaeufe gegen " + verk + " Verkaeufe, aber unterm Strich " + netto +
      " Netto-Kaeufer. Es steigen mehr Leute aus als ein.",
      -18, false,
    );
  }
  if (v >= 1.5) {
    return zeile(
      "fluss", "Kaeufe gegen Verkaeufe", "gut",
      kauf + " Kaeufe gegen " + verk + " Verkaeufe" + (netto != null ? ", " + netto + " Netto-Kaeufer" : "") + ".",
      12, false,
    );
  }
  if (v >= 0.9) {
    return zeile("fluss", "Kaeufe gegen Verkaeufe", "mittel", kauf + " Kaeufe, " + verk + " Verkaeufe - ausgeglichen, kein Zug drin.", -2, false);
  }
  return zeile(
    "fluss", "Kaeufe gegen Verkaeufe", "schlecht",
    "Mehr Verkaeufe (" + verk + ") als Kaeufe (" + kauf + "). Der Ausstieg laeuft bereits.",
    -15, false,
  );
}

function checkHalter(c) {
  const n = c.holderCount;
  const dazu = c.holderChangeH1;
  if (n == null) return zeile("halter", "Halter", "unbekannt", "Halterzahl unbekannt.", -3, false);
  if (n < 25) {
    return zeile("halter", "Halter", "schlecht", "Nur " + n + " Halter. Das ist noch niemand.", -12, false);
  }
  if (dazu != null && dazu <= 0) {
    return zeile("halter", "Halter", "mittel", n + " Halter, aber in der letzten Stunde kein Zuwachs (" + dazu + ").", -6, false);
  }
  if (dazu != null && dazu >= 20) {
    return zeile("halter", "Halter", "gut", n + " Halter, +" + dazu + " in der letzten Stunde. Da kommt gerade wer dazu.", 14, false);
  }
  return zeile("halter", "Halter", "gut", n + " Halter" + (dazu != null ? ", +" + dazu + " in der letzten Stunde" : "") + ".", 6, false);
}

/**
 * Der Hinweis auf ein Bundle, den es GRATIS gibt.
 *
 * Ausdruecklich nur ein Hinweis: Jupiter meldet den Anteil der groessten
 * Halter, und ob das gebuendelte Wallets sind oder ein einzelner grosser
 * Kaeufer, steht da nicht drin. Deshalb loest ein hoher Wert hier keine
 * Verurteilung aus, sondern eine Aufforderung: tief pruefen.
 */
function checkVerteilung(c) {
  const p = c.topHoldersPct;
  if (p == null) {
    return zeile("verteilung", "Verteilung (Hinweis)", "unbekannt", "Verteilung nicht abrufbar - tief pruefen.", -4, false);
  }
  if (p >= 40) {
    return zeile(
      "verteilung", "Verteilung (Hinweis)", "schlecht",
      "Die groessten Halter haben " + p.toFixed(0) + "%. Riecht stark nach Bundle - tief pruefen.",
      -20, false,
    );
  }
  if (p >= 22) {
    return zeile(
      "verteilung", "Verteilung (Hinweis)", "mittel",
      "Die groessten Halter haben " + p.toFixed(0) + "%. Grenzwertig - tief pruefen.",
      -8, false,
    );
  }
  return zeile("verteilung", "Verteilung (Hinweis)", "gut", "Groesste Halter zusammen " + p.toFixed(0) + "% - gut gestreut.", 10, false);
}

/**
 * Die Vorgeschichte des Erstellers.
 *
 * Das ist eine der wenigen Zahlen, die Jupiter gratis mitliefert und die
 * fast niemand ansieht: wie viele Coins hat dieser Mensch schon gestartet,
 * und wie viele davon haben es je ueber die Kurve geschafft? Vierzig
 * Starts, null Graduierungen ist kein Pech. Das ist ein Geschaeftsmodell.
 */
function checkDev(c) {
  const starts = c.devMints;
  const durch = c.devMigrations;
  if (starts == null) return zeile("dev", "Ersteller", "unbekannt", "Zur Vorgeschichte des Erstellers ist nichts bekannt.", 0, false);

  if (starts >= 10 && (durch || 0) === 0) {
    return zeile(
      "dev", "Ersteller", "schlecht",
      "Hat schon " + starts + " Coins gestartet, davon hat es KEINER ueber die Kurve geschafft. Das ist Serienbetrieb.",
      -25, true,
    );
  }
  if (starts >= 5 && (durch || 0) === 0) {
    return zeile("dev", "Ersteller", "mittel", starts + " Starts, keiner davon durchgekommen.", -12, true);
  }
  if ((durch || 0) >= 2) {
    return zeile("dev", "Ersteller", "gut", starts + " Starts, " + durch + " davon durch die Kurve. Der kann es.", 12, true);
  }
  if (starts <= 2) {
    return zeile("dev", "Ersteller", "gut", starts === 1 ? "Erster Coin dieses Erstellers." : starts + " Coins bisher.", 5, true);
  }
  return zeile("dev", "Ersteller", "mittel", starts + " Starts, " + (durch || 0) + " durchgekommen.", 0, true);
}

function checkRechte(c) {
  const m = c.mintAuthorityActive;
  const f = c.freezeAuthorityActive;
  if (m === true || f === true) {
    const was = [];
    if (m === true) was.push("kann beliebig nachdrucken");
    if (f === true) was.push("kann deine Wallet einfrieren");
    return zeile("rechte", "Vertragsrechte", "schlecht", "Der Ersteller " + was.join(" und ") + ". Finger weg.", -40, true);
  }
  if (m === false && f === false) {
    return zeile("rechte", "Vertragsrechte", "gut", "Nachdrucken und Einfrieren sind abgegeben.", 8, true);
  }
  return zeile("rechte", "Vertragsrechte", "unbekannt", "Vertragsrechte nicht abrufbar.", -6, false);
}

function checkSocials(c) {
  const hat = [];
  if (c.twitter) hat.push("X");
  if (c.telegram) hat.push("Telegram");
  if (c.website) hat.push("Website");
  if (!hat.length) {
    return zeile("socials", "Aussenauftritt", "schlecht", "Kein X, kein Telegram, keine Website. Da will niemand gefunden werden.", -14, false);
  }
  if (hat.length === 1) {
    return zeile("socials", "Aussenauftritt", "mittel", "Nur " + hat[0] + " hinterlegt.", 2, false);
  }
  return zeile("socials", "Aussenauftritt", "gut", hat.join(", ") + " hinterlegt.", 8, false);
}

function checkAlter(c) {
  const a = c.ageMinutes;
  if (a == null) return zeile("alter", "Alter", "unbekannt", "Alter unbekannt.", 0, false);
  if (a < 5) {
    return zeile("alter", "Alter", "mittel", a + " Minuten alt. Zu frisch, um irgendetwas zu wissen - hier kaufen nur Bots.", -6, true);
  }
  if (a < 90) {
    return zeile("alter", "Alter", "gut", a + " Minuten alt. Das Fenster, in dem noch Platz ist.", 10, true);
  }
  if (a < 24 * 60) {
    return zeile("alter", "Alter", "mittel", Math.round(a / 60) + " Stunden alt. Die erste Welle ist durch.", 0, true);
  }
  return zeile("alter", "Alter", "mittel", Math.round(a / 1440) + " Tage alt. Kein Launch mehr, ein Bestand.", -4, true);
}

const AMPEL_GRUEN = 62;
const AMPEL_GELB = 42;

function ampelVon(punkte, fatal) {
  if (fatal) return "rot";
  if (punkte >= AMPEL_GRUEN) return "gruen";
  if (punkte >= AMPEL_GELB) return "gelb";
  return "rot";
}

/**
 * Die freie Ebene: kostet nichts, laeuft fuer jeden Coin.
 */
function freiesUrteil(coin) {
  const c = coin || {};
  const checks = [
    checkPlatz(c),
    checkAusstieg(c),
    checkVerteilung(c),
    checkEcht(c),
    checkFluss(c),
    checkHalter(c),
    checkDev(c),
    checkRechte(c),
    checkSocials(c),
    checkAlter(c),
  ];

  let punkte = 50;
  for (const z of checks) punkte += z.punkte;
  punkte = Math.max(0, Math.min(100, Math.round(punkte)));

  const fatal = checks.some((z) => z.schluessel === "rechte" && z.stufe === "schlecht");
  const schlechte = checks.filter((z) => z.stufe === "schlecht");
  const offen = checks.filter((z) => z.stufe === "unbekannt");

  return {
    punkte: punkte,
    ampel: ampelVon(punkte, fatal),
    checks: checks,
    schlecht: schlechte.length,
    offen: offen.length,
    // Was die Tiefpruefung klaeren wuerde. Das ist die Begruendung, die
    // die Oberflaeche neben den Knopf schreibt.
    tiefLohntSich:
      !fatal &&
      punkte >= AMPEL_GELB &&
      (c.topHoldersPct == null || c.topHoldersPct >= 15 || (c.ageMinutes != null && c.ageMinutes < 24 * 60)),
  };
}

/**
 * Freie Ebene, Bundle und Story zu einem Urteil zusammenfuehren.
 *
 * Die Regel dahinter: ein BEWIESENES Bundle sticht jede gute Zahl. Kein
 * Volumen, keine Halterzahl und keine schoene Geschichte macht wett, dass
 * dreissig Prozent des Vorrats seit Block eins einer Person gehoeren.
 */
function gesamtUrteil(frei, bundle, story) {
  const f = frei || { punkte: 50, checks: [] };
  let punkte = f.punkte;
  const zusatz = [];

  if (bundle && bundle.verfuegbar) {
    if (bundle.stufe === "gebuendelt") {
      punkte -= 35;
      zusatz.push(zeile("bundle", "Launch-Pruefung", "schlecht", bundle.gruende[0] || "Gebuendelter Start.", -35, true));
    } else if (bundle.stufe === "auffaellig") {
      punkte -= 15;
      zusatz.push(zeile("bundle", "Launch-Pruefung", "mittel", bundle.gruende[0] || "Auffaelliger Start.", -15, true));
    } else {
      punkte += 18;
      zusatz.push(zeile("bundle", "Launch-Pruefung", "gut", bundle.gruende[0] || "Start war offen.", 18, true));
    }
  } else {
    zusatz.push(zeile("bundle", "Launch-Pruefung", "unbekannt", (bundle && bundle.grund) || "Noch nicht geprueft.", 0, false));
  }

  if (story && typeof story.punkte === "number") {
    if (story.stufe === "stark") {
      punkte += 12;
      zusatz.push(zeile("story", "Story", "gut", story.gruende[0] || "Erzaehlung traegt.", 12, false));
    } else if (story.stufe === "duenn") {
      zusatz.push(zeile("story", "Story", "mittel", story.gruende[0] || "Erzaehlung duenn.", 0, false));
    } else {
      punkte -= 12;
      zusatz.push(zeile("story", "Story", "schlecht", story.gruende[0] || "Keine Erzaehlung.", -12, false));
    }
  }

  punkte = Math.max(0, Math.min(100, Math.round(punkte)));
  const fatal =
    f.ampel === "rot" && f.checks.some((z) => z.schluessel === "rechte" && z.stufe === "schlecht");
  const gebuendelt = !!(bundle && bundle.verfuegbar && bundle.stufe === "gebuendelt");

  return {
    punkte: punkte,
    ampel: gebuendelt ? "rot" : ampelVon(punkte, fatal),
    checks: f.checks.concat(zusatz),
    tief: true,
    gebuendelt: gebuendelt,
  };
}

module.exports = {
  freiesUrteil,
  gesamtUrteil,
  platzNachOben,
  zeile,
  ZIEL_FAKTOR,
  GIPFEL_UNTEN,
  GIPFEL_TYPISCH,
  GIPFEL_OBEN,
  AMPEL_GRUEN,
  AMPEL_GELB,
};
