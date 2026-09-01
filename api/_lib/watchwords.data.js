"use strict";
/**
 * Die Stichwortliste der Wache.
 *
 * Das hier ist die Datei, die ihr selbst pflegt. Jedes Wort in
 * Anfuehrungszeichen, mit Komma dahinter. Kleinschreibung, keine
 * Sonderzeichen, mindestens drei Buchstaben.
 *
 * Faustregeln, damit die Liste nuetzlich bleibt:
 *
 *   - Nimm nur Worte, die JETZT in der Welt passieren. Eine Liste mit
 *     dreissig alten Begriffen meldet nur noch Nachzuegler-Muell.
 *   - Worte unter fuenf Buchstaben muessen als ganzes Wort im Namen
 *     stehen. Ab fuenf Buchstaben reicht ein Treffer mitten im Namen -
 *     "raccoon" findet also auch "JimothyRaccoonCoin".
 *   - Raus damit, sobald das Thema durch ist. Ein Wort, das seit einer
 *     Woche nur Stufe 1 liefert, ist tot.
 *
 * Zusaetzlich koennt ihr in Vercel die Variable SONAR_WATCHWORDS setzen
 * (kommagetrennt) - die wird dazugemischt, ohne dass ihr Code anfasst.
 *
 * Stand: 1. September 2026
 */

module.exports = {
  updated: "2026-09-01",
  words: [
    // Laufende virale Themen
    "raccoon", // Jimothy, der Waschbaer aus Seattle - gerade in der US-Berichterstattung
    "jimothy",
    "penguin", // der "nihilistische Pinguin" laeuft seit Januar 2026

    // Makro und Nachrichtenlage
    "hormuz", // Strasse von Hormuz, Oelpreis, US-Militaer
    "powell", // Fed-Sitzung am 16. September
    "tariff",

    // Dauerbrenner, die bei jeder Marktbewegung neu auftauchen
    "uptober",
    "oktoberfest",
  ],
};
