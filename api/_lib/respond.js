"use strict";
/** Gemeinsame Antwort-Helfer: Header, optionaler Zugriffsschutz, Fehlerform. */

function send(res, status, payload, cacheSeconds) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "cache-control",
    cacheSeconds ? "public, s-maxage=" + cacheSeconds + ", stale-while-revalidate=" + cacheSeconds * 3 : "no-store",
  );
  res.status(status).send(JSON.stringify(payload));
}

function fail(res, status, message, code) {
  send(res, status, { ok: false, error: message, code: code || null });
}

/**
 * Jeder Datenendpunkt verlangt das gemeinsame Passwort - im Header
 * (bevorzugt, landet nicht in Logs) oder als ?k= für schnelle Tests.
 */
const { checkPassword } = require("./auth");

function authorized(req) {
  const given = req.headers["x-sonar-key"] || (req.query && req.query.k) || "";
  return checkPassword(given);
}

function preflight(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-sonar-key");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.status(204).end();
  return true;
}

module.exports = { send, fail, authorized, preflight };
