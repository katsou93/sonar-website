"use strict";
/**
 * Die Aussenwelt.
 *
 * Bis hierhin liest die App nur die Kette: Themen aus Coin-Namen,
 * Wortwellen aus Coin-Namen. Das hat eine harte Grenze - ein Thema wird
 * erst sichtbar, wenn schon jemand einen Coin daraus gemacht hat. Wir
 * sehen den Schatten, nie den Moment.
 *
 * Dieses Modul holt den Moment. Es fragt drei kostenlose Quellen ab, was
 * die Leute GERADE beschaeftigt, noch bevor irgendein Coin dazu
 * existiert:
 *
 *   Google Trends (US und DE)  - wonach gerade gesucht wird, mit
 *                                Volumenschaetzung
 *   Google News                - die Schlagzeilen der letzten Stunden
 *   Wikipedia                  - die meistgelesenen Artikel des Tages
 *
 * Keine davon kostet etwas, keine braucht einen Schluessel. Und keine
 * ist X - aber alle drei messen dasselbe darunterliegende Ding:
 * kollektive Aufmerksamkeit. Ein Meme, das gross genug ist, um Coins zu
 * erzeugen, ist praktisch immer auch gross genug, um in mindestens einer
 * dieser drei aufzutauchen.
 *
 * Der Wert entsteht aber erst im letzten Schritt: die Begriffe von
 * draussen werden gegen die Coin-Namen gehalten. Ein Wort, das draussen
 * trendet UND auf der Kette auftaucht, ist die Kreuzung - und zwar die
 * einzige Stelle, an der Social Media in diesem Werkzeug wirklich etwas
 * bedeutet. Trends allein sind Wetter und Sportergebnisse.
 *
 * Jede Quelle darf ausfallen. Faellt eine weg, sagt die Antwort das,
 * und die anderen laufen weiter.
 */

const { cached, getText, getJson } = require("./http");
const { tokenize, STOPWORDS } = require("./narrative");
const { matchWord, substanceOf } = require("./watchwords");

/**
 * Woerter, die in Schlagzeilen und Suchtrends staendig vorkommen und
 * nie ein Memecoin-Thema sind. Ohne diese Liste besteht das Ergebnis
 * aus "weather", "stock", "score" und "live".
 */
const NOISE = new Set([
  "weather", "stock", "stocks", "score", "scores", "live", "news", "update", "updates",
  "today", "tonight", "yesterday", "tomorrow", "week", "weekend", "month", "year",
  "results", "schedule", "time", "times", "near", "open", "final", "finals", "game",
  "games", "season", "watch", "video", "full", "list", "latest", "report", "reports",
  "price", "prices", "sale", "deal", "deals", "free", "review", "reviews", "vs",
  "highlights", "lineup", "roster", "draft", "trade", "injury", "picks", "odds",
  "start", "starts", "ends", "died", "dies", "death", "dead", "killed", "shooting",
  "crash", "fire", "storm", "hurricane", "forecast", "traffic", "closed", "closure",
  "police", "court", "trial", "case", "lawsuit", "arrested", "charged", "sentenced",
  "says", "said", "after", "before", "over", "into", "from", "with", "that", "this",
  "what", "when", "where", "which", "will", "would", "could", "should", "about",
  "more", "most", "than", "them", "they", "their", "there", "here", "have", "been",
  "wetter", "heute", "gestern", "morgen", "spiel", "spiele", "ergebnis", "aktuell",
  "nachrichten", "gegen", "wieder", "mehr", "neue", "neuer", "neues", "jahr", "uhr",
  "wikipedia", "special", "portal", "category", "template", "main", "page", "list_of",
]);

/** Titel aus einem RSS-Dokument ziehen - inklusive CDATA. */
function rssTitles(xml) {
  const out = [];
  const items = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const chunk of items) {
    const hit = /<title>([\s\S]*?)<\/title>/i.exec(chunk);
    if (!hit) continue;
    let title = hit[1];
    const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(title);
    if (cdata) title = cdata[1];
    title = title
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (!title) continue;

    // Google Trends liefert eine Volumenschaetzung wie "20,000+".
    let traffic = 0;
    const traf = /<ht:approx_traffic>\s*([\d,.]+)/i.exec(chunk);
    if (traf) traffic = Number(String(traf[1]).replace(/[,.]/g, "")) || 0;

    out.push({ title: title, traffic: traffic });
  }
  return out;
}

/** Gestern statt heute: die Tagesstatistik von heute ist noch nicht fertig. */
function wikiPath(now) {
  const d = new Date((now || Date.now()) - 36 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "/" + pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate());
}

const SOURCES = [
  {
    key: "trends_us",
    label: "Google Trends US",
    load: async () => rssTitles(await getText("https://trends.google.com/trending/rss?geo=US", { source: "trends", timeoutMs: 4500 })),
  },
  {
    key: "trends_de",
    label: "Google Trends DE",
    load: async () => rssTitles(await getText("https://trends.google.com/trending/rss?geo=DE", { source: "trends", timeoutMs: 4500 })),
  },
  {
    key: "news",
    label: "Google News",
    load: async () =>
      rssTitles(await getText("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", { source: "news", timeoutMs: 4500 })),
  },
  {
    key: "wiki",
    label: "Wikipedia",
    load: async () => {
      const url =
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/" + wikiPath(Date.now());
      const data = await getJson(url, { source: "wikipedia", timeoutMs: 4500, retries: 0 });
      const articles = (data && data.items && data.items[0] && data.items[0].articles) || [];
      return articles
        .filter((a) => a && a.article && !/^(Main_Page|Special:|Wikipedia:|Portal:|Category:|-)/.test(a.article))
        .slice(0, 60)
        .map((a) => ({ title: String(a.article).replace(/_/g, " "), traffic: a.views || 0 }));
    },
  },
];

/** Aus Schlagzeilen brauchbare Einzelbegriffe machen. */
function termsFromTitles(entries, bucket, sourceKey) {
  for (const entry of entries) {
    for (const word of tokenize(entry.title)) {
      if (word.length < 4 || word.length > 20) continue;
      if (/^[0-9]+$/.test(word)) continue;
      if (NOISE.has(word) || STOPWORDS.has(word)) continue;
      const hit = bucket.get(word) || { term: word, sources: new Set(), traffic: 0 };
      hit.traffic = Math.max(hit.traffic, entry.traffic || 0);
      if (sourceKey) hit.sources.add(sourceKey);
      bucket.set(word, hit);
    }
  }
}

/**
 * Was ist draussen los?
 *
 * Ergebnis wird 15 Minuten gecacht - Suchtrends und Schlagzeilen aendern
 * sich nicht im Sekundentakt, und wir wollen die Quellen nicht reizen.
 */
async function fetchBuzz() {
  return cached("buzz:v1", 15 * 60 * 1000, async () => {
    const results = await Promise.allSettled(SOURCES.map((s) => s.load()));
    const bucket = new Map();
    const sources = {};
    let ok = 0;

    results.forEach((res, i) => {
      const src = SOURCES[i];
      if (res.status !== "fulfilled") {
        sources[src.key] = { label: src.label, ok: false, count: 0 };
        return;
      }
      ok++;
      sources[src.key] = { label: src.label, ok: true, count: res.value.length };
      termsFromTitles(res.value, bucket, src.key);
    });

    const terms = Array.from(bucket.values())
      .map((t) => ({ term: t.term, sources: Array.from(t.sources), traffic: t.traffic }))
      // Mehrere Quellen schlagen hohes Volumen aus einer einzigen.
      .sort((a, b) => b.sources.length - a.sources.length || b.traffic - a.traffic)
      .slice(0, 120);

    return { terms: terms, sources: sources, sourcesOk: ok, sourcesTotal: SOURCES.length, fetchedAt: Date.now() };
  });
}

/**
 * Die Kreuzung: welcher Begriff von draussen taucht auf der Kette auf?
 *
 * Das hier ist der eigentliche Zweck des Moduls. Ein Trend ohne Coins
 * ist eine Nachricht. Ein Coin ohne Trend ist Rauschen. Beides zusammen
 * ist der Moment, den man sonst durch Scrollen sucht.
 */
function crossWithCoins(items, terms) {
  const words = terms.map((t) => t.term);
  const byWord = new Map();
  const meta = new Map(terms.map((t) => [t.term, t]));

  for (const item of items || []) {
    const word = matchWord(item, words);
    if (!word) continue;
    const check = substanceOf(item);
    item.buzzWord = word;
    item.buzzLevel = check.ok ? "substanz" : "gesehen";
    item.buzzReasons = check.reasons;
    const list = byWord.get(word) || [];
    list.push(item);
    byWord.set(word, list);
  }

  const crossings = [];
  for (const [word, members] of byWord) {
    const info = meta.get(word) || { sources: [], traffic: 0 };
    const substance = members.filter((m) => m.buzzLevel === "substanz");
    const ages = members.map((m) => m.ageMinutes).filter((a) => a != null);
    crossings.push({
      term: word,
      sources: info.sources,
      traffic: info.traffic,
      coins: members.length,
      withSubstance: substance.length,
      youngestMinutes: ages.length ? Math.min.apply(null, ages) : null,
      examples: members
        .slice()
        .sort((a, b) => (b.buzzLevel === "substanz" ? 1 : 0) - (a.buzzLevel === "substanz" ? 1 : 0) || (b.volumeH1 || 0) - (a.volumeH1 || 0))
        .slice(0, 4)
        .map((m) => ({
          address: m.address,
          symbol: m.symbol,
          name: m.name,
          priceChangeH1: m.priceChangeH1 || 0,
          level: m.buzzLevel,
        })),
    });
  }

  // Erst die mit Substanz, dann die mit den meisten Coins, dann die
  // aus mehreren Quellen.
  crossings.sort(
    (a, b) =>
      b.withSubstance - a.withSubstance ||
      b.coins - a.coins ||
      b.sources.length - a.sources.length ||
      b.traffic - a.traffic,
  );
  return crossings;
}

/** Alles zusammen: Aussenwelt holen und gegen die Coins halten. */
async function analyse(items) {
  let buzz;
  try {
    buzz = await fetchBuzz();
  } catch (err) {
    return { terms: [], sources: {}, sourcesOk: 0, sourcesTotal: SOURCES.length, crossings: [], error: (err && err.message) || "Aussenwelt nicht erreichbar" };
  }
  return {
    terms: buzz.terms.slice(0, 40),
    sources: buzz.sources,
    sourcesOk: buzz.sourcesOk,
    sourcesTotal: buzz.sourcesTotal,
    fetchedAt: buzz.fetchedAt,
    crossings: crossWithCoins(items, buzz.terms).slice(0, 8),
  };
}

module.exports = { analyse, fetchBuzz, crossWithCoins, rssTitles, termsFromTitles, wikiPath, NOISE, SOURCES };
