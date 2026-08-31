"use strict";
/**
 * Rugcheck - unabhängige Zweitmeinung zu Contract-Risiken.
 * Kostenlos ohne Key, aber wackelig: wir behandeln jeden Fehler als
 * "Quelle stumm" und liefern trotzdem einen Report aus.
 *
 * Wir übernehmen den Rugcheck-Score bewusst NICHT als unseren Score.
 * Wir nehmen nur die einzelnen Risiko-Punkte und bewerten sie selbst -
 * sonst hätten wir eine Blackbox statt einer Begründung.
 */

const { cached, getJson } = require("./http");

const BASE = "https://api.rugcheck.xyz/v1";

async function getReport(mint) {
  return cached("rc:" + mint, 60000, async () => {
    try {
      const full = await getJson(BASE + "/tokens/" + mint + "/report", {
        source: "rugcheck",
        timeoutMs: 7000,
        retries: 0,
      });
      return normalize(full, "report");
    } catch (err) {
      try {
        const summary = await getJson(BASE + "/tokens/" + mint + "/report/summary", {
          source: "rugcheck",
          timeoutMs: 6000,
          retries: 0,
        });
        return normalize(summary, "summary");
      } catch (err2) {
        return null;
      }
    }
  });
}

function normalize(data, kind) {
  if (!data) return null;
  const risks = Array.isArray(data.risks) ? data.risks : [];
  const totalSupply = data.token && data.token.supply && data.token.decimals != null
    ? Number(data.token.supply) / Math.pow(10, data.token.decimals)
    : null;

  let creatorPct = null;
  if (data.creatorBalance != null && totalSupply) {
    const dec = (data.token && data.token.decimals) || 0;
    creatorPct = ((Number(data.creatorBalance) / Math.pow(10, dec)) / totalSupply) * 100;
  }

  // LP-Anteil, der verbrannt oder gesperrt ist - bei graduierten Coins relevant.
  let lpLockedPct = null;
  if (Array.isArray(data.markets) && data.markets.length) {
    const lp = data.markets[0].lp;
    if (lp && typeof lp.lpLockedPct === "number") lpLockedPct = lp.lpLockedPct;
  }

  return {
    kind: kind,
    score: typeof data.score_normalised === "number" ? data.score_normalised : data.score || null,
    risks: risks.map((r) => ({
      name: r.name || "",
      description: r.description || "",
      level: String(r.level || "").toLowerCase(),
      score: r.score || 0,
    })),
    creator: data.creator || null,
    creatorPct: creatorPct,
    totalHolders: typeof data.totalHolders === "number" ? data.totalHolders : null,
    lpLockedPct: lpLockedPct,
    rugged: data.rugged === true,
    mintAuthority: data.token ? data.token.mintAuthority || null : undefined,
    freezeAuthority: data.token ? data.token.freezeAuthority || null : undefined,
  };
}

module.exports = { getReport };
