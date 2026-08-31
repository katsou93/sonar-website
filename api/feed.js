"use strict";
/**
 * GET /api/feed
 * Parameter: minLiquidity, minVolumeH1, minAge, maxAge (Minuten),
 *            socials=1, stage=any|graduated|bonding_curve,
 *            minScore, sort=heat|new|volume|score, limit
 */

const { buildFeed } = require("./_lib/feed");
const { send, fail, authorized, preflight } = require("./_lib/respond");

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  try {
    const feed = await buildFeed(req.query || {});
    send(res, 200, Object.assign({ ok: true }, feed), 25);
  } catch (err) {
    fail(res, 502, (err && err.message) || "Radar nicht verfügbar.", "FEED_FAILED");
  }
};
