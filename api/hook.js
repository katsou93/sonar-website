"use strict";
/**
 * POST /api/hook?secret=...
 *
 * Der Push-Kanal. Helius kann eine Liste von Wallets bewachen und uns bei
 * jeder Transaktion sofort anrufen, statt dass wir alle paar Minuten
 * nachfragen. Zwei Vorteile:
 *
 *   Geschwindigkeit - die Meldung kommt in Sekunden statt im Pollingtakt.
 *   Kosten          - eine Webhook-Zustellung kostet 1 Guthabenpunkt,
 *                     eine Abfrage der Enhanced-API ungefaehr 110. Bei
 *                     einem Freikontingent von einer Million im Monat ist
 *                     das der Unterschied zwischen "laeuft nebenbei" und
 *                     "nach zwei Tagen aufgebraucht".
 *
 * Einrichtung (einmalig, im Helius-Dashboard unter Webhooks):
 *   URL          https://sonar-website-chi.vercel.app/api/hook?secret=DEIN_SECRET
 *   Typ          Enhanced
 *   Transaktion  SWAP
 *   Adressen     die Wallets, denen ihr folgt
 * Dazu in Vercel: SONAR_HOOK_SECRET (frei gewaehlt, gleich dem in der URL),
 * TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID.
 *
 * Sicherheitshinweis zum Inhalt: alles, was hier hereinkommt, ist von
 * aussen geschrieben - Token-Namen und Symbole stammen aus Metadaten, die
 * der Ersteller des Coins frei waehlt. Sie werden ausschliesslich als
 * Text behandelt und vor dem Versand maskiert.
 */

const crypto = require("crypto");
const { buyFromSwap } = require("./_lib/wallets");
const { send, fail } = require("./_lib/respond");

const MAX_MESSAGES = 5;

function secretOk(req) {
  const expected = process.env.SONAR_HOOK_SECRET || process.env.SONAR_CRON_SECRET;
  if (!expected) return false;
  const header = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const given = String(header || (req.query && req.query.secret) || "");
  if (given.length !== String(expected).length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(expected)));
  } catch (err) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Nur POST.", "METHOD_NOT_ALLOWED");
  if (!secretOk(req)) return fail(res, 401, "Falsches oder fehlendes Secret.", "UNAUTHORIZED");

  const events = Array.isArray(req.body) ? req.body : req.body ? [req.body] : [];
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const moves = [];
  for (const event of events) {
    if (!event || event.type !== "SWAP") continue;
    // Der Kontoinhaber der Transaktion ist die Wallet, der wir folgen.
    const wallet = event.feePayer;
    if (!wallet) continue;
    const move = buyFromSwap(event, wallet);
    if (!move || move.side !== "kauf") continue;
    move.wallet = wallet;
    moves.push(move);
    if (moves.length >= MAX_MESSAGES) break;
  }

  if (!moves.length) return send(res, 200, { ok: true, received: events.length, sent: 0 });
  if (!botToken || !chatId) {
    return send(res, 200, { ok: true, received: events.length, sent: 0, note: "Telegram nicht eingerichtet" });
  }

  const results = await Promise.all(moves.map((m) => sendTelegram(botToken, chatId, format(m))));
  send(res, 200, { ok: true, received: events.length, matched: moves.length, sent: results.filter(Boolean).length });
};

function format(move) {
  const short = (a) => String(a || "").slice(0, 4) + "…" + String(a || "").slice(-4);
  const lines = [
    "\u{1F441} <b>" + esc(short(move.wallet)) + " hat gekauft</b>",
    "<b>" + esc(move.symbol || "?") + "</b>" + (move.solAmount ? " für " + move.solAmount + " SOL" : ""),
    "über " + esc(move.source || "unbekannt"),
    '<a href="https://pump.fun/coin/' + esc(move.mint) + '">pump.fun</a> · ' +
      '<a href="https://solscan.io/tx/' + esc(move.signature) + '">Transaktion</a>',
    "<code>" + esc(move.mint) + "</code>",
    "",
    "Vor dem Nachkaufen im Scanner prüfen - er kauft nicht für dich.",
  ];
  return lines.join("\n");
}

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(botToken, chatId, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return res.ok;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
