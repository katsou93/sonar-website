"use strict";
/**
 * GET /api/melde?text=...&art=ziel      (aufs Handy schicken)
 * GET /api/melde?pruefen=1              (ist Telegram ueberhaupt eingerichtet?)
 *
 * Der Weg vom Browser aufs Handy.
 *
 * Bis hierhin konnte die App zwar alles Moegliche erkennen, aber nur
 * solange der Laptop offen war und der Tab im Vordergrund stand. Genau
 * das ist bei den wichtigsten Meldungen nie der Fall: der Zusammenlauf
 * passiert nachts, und das Fuenffache erreicht ein Coin, waehrend du
 * einkaufst.
 *
 * Der Bot-Token darf dabei niemals in den Browser - deshalb diese
 * Route. Die Oberflaeche schickt nur den fertigen Text, das Geheimnis
 * bleibt auf dem Server.
 *
 * Drei Vorkehrungen gegen Missbrauch und Spam:
 *
 *   1. Sie verlangt denselben Zugriffsschluessel wie alle anderen
 *      Routen. Ohne Passwort keine Nachricht.
 *   2. Der Text wird gekuerzt und maskiert. Er enthaelt Coin-Namen,
 *      und die schreibt der Ersteller des Coins - also wird er als
 *      Text behandelt, nie als Markup.
 *   3. Eine Bremse: hoechstens ein paar Nachrichten pro Minute. Ein
 *      Fehler in einer Schleife soll dir nicht dreihundert Pings
 *      schicken.
 */

const { send, fail, authorized, preflight } = require("./_lib/respond");

const MAX_LAENGE = 700;

/**
 * Die Bremse.
 *
 * Serverlose Funktionen teilen sich keinen Speicher zuverlaessig - eine
 * Instanz weiss nichts von der naechsten. Das reicht hier trotzdem:
 * eine Schleife im Browser landet fast immer auf derselben warmen
 * Instanz, und genau die will man abfangen.
 */
const FENSTER_MS = 60 * 1000;
const MAX_PRO_FENSTER = 8;
let gesendet = [];

function bremseFrei() {
  const jetzt = Date.now();
  gesendet = gesendet.filter((t) => jetzt - t < FENSTER_MS);
  if (gesendet.length >= MAX_PRO_FENSTER) return false;
  gesendet.push(jetzt);
  return true;
}

function maskiere(text) {
  return String(text || "")
    .slice(0, MAX_LAENGE)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(botToken, chatId, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (!authorized(req)) return fail(res, 401, "Zugriffsschlüssel fehlt oder ist falsch.", "UNAUTHORIZED");

  const q = req.query || {};
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  const bereit = !!(token && chat);

  // Die Oberflaeche fragt beim Start einmal nach, ob der Kanal steht -
  // damit sie die Einrichtung erklaeren kann, statt still zu scheitern.
  if (q.pruefen === "1") {
    return send(res, 200, {
      ok: true,
      bereit: bereit,
      fehlt: bereit ? [] : [!token ? "TELEGRAM_BOT_TOKEN" : null, !chat ? "TELEGRAM_CHAT_ID" : null].filter(Boolean),
    }, 60);
  }

  if (!bereit) {
    return send(res, 200, {
      ok: false,
      bereit: false,
      error: "Telegram ist noch nicht eingerichtet.",
      fehlt: [!token ? "TELEGRAM_BOT_TOKEN" : null, !chat ? "TELEGRAM_CHAT_ID" : null].filter(Boolean),
    }, 0);
  }

  const text = maskiere(q.text);
  if (!text.trim()) return fail(res, 400, "Kein Text.", "BAD_INPUT");

  if (!bremseFrei()) {
    // Kein Fehler: die Bremse hat funktioniert. Die Oberflaeche soll
    // daraufhin nicht rot blinken, sondern es einfach lassen.
    return send(res, 200, { ok: true, gesendet: false, gebremst: true }, 0);
  }

  const erfolg = await sendTelegram(token, chat, text);
  send(res, 200, { ok: true, gesendet: erfolg }, 0);
};
