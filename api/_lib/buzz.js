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
  // RSS nutzt <item>, Atom nutzt <entry>. Reddit liefert Atom - ohne
  // diese Zeile haette der Rueckfallweg still nichts zurueckgegeben und
  // die Quelle waere als "leer" statt als "kaputt" erschienen.
  const roh = String(xml || "");
  const items = /<item[\s>]/i.test(roh)
    ? roh.split(/<item[\s>]/i).slice(1)
    : roh.split(/<entry[\s>]/i).slice(1);
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
    ganz: true,
    label: "Google Trends US",
    load: async () => rssTitles(await getText("https://trends.google.com/trending/rss?geo=US", { source: "trends", timeoutMs: 4500 })),
  },
  {
    key: "trends_de",
    ganz: true,
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
    // Die Quelle, die bisher gefehlt hat - und vermutlich die wichtigste.
    //
    // Google Trends zeigt, WONACH gesucht wird. Das ist bereits die
    // zweite Welle: jemand hat etwas gesehen und sucht danach. Reddit
    // zeigt die erste: dort entsteht die Geschichte, Stunden bevor
    // jemand sie googelt und Tage bevor eine Zeitung sie aufgreift.
    //
    // Fuer Meme-Coins ist genau dieser Vorlauf alles. Wenn ein Clip auf
    // r/all steigt, hat noch niemand einen Coin dazu gemintet. Wenn er
    // bei Google Trends auftaucht, gibt es schon zwanzig davon.
    //
    // Kostet nichts, braucht keinen Schluessel: Reddit gibt jede Seite
    // als JSON heraus, wenn man .json anhaengt.
    key: "reddit",
    label: "Reddit im Aufstieg",
    load: async () => {
      // Reddit weist Anfragen ohne erkennbaren User-Agent ab - live
      // gemessen: von Vercel aus kam nichts zurueck, bis dieser Kopf
      // gesetzt war. Reddit verlangt ausserdem ausdruecklich einen
      // sprechenden Namen statt eines nachgeahmten Browsers.
      const kopf = { "user-agent": "sonar-terminal/1.0 (meme coin research; contact via github katsou93/sonar-website)" };
      const out = [];
      const gesehen = new Set();
      let eineGing = false;

      // Reddit-Titel sind ganze Saetze, keine Suchbegriffe. Live
      // gemessen lieferte die Quelle sonst genau das: "stop", "found",
      // "attempt", "many", "work" - Grammatik statt Thema.
      //
      // Ein Meme-Thema ist aber fast immer ein NAME: ein Mensch, ein
      // Ort, ein Tier, eine Marke. Und Namen schreibt man im Englischen
      // gross, mitten im Satz. Genau daran lassen sie sich erkennen.
      // Das erste Wort faellt weg, weil dort jeder Satz gross anfaengt.
      //
      // Das erste Wort ist ein Sonderfall: dort steht oft der wichtigste
      // Name ueberhaupt ("Trump kuendigt an...", "Nepal protests..."),
      // aber genauso oft nur ein Satzanfang. Deshalb faellt es nur weg,
      // wenn es zu dieser kurzen Liste gehoert.
      const ANFANG = {
        the:1, this:1, that:1, these:1, those:1, my:1, our:1, your:1, his:1, her:1, their:1,
        found:1, just:1, look:1, looking:1, some:1, someone:1, what:1, when:1, where:1,
        why:1, how:1, after:1, before:1, first:1, last:1, best:1, worst:1, does:1, did:1,
        can:1, could:1, would:1, should:1, here:1, there:1, they:1, guys:1, anyone:1,
        finally:1, apparently:1, breaking:1, update:1, help:1, need:1, saw:1, new:1
      };

      const eigennamen = (satz) => {
        const woerter = String(satz || "").split(/\s+/);

        // Title Case aussortieren. Live gemessen kamen sonst "Woman",
        // "Outside", "Working", "Welcome" durch - alles aus
        // Ueberschriften, die Jedes Wort Gross Schreiben. Dort traegt
        // die Grossschreibung keine Information mehr, also darf man aus
        // ihr auch nichts ableiten. Lieber diesen Titel ganz auslassen
        // als aus ihm Grammatik als Thema zu verkaufen.
        const lang = woerter.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 4);
        const gross = lang.filter((w) => /^[A-Z]/.test(w.replace(/[^A-Za-z]/g, "")));
        if (lang.length >= 4 && gross.length / lang.length > 0.6) return [];

        const treffer = [];
        const erst = (woerter[0] || "").replace(/[^A-Za-z]/g, "");
        if (erst.length >= 4 && erst.length <= 20 && /^[A-Z][a-z]/.test(erst) && !ANFANG[erst.toLowerCase()]) {
          treffer.push(erst);
        }
        for (let i = 1; i < woerter.length; i++) {
          const roh = woerter[i].replace(/[^A-Za-z]/g, "");
          if (roh.length < 4 || roh.length > 20) continue;
          // Gross beginnend, aber nicht komplett gross - VOLLKAPITALE
          // sind auf Reddit Betonung ("THIS IS INSANE"), kein Name.
          if (!/^[A-Z][a-z]/.test(roh)) continue;
          treffer.push(roh);
        }
        return treffer;
      };

      const nimm = (titel, punkte, alterSek) => {
        if (!titel || gesehen.has(titel)) return;
        gesehen.add(titel);
        const namen = eigennamen(titel);
        // Ein Titel ohne einen einzigen Namen hat kein Thema, ueber das
        // sich ein Coin machen liesse. Der faellt hier weg statt
        // spaeter als Grammatik-Rauschen aufzutauchen.
        if (!namen.length) return;
        titel = namen.join(" ");
        out.push({
          title: String(titel),
          // Aufwaerts-Geschwindigkeit statt absoluter Punktzahl: ein
          // Beitrag mit 800 Punkten nach zwanzig Minuten sagt mehr als
          // einer mit 40.000 nach zwei Tagen.
          traffic: Math.round((punkte || 0) / Math.max(1, (alterSek || 3600) / 3600)),
        });
      };

      // Weg 1: die JSON-Schnittstelle. Liefert Punkte und Alter mit,
      // also die bessere Aussage - wenn sie durchkommt.
      for (const url of [
        "https://www.reddit.com/r/all/rising.json?limit=40",
        "https://www.reddit.com/r/memes/hot.json?limit=25",
      ]) {
        try {
          const data = await getJson(url, { source: "reddit", timeoutMs: 5000, retries: 0, headers: kopf });
          const kinder = (data && data.data && data.data.children) || [];
          for (const k of kinder) {
            const d = k && k.data;
            if (!d || !d.title || d.over_18) continue;
            nimm(d.title, d.score, Date.now()/1000 - (d.created_utc || 0));
          }
          if (kinder.length) eineGing = true;
        } catch (err) {
          // Weiter zum naechsten Weg.
        }
      }

      // Weg 2: derselbe Inhalt als RSS. Ohne Punktzahl, dafuer
      // deutlich seltener blockiert. Lieber die Titel ohne Gewichtung
      // als gar nichts - fuer die Themenerkennung zaehlt das Wort,
      // nicht die Punktzahl.
      if (!eineGing) {
        for (const url of [
          "https://www.reddit.com/r/all/rising/.rss?limit=40",
          "https://www.reddit.com/r/memes/hot/.rss?limit=25",
        ]) {
          try {
            const xml = await getText(url, { source: "reddit", timeoutMs: 5000, headers: kopf });
            const eintraege = rssTitles(xml);
            eintraege.forEach((e) => nimm(e.title, 60, 3600));
            if (eintraege.length) eineGing = true;
          } catch (err) {
            // Auch das kann fehlschlagen.
          }
        }
      }

      // Wenn KEIN Weg durchkam, ist das ein Fehler und kein leeres
      // Ergebnis. Sonst steht in der Quellenanzeige "ok" neben einer
      // Quelle, die gar nichts liefert - und man sucht den Fehler an
      // der falschen Stelle.
      if (!eineGing) throw new Error("Reddit nicht erreichbar");
      return out;
    },
  },
  {
    // Nachrichtenlage aus zweiter Richtung. Google News ist stark bei
    // Politik und Wirtschaft, Hacker News bei Technik und KI - und
    // gerade dort entstehen gerade die meisten Themen.
    key: "hn",
    label: "Hacker News",
    load: async () => {
      const url = "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=40";
      const data = await getJson(url, { source: "hn", timeoutMs: 4500, retries: 0 });
      return ((data && data.hits) || [])
        .filter((h) => h && h.title)
        .map((h) => ({ title: String(h.title), traffic: (h.points || 0) * 10 }));
    },
  },
  {
    key: "wiki",
    ganz: true,
    label: "Wikipedia",
    load: async () => {
      const url =
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/" + wikiPath(Date.now());
      const data = await getJson(url, { source: "wikipedia", timeoutMs: 4500, retries: 0 });
      const articles = (data && data.items && data.items[0] && data.items[0].articles) || [];
      return articles
        .filter((a) => a && a.article && !/^(Main_Page|Special:|Wikipedia:|Portal:|Category:|File:|Help:|Talk:|-)/.test(a.article))
        // Wikipedias Meistgelesen-Liste steckt voller Verwaltungsseiten:
        // "Deaths in 2026", "List of ...", ".xyz", Jahreszahlen. Live
        // standen genau die oben und sahen aus wie Themen. Ein Coin
        // namens "Deaths in 2026" wird nie jemand machen.
        .filter((a) => {
          const t = String(a.article).replace(/_/g, " ");
          if (/^(Deaths|List|Index|Timeline|Outline|Glossary|Comparison)\b/i.test(t)) return false;
          if (/\b(in|of) (19|20)\d\d$/i.test(t)) return false;
          if (/^\W/.test(t)) return false;
          if (/^(19|20)\d\d/.test(t)) return false;
          return true;
        })
        .slice(0, 60)
        .map((a) => ({ title: String(a.article).replace(/_/g, " "), traffic: a.views || 0 }));
    },
  },
];

/** Aus Schlagzeilen brauchbare Einzelbegriffe machen. */
/**
 * Satzanfaenge, die nie ein Thema sind. Ein grossgeschriebenes Wort am
 * Satzanfang ist meistens nur Grammatik.
 */
const ANFANG_WORT = new Set([
  "the", "this", "that", "these", "those", "my", "our", "your", "his", "her", "their", "its",
  "found", "just", "look", "looking", "some", "someone", "what", "when", "where", "why", "how",
  "after", "before", "first", "last", "best", "worst", "does", "did", "can", "could", "would",
  "should", "here", "there", "they", "guys", "anyone", "finally", "apparently", "breaking",
  "update", "help", "need", "saw", "new", "why", "who", "which", "and", "but", "for", "with",
  "from", "into", "over", "under", "about", "more", "most", "many", "much", "such", "than",
  "then", "now", "today", "yesterday", "tomorrow", "week", "year",
  // Substantive, mit denen Schlagzeilen anfangen. Sie sind gross
  // geschrieben, ohne Namen zu sein - "Judge blocks...", "Companies
  // report...". Live gemessen kamen genau diese durch und machten die
  // Seite generisch.
  "judge", "judges", "police", "court", "courts", "report", "reports", "study", "studies",
  "official", "officials", "source", "sources", "video", "videos", "photo", "photos",
  "man", "woman", "men", "women", "people", "family", "families", "student", "students",
  "worker", "workers", "doctor", "doctors", "scientist", "scientists", "researcher",
  "researchers", "expert", "experts", "company", "companies", "government", "state",
  "states", "city", "cities", "school", "schools", "hospital", "death", "deaths",
  "group", "groups", "team", "teams", "market", "markets", "price", "prices",
  "million", "billion", "thousand", "hundred", "video", "watch", "meet", "check",
]);

/**
 * Aus einer Schlagzeile die ENTITAETEN holen - nicht die Woerter.
 *
 * Das war der eigentliche Fehler, und er hat die ganze Seite entwertet.
 * Vorher wurde jede Schlagzeile in einzelne Kleinbuchstaben-Woerter
 * zerlegt. Aus "Gloria Steinem, groundbreaking feminist, dies at 91"
 * wurden dann "gloria", "steinem", "groundbreaking", "feminist" - vier
 * Eintraege, von denen keiner das Thema ist. Das Thema ist EIN Ding:
 * Gloria Steinem. Und genau so hiesse auch der Coin.
 *
 * Gleichzeitig ueberlebten Woerter wie "deaths", "judge", "blocks",
 * "companies" - formal sahen sie aus wie alles andere. Sie stehen aber
 * an jedem beliebigen Tag in irgendeiner Schlagzeile und bedeuten
 * nichts.
 *
 * Beides loest dieselbe Regel: nimm zusammenhaengende GROSS
 * geschriebene Woerter als eine Einheit. Namen sind gross, Grammatik
 * ist klein. "Gloria Steinem" bleibt zusammen, "deaths" faellt weg,
 * ohne dass man eine Liste generischer Substantive pflegen muesste.
 */
/**
 * Woerter, die fuer sich genommen nichts sind, in einem Namen aber
 * dazugehoeren. "New" ist ein Stoppwort - "New York" ist ein Ort. Ohne
 * diese Ausnahme blieb live nur "York" uebrig.
 */
const NAMENSTEIL = new Set([
  "new", "old", "big", "great", "north", "south", "east", "west", "upper", "lower",
  "san", "santa", "saint", "los", "las", "van", "von", "der", "del", "la", "le", "el",
]);

function entitiesFromTitle(satz) {
  const roh = String(satz || "").trim();
  if (!roh) return [];
  const woerter = roh.split(/\s+/);

  // Title Case erkennen: dort ist JEDES Wort gross und die
  // Grossschreibung sagt nichts mehr aus.
  const lang = woerter.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 4);
  const gross = lang.filter((w) => /^[A-Z]/.test(w.replace(/[^A-Za-z]/g, "")));
  const titleCase = lang.length >= 4 && gross.length / lang.length > 0.6;

  const out = [];
  let lauf = [];

  const abschliessen = () => {
    if (!lauf.length) { return; }
    // Ein Lauf aus bis zu drei Woertern. Laenger ist keine Entitaet
    // mehr, sondern ein halber Satz in Grossschreibung.
    const stueck = lauf.slice(0, 3).join(" ");
    const flach = stueck.toLowerCase();
    if (stueck.replace(/[^A-Za-z]/g, "").length >= 4 && !NOISE.has(flach) && !STOPWORDS.has(flach)) {
      out.push(stueck);
    }
    lauf = [];
  };

  for (let i = 0; i < woerter.length; i++) {
    // Besitzform abschneiden: "China's" und "China" sind dasselbe Thema
    // und standen live als zwei Eintraege nebeneinander.
    const sauber = woerter[i].replace(/[^A-Za-zÄÖÜäöüß'-]/g, "").replace(/['’]s$/i, "");
    const klein = sauber.toLowerCase();
    // ANFANG_WORT gilt NUR am Satzanfang - das ist der Sinn der Liste.
    // Vorher wurde sie ueberall angewendet, und dadurch zerfiel "New
    // York" zu "York": "new" steht drin, weil Saetze damit anfangen,
    // nicht weil es in einem Namen stoert.
    const istName =
      sauber.length >= 3 &&
      sauber.length <= 20 &&
      /^[A-ZÄÖÜ][a-zäöüß'-]/.test(sauber) &&
      (i > 0 || !ANFANG_WORT.has(klein)) &&
      // Ein Stoppwort darf mitten in einem Namen stehen, wenn direkt
      // ein weiterer Name folgt - "New York", "San Francisco".
      (!STOPWORDS.has(klein) || (NAMENSTEIL.has(klein) && /^[A-ZÄÖÜ][a-z]/.test((woerter[i + 1] || "").replace(/[^A-Za-z]/g, "")))) &&
      !NOISE.has(klein);

    // Bei Title Case darf nur der Satzanfang zaehlen - dort steht das
    // Thema meistens, und der Rest ist reine Schreibkonvention.
    if (titleCase && i > 2) { abschliessen(); continue; }

    if (istName) lauf.push(sauber);
    else abschliessen();
  }
  abschliessen();
  return out;
}

/**
 * Begriffe einsammeln.
 *
 * ganz=true bedeutet: der Titel IST schon die Entitaet und wird nicht
 * zerlegt. Das gilt fuer Google Trends (dort steht der Suchbegriff) und
 * Wikipedia (dort steht der Artikelname). Nur echte Schlagzeilen werden
 * auseinandergenommen.
 */
function termsFromTitles(entries, bucket, sourceKey, ganz) {
  for (const entry of entries) {
    const titel = String(entry.title || "");
    let stuecke;
    if (ganz) {
      const flach = titel.toLowerCase().trim();
      stuecke = flach.length >= 4 && !NOISE.has(flach) && !STOPWORDS.has(flach) ? [titel.trim()] : [];
    } else {
      stuecke = entitiesFromTitle(titel);
    }

    for (const stueck of stuecke) {
      const key = stueck.toLowerCase();
      if (key.length < 4 || key.length > 40) continue;
      if (/^[0-9\s]+$/.test(key)) continue;
      const hit = bucket.get(key) || { term: stueck, sources: new Set(), traffic: 0, beispiel: null };
      hit.traffic = Math.max(hit.traffic, entry.traffic || 0);
      // Die Schlagzeile mitnehmen. Ein nacktes Wort kann man nicht
      // beurteilen - "Steinem" sagt nichts, "Gloria Steinem, feminist
      // icon, dies at 91" sagt alles, und zwar in einer Sekunde.
      if (!hit.beispiel && titel.length > stueck.length + 4) hit.beispiel = titel.slice(0, 140);
      if (sourceKey) hit.sources.add(sourceKey);
      bucket.set(key, hit);
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
    const alleTitel = [];
    let ok = 0;

    results.forEach((res, i) => {
      const src = SOURCES[i];
      if (res.status !== "fulfilled") {
        sources[src.key] = { label: src.label, ok: false, count: 0 };
        return;
      }
      ok++;
      sources[src.key] = { label: src.label, ok: true, count: res.value.length };
      // Bei Google Trends steht der Suchbegriff und bei Wikipedia der
      // Artikelname - beides IST schon die Entitaet und darf nicht
      // zerlegt werden. Nur echte Schlagzeilen werden auseinander-
      // genommen.
      termsFromTitles(res.value, bucket, src.key, !!src.ganz);
      alleTitel.push({ key: src.key, entries: res.value });
    });

    // Zweiter Durchgang: Bestaetigung.
    //
    // Die Entitaetserkennung verlangt Grossschreibung - zu Recht, sonst
    // kaeme wieder "deaths" und "judge" durch. Aber sie unterzaehlt
    // dadurch: steht "Jimothy" bei Reddit gross und in einer anderen
    // Schlagzeile klein mitten im Satz, ist das trotzdem eine zweite
    // Quelle. Ein bereits bekanntes Thema wiederzuerkennen ist etwas
    // ganz anderes, als es zu finden - dafuer reicht der blosse Text.
    for (const { key, entries } of alleTitel) {
      for (const entry of entries) {
        const flach = " " + String(entry.title || "").toLowerCase() + " ";
        for (const [begriff, hit] of bucket) {
          if (hit.sources.has(key)) continue;
          if (begriff.length < 5) continue;
          // Wortgrenzen, damit "stan" nicht in "understand" trifft.
          if (flach.indexOf(" " + begriff + " ") === -1 &&
              flach.indexOf(" " + begriff + ",") === -1 &&
              flach.indexOf(" " + begriff + ".") === -1 &&
              flach.indexOf(" " + begriff + "'") === -1) continue;
          hit.sources.add(key);
          hit.traffic = Math.max(hit.traffic, entry.traffic || 0);
          if (!hit.beispiel) hit.beispiel = String(entry.title || "").slice(0, 140);
        }
      }
    }

    const terms = Array.from(bucket.values())
      .map((t) => ({ term: t.term, sources: Array.from(t.sources), traffic: t.traffic, beispiel: t.beispiel || null }))
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

module.exports = {
  entitiesFromTitle, analyse, fetchBuzz, crossWithCoins, rssTitles, termsFromTitles, wikiPath, NOISE, SOURCES };
