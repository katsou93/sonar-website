"use strict";
/**
 * Themen-Erkennung.
 *
 * Ein einzelner Coin, der 40 Prozent macht, ist ein Zufall. Vier Katzen-Coins,
 * die gleichzeitig 20 Prozent machen, sind ein Thema - und Themen halten
 * laenger als Zufaelle. Genau darauf zielt dieses Modul: jeden Coin ueber
 * Name und Symbol einer Ecke zuordnen, und dann messen, ob sich eine ganze
 * Ecke gemeinsam bewegt.
 *
 * Warum das ohne Twitter-API funktioniert: die Erzaehlung steht im Namen.
 * Wer einen Katzen-Coin startet, nennt ihn nicht "Projekt 7". Der Name ist
 * das Signal - und er ist kostenlos zu haben.
 *
 * Grenze, die man kennen muss: das hier misst, was auf der Kette passiert,
 * nicht was auf X geschrieben wird. Ein Thema wird hier erst sichtbar, wenn
 * mehrere Coins der gleichen Ecke tatsaechlich gekauft werden. Das ist
 * langsamer als der erste Tweet - aber es ist echt, und ein gekaufter
 * Trending-Platz kann es nicht faelschen.
 */

/**
 * Die Lexika. Zwei Sorten Treffer, weil Teilstring-Suche luegt:
 *   words - muss ein ganzes Wort sein. Fuer kurze, mehrdeutige Begriffe.
 *           "ai" wuerde sonst in "chain", "rain" und "captain" treffen.
 *   parts - darf irgendwo im Text stehen. Nur fuer lange, eindeutige
 *           Begriffe, bei denen ein Zufallstreffer praktisch ausgeschlossen
 *           ist ("pepe", "doge", "capybara").
 */
const SECTORS = [
  {
    key: "hund",
    label: "Hunde",
    words: ["dog", "inu", "shib", "wif", "bonk", "pup", "corgi", "husky", "pug", "beagle", "woof", "bark", "hound"],
    parts: ["doge", "shiba", "floki", "puppy", "poodle", "dachshund", "retriever", "chihuahua", "doggo"],
  },
  {
    key: "katze",
    label: "Katzen",
    words: ["cat", "kitty", "meow", "mew", "purr", "neko", "michi", "paw", "kat"],
    parts: ["popcat", "kitten", "feline", "tabby", "garfield", "catgirl", "mrmeow"],
  },
  {
    key: "frosch",
    label: "Froesche",
    words: ["pepe", "frog", "kek", "toad", "ribbit", "kermit"],
    parts: ["pepecoin", "froggy", "tadpole", "pepito"],
  },
  {
    key: "ki",
    label: "KI und Agenten",
    words: ["ai", "gpt", "agent", "bot", "llm", "gpu", "asi", "agi"],
    parts: ["neural", "robot", "android", "cyborg", "machine", "intellig", "openai", "deepseek", "claude", "grok", "singular", "compute", "inferenc"],
  },
  {
    key: "politik",
    label: "Politik",
    words: ["trump", "biden", "maga", "potus", "kamala", "putin", "vance", "gov", "senate", "vote"],
    parts: ["election", "president", "politic", "democrat", "republic", "congress", "campaign", "governor"],
  },
  {
    key: "essen",
    label: "Essen",
    words: ["pizza", "burger", "taco", "corn", "egg", "milk", "bread", "cheese", "soup", "rice", "cake", "ramen", "sushi", "fry", "bacon"],
    parts: ["banana", "coffee", "noodle", "donut", "burrito", "pancake", "sandwich", "chicken", "popcorn", "waffle", "spaghetti"],
  },
  {
    key: "affe",
    label: "Affen",
    words: ["ape", "monkey", "kong", "chimp", "bonobo"],
    parts: ["gorilla", "orangutan", "monke", "baboon", "primate"],
  },
  {
    key: "vogel",
    label: "Voegel",
    words: ["bird", "duck", "owl", "chick", "goose", "crow", "hawk", "swan"],
    parts: ["penguin", "pigeon", "parrot", "pelican", "flamingo", "toucan", "rooster"],
  },
  {
    key: "tier",
    label: "Andere Tiere",
    words: ["bear", "bull", "whale", "shark", "fish", "snake", "tiger", "lion", "panda", "goat", "wolf", "fox", "bee", "ant", "rat", "pig", "cow", "moo"],
    parts: ["capybara", "hamster", "otter", "sloth", "raccoon", "hippo", "giraffe", "dolphin", "octopus", "axolotl", "turtle", "koala", "possum", "ferret", "llama", "alpaca"],
  },
  {
    key: "weltraum",
    label: "Weltraum",
    words: ["moon", "mars", "rocket", "space", "star", "ufo", "alien", "orbit", "nasa", "sun"],
    parts: ["galaxy", "cosmos", "cosmic", "nebula", "asteroid", "satellite", "interstellar", "spacex", "lunar", "planet"],
  },
  {
    key: "kultur",
    label: "Meme-Kultur",
    words: ["chad", "wojak", "based", "sigma", "npc", "meme", "lol", "rekt", "cope", "gm", "wagmi", "ngmi", "fren", "anon", "degen"],
    parts: ["gigachad", "brainrot", "skibidi", "rizz", "doomer", "boomer", "zoomer", "normie", "sussy", "goblin"],
  },
  {
    key: "geld",
    label: "Geld und Zinsen",
    words: ["gold", "cash", "bank", "fed", "rich", "money", "debt", "rate", "bond", "yield", "tax", "imf"],
    parts: ["billion", "trillion", "inflation", "printer", "recession", "bailout", "treasury", "powell", "saylor"],
  },
  {
    key: "anime",
    label: "Anime",
    words: ["anime", "waifu", "chan", "kun", "senpai", "otaku", "manga", "uwu"],
    parts: ["pokemon", "pikachu", "naruto", "goku", "sailor", "totoro", "kawaii", "hentai"],
  },
  {
    key: "sport",
    label: "Sport",
    words: ["ufc", "nfl", "nba", "goal", "ball", "box", "gym", "run", "f1"],
    parts: ["football", "soccer", "olympic", "wrestl", "basket", "hockey", "cricket", "marathon", "messi", "ronaldo"],
  },
  {
    key: "mystik",
    label: "Religion und Mystik",
    words: ["god", "jesus", "satan", "angel", "devil", "buddha", "karma", "zen", "soul", "cult", "omen"],
    parts: ["heaven", "demon", "spirit", "prophet", "messiah", "apocalyp", "eternal", "divine"],
  },
];

/**
 * Text zu Woertern zerlegen - inklusive camelCase-Grenzen.
 *
 * Zusaetzlich wird an Buchstaben/Ziffern-Grenzen ein zweites Mal geteilt,
 * ABER das ungeteilte Wort bleibt erhalten. Grund: "ai16z" ist ein
 * KI-Coin, das erkennt man nur, wenn "ai" als eigenes Wort auftaucht -
 * und "f1" ist ein Sport-Coin, das erkennt man nur, wenn "f1" ganz
 * bleibt. Beide Formen zu behalten, loest beides.
 */
function tokenize(text) {
  const base = String(text || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const out = [];
  for (const word of base) {
    out.push(word);
    const parts = word.split(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/);
    if (parts.length > 1) {
      for (const part of parts) if (part) out.push(part);
    }
  }
  return out;
}

/**
 * Einem Coin seine Ecke zuweisen.
 * Rueckgabe: der Sektor-Key oder null, wenn nichts eindeutig passt.
 *
 * Ein Teilstring-Treffer ("capybara" in "CapybaraKing") zaehlt staerker als
 * ein Wort-Treffer ("cat"), weil er spezifischer ist. Bei Gleichstand
 * gewinnt der Sektor, der weiter oben in der Liste steht.
 */
function sectorOf(item) {
  const name = String((item && item.name) || "");
  const symbol = String((item && item.symbol) || "");
  const words = tokenize(name + " " + symbol);
  const flat = (name + symbol).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!words.length) return null;

  // Mehrzahl mitnehmen, aber schwaecher gewichten. "Cats" soll bei den
  // Katzen landen - aber wenn ein Coin "cat in a dogs world" heisst, muss
  // die Einzahl "cat" die Mehrzahl "dogs" schlagen. Sonst waere MEW ein
  // Hunde-Coin, und das waere er ziemlich sicher nicht.
  const singulars = new Set();
  for (const word of words) {
    if (word.length > 3 && word.charAt(word.length - 1) === "s") singulars.add(word.slice(0, -1));
  }

  let best = null;
  let bestWeight = 0;

  for (const sector of SECTORS) {
    let weight = 0;
    for (const part of sector.parts) {
      if (flat.indexOf(part) !== -1) {
        weight = 3;
        break;
      }
    }
    if (weight < 3) {
      for (const word of sector.words) {
        if (words.indexOf(word) !== -1) {
          weight = 2;
          break;
        }
      }
    }
    if (weight < 2) {
      for (const word of sector.words) {
        if (singulars.has(word)) {
          weight = 1.5;
          break;
        }
      }
    }
    if (weight > bestWeight) {
      bestWeight = weight;
      best = sector.key;
    }
  }
  return best;
}

function labelOf(key) {
  const hit = SECTORS.find((s) => s.key === key);
  return hit ? hit.label : null;
}

function median(numbers) {
  if (!numbers.length) return 0;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Mindestgroesse einer Ecke, damit sie ueberhaupt gemeldet wird.
 * Zwei Coins sind kein Thema, sondern zwei Coins.
 */
const MIN_MEMBERS = 3;

/**
 * Die Hitze einer Ecke, 0 bis 100.
 *
 * Der wichtigste Teil ist die BREITE - der Anteil der Mitglieder, die
 * tatsaechlich steigen. Ein Thema erkennt man nicht daran, dass einer
 * explodiert, sondern daran, dass viele mitlaufen. Deshalb macht die Breite
 * 55 der 100 Punkte aus, die Groesse der Bewegung nur 25 und der Anteil mit
 * anziehendem Volumen 20.
 */
function heatOfMembers(members) {
  const n = members.length;
  const moves = members.map((m) => (typeof m.priceChangeH1 === "number" ? m.priceChangeH1 : 0));
  const med = median(moves);
  const up = members.filter((m) => (m.priceChangeH1 || 0) > 3).length;
  const breadth = up / n;
  const surging = members.filter((m) => (m.volumeSurge || 0) >= 1.5).length / n;
  const moveScore = Math.max(0, Math.min(1, med / 25));

  const heat = Math.round(breadth * 55 + moveScore * 25 + surging * 20);
  return {
    heat: Math.max(0, Math.min(100, heat)),
    members: n,
    up: up,
    breadth: breadth,
    medianMoveH1: med,
    volumeH1: members.reduce((sum, m) => sum + (m.volumeH1 || 0), 0),
  };
}

/** Ab hier nennen wir eine Ecke "heiss". */
const HOT_THRESHOLD = 45;

/**
 * Nachzuegler: die Ecke laeuft, dieser Coin noch nicht.
 *
 * Bewusst KEIN Kaufsignal. Es gibt zwei Gruende, warum ein Coin in einem
 * heissen Thema noch nicht gelaufen ist: er kommt noch - oder der Markt hat
 * ihn bewusst links liegen lassen. Die App kann die beiden nicht
 * unterscheiden, also sagt sie das auch so.
 */
function laggardsOf(members, stats) {
  const ceiling = Math.max(6, stats.medianMoveH1 * 0.5);
  return members
    .filter((m) => {
      const move = m.priceChangeH1 || 0;
      if (move > ceiling) return false;
      if (move < -12) return false;
      if ((m.volumeSurge || 0) < 1.2) return false;
      if ((m.liquidityUsd || 0) < 15000) return false;
      return true;
    })
    .sort((a, b) => (b.volumeSurge || 0) - (a.volumeSurge || 0));
}

/**
 * Alle Coins einsortieren und die Ecken vermessen.
 *
 * Gibt zurueck:
 *   sectors  - alle Ecken mit genug Mitgliedern, nach Hitze sortiert
 *   byKey    - Nachschlagetabelle key -> Statistik
 */
function measure(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = item.sector || sectorOf(item);
    if (!key) continue;
    item.sector = key;
    item.sectorLabel = labelOf(key);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  const sectors = [];
  for (const [key, members] of groups) {
    if (members.length < MIN_MEMBERS) continue;
    const stats = heatOfMembers(members);
    const laggards = stats.heat >= HOT_THRESHOLD ? laggardsOf(members, stats) : [];
    const leaders = members
      .slice()
      .sort((a, b) => (b.priceChangeH1 || 0) - (a.priceChangeH1 || 0))
      .slice(0, 3);

    sectors.push({
      key: key,
      label: labelOf(key),
      heat: stats.heat,
      hot: stats.heat >= HOT_THRESHOLD,
      members: stats.members,
      up: stats.up,
      medianMoveH1: Math.round(stats.medianMoveH1 * 10) / 10,
      volumeH1: Math.round(stats.volumeH1),
      leaders: leaders.map((m) => ({ address: m.address, symbol: m.symbol, priceChangeH1: m.priceChangeH1 || 0 })),
      laggards: laggards.slice(0, 3).map((m) => ({
        address: m.address,
        symbol: m.symbol,
        priceChangeH1: m.priceChangeH1 || 0,
        volumeSurge: Math.round((m.volumeSurge || 0) * 10) / 10,
      })),
    });
  }

  sectors.sort((a, b) => b.heat - a.heat);

  const byKey = {};
  for (const s of sectors) byKey[s.key] = s;

  // Jeden Coin wissen lassen, wie heiss seine Ecke ist, und ob er darin
  // der Nachzuegler ist. Beides taucht spaeter auf der Karte auf.
  for (const item of items || []) {
    const stat = item.sector ? byKey[item.sector] : null;
    item.sectorHeat = stat ? stat.heat : null;
    item.sectorHot = stat ? stat.hot : false;
    item.sectorLaggard = !!(stat && stat.laggards.some((l) => l.address === item.address));
  }

  return { sectors: sectors, byKey: byKey };
}

/* ------------------------------------------------------------------ *
 * Wortwellen - Themen finden, die in keinem Lexikon stehen
 * ------------------------------------------------------------------ */

/**
 * Das Lexikon oben kennt fuenfzehn Ecken. Ein viraler Waschbaer aus
 * Seattle steht in keiner davon, und genau das ist das Problem: das
 * Naechste, was abgeht, hat noch keinen Namen, den irgendwer vorher
 * aufgeschrieben haette.
 *
 * Deshalb hier der umgekehrte Weg: nicht nach bekannten Worten suchen,
 * sondern zaehlen, welche Worte gerade AUFFAELLIG OFT in Coin-Namen
 * vorkommen. Tauchen fuenf Coins mit "raccoon" auf und gestern war
 * keiner dabei, dann ist das die Welle - ohne dass jemand vorher wissen
 * musste, dass es Waschbaeren sein wuerden.
 *
 * Das ist der Teil, der sich von selbst aktualisiert.
 */

/** Worte, die in Coin-Namen immer vorkommen und nichts bedeuten. */
const STOPWORDS = new Set([
  "coin", "token", "the", "and", "for", "with", "official", "meme", "memecoin",
  "solana", "sol", "pump", "fun", "network", "protocol", "finance", "labs",
  "capital", "money", "cash", "crypto", "chain", "swap", "dao", "app", "inc",
  "team", "club", "world", "life", "time", "day", "new", "old", "big", "little",
  "super", "mega", "ultra", "baby", "mini", "king", "queen", "lord", "god",
  "first", "last", "next", "real", "true", "best", "good", "bad", "top",
  "wrapped", "staked", "index", "vault", "fund", "trust", "group", "global",
  "www", "com", "net", "org", "https", "http",
]);

/** Alle bekannten Lexikon-Worte - die brauchen keine zweite Meldung. */
function knownVocabulary() {
  const set = new Set();
  for (const sector of SECTORS) {
    for (const word of sector.words) set.add(word);
    for (const part of sector.parts) set.add(part);
  }
  return set;
}

const KNOWN = knownVocabulary();

/** Die Worte eines Coins, gefiltert auf das, was ueberhaupt aussagekraeftig ist. */
function meaningfulWords(item) {
  const words = tokenize(String(item.name || "") + " " + String(item.symbol || ""));
  const out = new Set();
  for (const word of words) {
    if (word.length < 4 || word.length > 20) continue;
    if (/^[0-9]+$/.test(word)) continue;
    if (STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return Array.from(out);
}

/** Wie viele Coins mindestens ein Wort teilen muessen, damit es eine Welle ist. */
const WAVE_MIN_COINS = 3;

/**
 * Wortwellen finden.
 *
 * Neben der reinen Haeufigkeit zaehlt vor allem, ob die betroffenen Coins
 * JUNG sind. Fuenf alte Coins, die zufaellig alle "moon" heissen, sind
 * keine Welle - fuenf Coins von heute Nachmittag mit demselben Wort sehr
 * wohl. Deshalb geht das Medianalter in die Bewertung ein.
 *
 * Lexikon-Worte werden ausdruecklich MITGEZAEHLT: "raccoon" ist zwar
 * unter "Andere Tiere" bekannt, aber die Welle auf Wortebene ist die
 * genauere Aussage - "fuenf Waschbaeren" hilft mehr als "sieben Tiere".
 * Solche Treffer sind mit known:true markiert.
 *
 * @param items    die beobachteten Coins
 * @param options  { excludeKnown: Lexikon-Worte weglassen }
 */
function discoverWaves(items, options) {
  const opts = options || {};
  const groups = new Map();

  for (const item of items || []) {
    for (const word of meaningfulWords(item)) {
      if (opts.excludeKnown && KNOWN.has(word)) continue;
      const list = groups.get(word) || [];
      list.push(item);
      groups.set(word, list);
    }
  }

  const waves = [];
  for (const [word, members] of groups) {
    if (members.length < WAVE_MIN_COINS) continue;

    const stats = heatOfMembers(members);

    // Farm-Verdacht.
    //
    // Live beobachtet: drei Coins namens "leagle", alle exakt +0%, alle
    // drei Minuten alt. Das ist kein Thema, das ist ein Bot, der denselben
    // Token mehrfach mintet, um Suchlisten zu fluten. Erkennbar daran,
    // dass die Mitglieder tot sind: kein Umsatz, keine Kursbewegung.
    //
    // Eine echte Welle hat immer ein paar Mitglieder, in denen wirklich
    // gehandelt wird - selbst wenn der Rest Schrott ist.
    const dead = members.filter(
      (m) => (m.volumeH1 || 0) < 1000 && Math.abs(m.priceChangeH1 || 0) < 2,
    ).length;
    const farmSuspect = dead / members.length >= 0.7;

    const ages = members.map((m) => (m.ageMinutes == null ? null : m.ageMinutes)).filter((a) => a != null);
    const medianAge = ages.length ? median(ages) : null;
    const fresh = medianAge == null ? 0.5 : medianAge < 360 ? 1 : medianAge < 1440 ? 0.8 : medianAge < 10080 ? 0.5 : 0.25;

    // Staerke: wie viele Coins teilen das Wort, wie frisch sind sie, und
    // bewegt sich die Gruppe ueberhaupt. Alles drei muss stimmen.
    const size = Math.min(1, (members.length - 2) / 6);
    const raw = size * 45 + fresh * 30 + (stats.heat / 100) * 25;
    // Eine Farm wird nicht versteckt, aber deutlich abgewertet - sie soll
    // unter den echten Wellen stehen, nicht neben ihnen.
    const strength = Math.round(farmSuspect ? raw * 0.3 : raw);

    waves.push({
      word: word,
      coins: members.length,
      up: stats.up,
      medianMoveH1: Math.round(stats.medianMoveH1 * 10) / 10,
      medianAgeMinutes: medianAge == null ? null : Math.round(medianAge),
      volumeH1: Math.round(stats.volumeH1),
      strength: Math.max(0, Math.min(100, strength)),
      farmSuspect: farmSuspect,
      deadShare: Math.round((dead / members.length) * 100) / 100,
      known: KNOWN.has(word),
      examples: members
        .slice()
        .sort((a, b) => (b.volumeH1 || 0) - (a.volumeH1 || 0))
        .slice(0, 4)
        .map((m) => ({ address: m.address, symbol: m.symbol, name: m.name, priceChangeH1: m.priceChangeH1 || 0 })),
    });
  }

  waves.sort((a, b) => b.strength - a.strength);
  return waves;
}

module.exports = {
  sectorOf,
  measure,
  labelOf,
  tokenize,
  heatOfMembers,
  discoverWaves,
  meaningfulWords,
  SECTORS,
  STOPWORDS,
  MIN_MEMBERS,
  HOT_THRESHOLD,
  WAVE_MIN_COINS,
};
