"use strict";
/**
 * GET /api/alerts?secret=...&window=12
 *
 * Prüft den Radar gegen eure Filter und schickt Treffer nach Telegram.
 * Gedacht für einen Zeitplan (GitHub Actions, siehe .github/workflows/sonar-alerts.yml).
 *
 * Zur Entdopplung ohne Datenbank: es werden nur Coins gemeldet, die jünger
 * sind als das Zeitfenster des Laufs. Läuft der Job alle 10 Minuten mit
 * window=12, sieht jeder Coin genau einen Alarm. Kein Speicher, keine
 * Karteileichen, keine doppelten Pings um 3 Uhr nachts.
 *
 * Benötigte Environment-Variablen in Vercel:
 *   TELEGRAM_BOT_TOKEN  - vom BotFather
 *   TELEGRAM_CHAT_ID    - eure Gruppe oder euer privater Chat
 *   SONAR_CRON_SECRET   - frei gewählt, schützt den Endpunkt
 */

const { buildFeed } = require("./_lib/feed");
const { send, fail } = require("./_lib/respond");

const TELEGRAM_LIMIT = 6; // nie mehr als 6 Nachrichten pro Lauf - sonst ist es Spam

module.exports = async function handler(req, res) {
  const secret = process.env.SONAR_CRON_SECRET;
  const given = (req.query && req.query.secret) || req.headers["x-sonar-secret"];
  if (!secret || String(given) !== String(secret)) {
    return fail(res, 401, "Falsches oder fehlendes Secret.", "UNAUTHORIZED");
  }

  const windowMinutes = Number((req.query && req.query.window) || 12) || 12;
  const dryRun = req.query && (req.query.dry === "1" || req.query.dry === "true");

  try {
    const feed = await buildFeed({
      minLiquidity: (req.query && req.query.minLiquidity) || 8000,
      minVolumeH1: (req.query && req.query.minVolumeH1) || 5000,
      minAge: (req.query && req.query.minAge) || 3,
      maxAge: windowMinutes,
      minScore: (req.query && req.query.minScore) || 55,
      stage: (req.query && req.query.stage) || "any",
      socials: (req.query && req.query.socials) || "1",
      sort: "early",
      limit: TELEGRAM_LIMIT,
    });

    const hits = feed.items;
    if (dryRun) return send(res, 200, { ok: true, dryRun: true, hits: hits });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      return fail(res, 500, "TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlt in den Environment-Variablen.", "NO_TELEGRAM");
    }

    let sent = 0;
    for (const hit of hits) {
      const ok = await sendTelegram(botToken, chatId, formatMessage(hit));
      if (ok) sent++;
    }

    send(res, 200, { ok: true, checked: feed.scanned, matched: hits.length, sent: sent });
  } catch (err) {
    fail(res, 502, (err && err.message) || "Alarmlauf fehlgeschlagen.", "ALERTS_FAILED");
  }
};

function formatMessage(item) {
  const money = (n) => (n == null ? "?" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 100) / 10 + "k");
  const lines = [
    "<b>" + escapeHtml(item.symbol || "?") + "</b> — " + escapeHtml(item.name || "") + "  <b>" + item.score + "/100</b>",
    item.ageMinutes + " Min alt · " + (item.stage === "graduated" ? "migriert" : "auf der Kurve"),
    "MCap " + money(item.marketCap) + " · Liq " + money(item.liquidityUsd) + " · Vol 1h " + money(item.volumeH1),
    "1h " + (item.priceChangeH1 >= 0 ? "+" : "") + Math.round(item.priceChangeH1) + "%" +
      (item.buySellRatioH1 != null ? " · " + item.buySellRatioH1.toFixed(2) + " Käufe/Verkauf" : ""),
  ];
  if (item.topFlags && item.topFlags.length) {
    lines.push("⚠️ " + item.topFlags.map((f) => escapeHtml(f.title)).join(" · "));
  }
  lines.push('<a href="https://pump.fun/coin/' + item.address + '">pump.fun</a> · <a href="' + item.dexUrl + '">Chart</a>');
  lines.push("<code>" + item.address + "</code>");
  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(botToken, chatId, text) {
  try {
    const res = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}
