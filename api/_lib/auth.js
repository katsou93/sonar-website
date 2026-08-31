"use strict";
/**
 * Minimaler Zugangsschutz für zwei Leute.
 *
 * Bewusst schlicht: ein gemeinsames Passwort, das der Browser im
 * localStorage behält und bei jedem API-Aufruf im Header mitschickt.
 * Kein Konto, keine Datenbank, keine Session - es gibt nichts zu klauen
 * ausser dem Passwort selbst.
 *
 * Im Repository liegt NUR der gesalzene SHA-256-Hash. Das Repo ist
 * öffentlich, deshalb ist das Passwort lang und zufällig - ein Hash
 * davon ist praktisch nicht rückrechenbar.
 *
 * Passwort ändern, ohne Code anzufassen: in Vercel die Environment-
 * Variable SONAR_PASSWORD setzen. Die hat Vorrang vor dem Hash hier.
 * Wer den Hash ersetzen will:
 *   node -e "const c=require('crypto');const s='<SALT>';const p='<neues Passwort>';console.log(c.createHash('sha256').update(s+p).digest('hex'))"
 */

const crypto = require("crypto");

const SALT = "d5d33336688f935391ab75766fbaa291";
const PASSWORD_HASH = "f223ecaf25912d968cc344993e5759057278f400a8e1bd986977f4ea0f9aafb7";

function hash(value) {
  return crypto.createHash("sha256").update(SALT + String(value)).digest("hex");
}

/** Vergleich in konstanter Zeit - sonst verrät die Antwortzeit das Passwort Zeichen für Zeichen. */
function sameSecret(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(given) {
  if (!given) return false;
  const override = process.env.SONAR_PASSWORD;
  if (override) return sameSecret(given, override);
  return sameSecret(hash(given), PASSWORD_HASH);
}

module.exports = { checkPassword, hash, SALT };
