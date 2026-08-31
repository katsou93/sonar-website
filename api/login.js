"use strict";
/**
 * POST /api/login   Body: {"password":"..."}
 * Prüft nur, ob das gemeinsame Passwort stimmt. Es gibt kein Token und
 * keine Session: der Browser merkt sich das Passwort und schickt es bei
 * jedem Aufruf mit. Für zwei Leute ist das die ehrlichste Lösung -
 * weniger bewegliche Teile, weniger, was kaputtgehen kann.
 *
 * Kleine Bremse gegen stumpfes Durchprobieren: eine Antwort pro Versuch
 * dauert bewusst eine Viertelsekunde.
 */

const { checkPassword } = require("./_lib/auth");
const { send, fail } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") return fail(res, 405, "Nur POST.", "METHOD");

  let password = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    password = body.password || "";
  } catch (err) {
    return fail(res, 400, "Ungültiger Body.", "BAD_BODY");
  }

  await new Promise((r) => setTimeout(r, 250));

  if (!checkPassword(password)) return fail(res, 401, "Passwort stimmt nicht.", "UNAUTHORIZED");
  send(res, 200, { ok: true });
};
