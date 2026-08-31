"use strict";
/**
 * Kleiner Fetch-Wrapper mit Timeout, Retry und In-Memory-Cache.
 *
 * Warum selbstgebaut: unsere Datenquellen sind kostenlos und deshalb wackelig.
 * Ein einzelner 429 darf nie den ganzen Scan killen - jede Quelle darf
 * ausfallen, der Report sagt dann ehrlich "Quelle stumm".
 */

const cache = new Map();

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > 400) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expiresAt < now) cache.delete(k);
  }
  return value;
}

class SourceError extends Error {
  constructor(source, message, status) {
    super(source + ": " + message);
    this.source = source;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const retries = opts.retries == null ? 1 : opts.retries;
  const source = opts.source || new URL(url).hostname;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: Object.assign(
          { accept: "application/json", "user-agent": "sonar/0.1 (+https://sonar-website-chi.vercel.app)" },
          opts.headers || {},
        ),
      });
      if (res.status === 429) throw new SourceError(source, "Rate-Limit erreicht", 429);
      if (!res.ok) throw new SourceError(source, "HTTP " + res.status, res.status);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(err && err.status === 429 ? 700 : 200);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof SourceError) throw lastError;
  throw new SourceError(source, (lastError && lastError.message) || "unbekannter Fehler");
}

async function postJson(url, body, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const source = opts.source || new URL(url).hostname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: Object.assign({ "content-type": "application/json", accept: "application/json" }, opts.headers || {}),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new SourceError(source, "HTTP " + res.status, res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Aufgaben mit begrenzter Parallelität - schützt uns vor Rate-Limits. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(
      (async () => {
        while (cursor < items.length) {
          const index = cursor++;
          results[index] = await fn(items[index], index);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

/** Nur für Tests: Cache leeren, damit Szenarien sich nicht gegenseitig sehen. */
function resetCache() {
  cache.clear();
}

module.exports = { cached, getJson, postJson, mapLimit, sleep, SourceError, resetCache };
