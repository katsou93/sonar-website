"use strict";
/**
 * GET /api/tief?mint=<adresse>&begriffe=wort,wort,...
 *
 * Die Tiefpruefung eines einzelnen Coins - das, wofuer du auf Axiom
 * bisher selbst auf die Blasenkarte und den Twitter-Link geklickt hast.
 *
 * Was hier passiert und sonst nirgends:
 *
 *   1. Die ersten hundert Transaktionen des Coins werden gelesen und
 *      daraus rekonstruiert, wem er im Erstell-Block gehoert hat.
 *   2. Die heutigen groessten Halter werden dagegen gehalten: wie viel
 *      von damals liegt noch da oben?
 *   3. Beschreibung und X-Link werden eingeordnet.
 *
 * Kosten: rund 115 Guthaben pro Coin, EINMAL. Die Vergangenheit eines
 * Coins aendert sich nicht mehr, deshalb liegt das Ergebnis danach
 * zwoelf Stunden im Cache. Bei 1 Million Freiguthaben im Monat sind das
 * rund 8.000 Tiefpruefungen - deutlich mehr, als ein Mensch je anschaut.
 *
 * `begriffe` sind die Tagesbegriffe aus der Heute-Seite. Die Oberflaeche
 * hat sie ohnehin, und so kostet der Abgleich keine zusaetzliche
 * Abfrage.
 */

const jup = require("./_lib/jupiter");
const { bundleAnalyse } = require("./_lib/bundle");
const { storyCheck } = require("./_lib/story");
const { freiesUrteil, gesamtUrteil } = require("./_lib/pruefstand");
const { send, fail, authorized, preflight } = require("./_lib/respond");

function begriffeAus(roh) {
  const out = [];
  for (const teil of String(roh || "").split(",")) {
    const w = teil.trim().toLowerCase();
    if (w.length >= 3 && w.length <= 40 && /^[a-z0-9äöüß' -]+$/.test(w)) out.push({ wort: w });
    if (out.length >= 40) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  const mint = String(q.mint || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return fail(res, 400, "Parameter 'mint' fehlt oder ist keine gültige Adresse.", "BAD_INPUT");
  }
  const begriffe = begriffeAus(q.begriffe);

  // Der Coin selbst - fuer die freie Ebene, damit die Tiefpruefung ein
  // vollstaendiges Urteil zurueckgeben kann und nicht nur ein Fragment.
  let coin = null;
  try {
    coin = await jup.byMint(mint);
  } catch (err) {
    coin = null;
  }
  const normal = coin ? jup.normalize(coin, null) : null;

  // Beide Seiten parallel, jede darf einzeln ausfallen.
  const [bRes, sRes] = await Promise.allSettled([
    bundleAnalyse(mint),
    storyCheck(normal || { address: mint }, begriffe, null),
  ]);

  const bundle = bRes.status === "fulfilled"
    ? bRes.value
    : { verfuegbar: false, stufe: "unbekannt", gruende: [], grund: (bRes.reason && bRes.reason.message) || "Launch-Pruefung fehlgeschlagen." };

  const story = sRes.status === "fulfilled" ? sRes.value : null;

  const frei = normal ? freiesUrteil(normal) : { punkte: 50, ampel: "gelb", checks: [], schlecht: 0, offen: 0 };
  const gesamt = gesamtUrteil(frei, bundle, story);

  // Zwoelf Stunden: die Launch-Daten sind fix. Die Marktzahlen in `coin`
  // sind es nicht - deshalb holt die Oberflaeche die weiter ueber
  // /api/frisch, und diese Antwort ist bewusst die langsame Haelfte.
  send(
    res,
    200,
    {
      ok: true,
      mint: mint,
      coin: normal,
      bundle: bundle,
      story: story,
      urteil: gesamt,
    },
    1800,
  );
};
