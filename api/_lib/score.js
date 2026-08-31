"use strict";
/**
 * Die Bewertungs-Engine.
 *
 * Grundsatz: KEIN Blackbox-Score. Jeder Punkt Abzug hängt an einem Flag mit
 * Klartext-Begründung und den konkreten Zahlen. Ein Score, den man nicht
 * nachrechnen kann, ist beim Traden wertlos - man glaubt ihm entweder blind
 * oder gar nicht.
 *
 * Zwei Ebenen:
 *  - fatale Flags  -> Verdikt "avoid", egal wie hoch der Rest ist
 *  - Abzüge       -> Score 100 abwärts
 *
 * Der Score misst NICHT, ob der Coin steigt. Er misst, wie wahrscheinlich du
 * bei diesem Coin strukturell verlierst (kein Ausstieg, Dev dumpt, Wash-Volumen).
 * Ein Coin mit 90 Punkten kann trotzdem auf null gehen.
 */

const FATAL = true;

function flag(id, level, title, detail, penalty, fatal) {
  return { id: id, level: level, title: title, detail: detail, penalty: penalty || 0, fatal: !!fatal };
}

const eur = (n) =>
  n == null
    ? "unbekannt"
    : n >= 1e6
      ? "$" + (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? "$" + Math.round(n / 100) / 10 + "k"
        : "$" + Math.round(n);

const pct = (n) => (n == null ? "unbekannt" : n.toFixed(1) + "%");

/**
 * @param {object} input
 *   market, holders, authorities, socials, stage, ageMinutes, rugcheck
 * @returns {{flags:Array, score:number, verdict:string, summary:string}}
 */
function evaluate(input) {
  const m = input.market || {};
  const h = input.holders || {};
  const a = input.authorities || {};
  const s = input.socials || {};
  const rc = input.rugcheck || null;
  const age = input.ageMinutes;
  const stage = input.stage;
  const flags = [];

  // ---------- K.-o.-Kriterien ----------

  if (a.mintAuthority) {
    flags.push(
      flag(
        "mint_authority",
        "red",
        "Mint-Authority ist aktiv",
        "Der Ersteller kann jederzeit beliebig viele neue Token drucken und deinen Anteil wertlos machen. Bei sauberen pump.fun-Coins ist das immer abgeschaltet.",
        60,
        FATAL,
      ),
    );
  }
  if (a.freezeAuthority) {
    flags.push(
      flag(
        "freeze_authority",
        "red",
        "Freeze-Authority ist aktiv",
        "Deine Token können eingefroren werden - du kannst dann nicht mehr verkaufen, während andere es können.",
        60,
        FATAL,
      ),
    );
  }
  if (rc && rc.rugged) {
    flags.push(flag("rugged", "red", "Rugcheck meldet: bereits gerugged", "Finger weg.", 80, FATAL));
  }
  if (m.liquidityUsd != null && m.liquidityUsd < 1500) {
    flags.push(
      flag(
        "no_liquidity",
        "red",
        "Praktisch keine Liquidität",
        "Nur " + eur(m.liquidityUsd) + " im Pool. Bei dieser Tiefe frisst dein eigener Verkauf den Kurs auf - du kommst nicht raus.",
        50,
        FATAL,
      ),
    );
  }
  if (h.topHolderPct != null && h.topHolderPct > 30) {
    flags.push(
      flag(
        "whale",
        "red",
        "Ein Wallet hält " + pct(h.topHolderPct),
        "Ohne Pools gerechnet. Diese eine Adresse kann dich alleine begraben.",
        45,
        FATAL,
      ),
    );
  }

  // ---------- Verteilung ----------

  if (h.top10Pct != null) {
    if (h.top10Pct > 40) {
      flags.push(
        flag("top10_extreme", "red", "Top 10 halten " + pct(h.top10Pct), "Ohne Pools gerechnet. Das ist keine Community, das ist eine Gruppe mit einem Ausgang.", 30),
      );
    } else if (h.top10Pct > 25) {
      flags.push(flag("top10_high", "yellow", "Top 10 halten " + pct(h.top10Pct), "Konzentriert. Über 25% ist die Grenze, ab der ein abgestimmter Verkauf dich voll trifft.", 16));
    } else if (h.top10Pct > 15) {
      flags.push(flag("top10_mid", "yellow", "Top 10 halten " + pct(h.top10Pct), "Grenzwertig, aber im Rahmen für einen jungen Coin.", 7));
    } else {
      flags.push(flag("top10_ok", "green", "Breite Verteilung", "Top 10 halten nur " + pct(h.top10Pct) + " des frei handelbaren Angebots.", 0));
    }
  } else if (!input.light) {
    flags.push(flag("top10_unknown", "info", "Holder-Verteilung nicht ermittelbar", "Der RPC hat nicht geantwortet. Ohne diese Zahl fehlt der wichtigste Rug-Filter - im Zweifel nicht kaufen.", 10));
  }

  if (h.creatorPct != null && h.creatorPct > 5) {
    flags.push(
      flag("creator_bag", h.creatorPct > 12 ? "red" : "yellow", "Ersteller hält " + pct(h.creatorPct), "Je größer der Sack des Devs, desto größer sein Anreiz, dir zu verkaufen.", h.creatorPct > 12 ? 25 : 12),
    );
  }

  if (h.totalHolders != null) {
    if (h.totalHolders < 50) {
      flags.push(flag("few_holders", "yellow", "Nur " + h.totalHolders + " Holder", "Zu dünn: der Preis hängt an einer Handvoll Leuten.", 12));
    } else if (h.totalHolders > 500) {
      flags.push(flag("many_holders", "green", h.totalHolders + " Holder", "Breite Beteiligung.", 0));
    }
  }

  // ---------- Liquidität und Ausstiegsfähigkeit ----------

  if (m.liquidityToMcap != null) {
    if (m.liquidityToMcap < 0.02) {
      flags.push(flag("liq_thin", "red", "Liquidität nur " + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung", "Der Chart sieht nach viel Geld aus, im Pool liegt aber fast nichts. Klassische Falle.", 25));
    } else if (m.liquidityToMcap < 0.05) {
      flags.push(flag("liq_lowish", "yellow", "Dünne Liquidität (" + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung)", "Größere Verkäufe bewegen den Kurs stark. Position klein halten.", 12));
    } else {
      flags.push(flag("liq_ok", "green", "Liquidität trägt", eur(m.liquidityUsd) + " im Pool, " + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung.", 0));
    }
  }

  // ---------- Handelsaktivität ----------

  if (m.volumeToLiquidity != null) {
    if (m.volumeToLiquidity > 60) {
      flags.push(flag("churn_extreme", "red", "Umschlag " + m.volumeToLiquidity.toFixed(0) + "x der Liquidität", "So viel Volumen bei so wenig Pool ist typisch für Bots, die sich gegenseitig handeln, um Aufmerksamkeit zu kaufen.", 20));
    } else if (m.volumeToLiquidity > 25) {
      flags.push(flag("churn_high", "yellow", "Hoher Umschlag (" + m.volumeToLiquidity.toFixed(0) + "x)", "Kann echtes Momentum sein, kann Wash-Trading sein. Sieh dir das Kauf/Verkauf-Verhältnis an.", 8));
    }
  }

  if (m.buySellRatioH1 != null) {
    if (m.buySellRatioH1 < 0.6) {
      flags.push(flag("sell_pressure", "red", "Verkaufsdruck: " + m.buySellRatioH1.toFixed(2) + " Käufe je Verkauf", "In der letzten Stunde wird deutlich mehr verkauft als gekauft. Du wärst der Ausgang.", 18));
    } else if (m.buySellRatioH1 < 0.9) {
      flags.push(flag("sell_lean", "yellow", "Leichter Verkaufsdruck (" + m.buySellRatioH1.toFixed(2) + ")", "Mehr Verkäufe als Käufe in der letzten Stunde.", 7));
    } else if (m.buySellRatioH1 > 1.4) {
      flags.push(flag("buy_pressure", "green", "Kaufdruck (" + m.buySellRatioH1.toFixed(2) + " Käufe je Verkauf)", "Mehr Käufer als Verkäufer in der letzten Stunde.", 0));
    }
  }

  const txH1 = (m.txns && m.txns.h1 && m.txns.h1.buys + m.txns.h1.sells) || 0;
  if (age != null && age > 60 && txH1 < 10) {
    flags.push(flag("dead", "red", "Kaum noch Handel", "Nur " + txH1 + " Trades in der letzten Stunde. Der Coin ist durch.", 22));
  }

  // ---------- Alter und Phase ----------

  if (age != null) {
    if (age < 10) {
      flags.push(flag("brand_new", "yellow", "Erst " + age + " Minuten alt", "Es gibt schlicht noch keine Daten, an denen man irgendetwas prüfen könnte. Das ist reines Wetten.", 14));
    } else if (age < 60) {
      flags.push(flag("very_new", "yellow", "Erst " + age + " Minuten alt", "Zu jung für eine belastbare Beurteilung. Nur mit Mini-Einsatz.", 7));
    } else if (age > 1440) {
      flags.push(flag("survived", "green", "Über " + Math.round(age / 60) + " Stunden alt", "Hat den ersten Tag überlebt - das schafft die große Mehrheit nicht.", 0));
    }
  }

  if (stage === "bonding_curve") {
    flags.push(flag("curve", "yellow", "Noch auf der Bonding Curve", "Nicht migriert. Der Großteil dieser Coins erreicht die Graduation nie und geht auf null.", 10));
  } else if (stage === "graduated") {
    flags.push(flag("graduated", "green", "Migriert (graduated)", "Der Coin hat die Kurve verlassen und handelt in einem echten Pool.", 0));
  }

  if (rc && rc.lpLockedPct != null && stage === "graduated") {
    if (rc.lpLockedPct < 50) {
      flags.push(flag("lp_unlocked", "red", "LP nur zu " + pct(rc.lpLockedPct) + " gesperrt", "Der Rest der Liquidität kann jederzeit abgezogen werden.", 25));
    } else {
      flags.push(flag("lp_locked", "green", "LP zu " + pct(rc.lpLockedPct) + " gesperrt/verbrannt", "Liquidität kann nicht einfach abgezogen werden.", 0));
    }
  }

  // ---------- Aussenwahrnehmung ----------

  if (!s.twitter && !s.telegram && !s.website) {
    flags.push(flag("no_socials", "yellow", "Keine Social-Links hinterlegt", "Kein X, kein Telegram, keine Seite. Ohne Aufmerksamkeit passiert bei einem Memecoin nichts.", 10));
  }
  if (s.activeBoosts > 0 && age != null && age < 180) {
    flags.push(flag("paid_boost", "yellow", s.activeBoosts + " bezahlte DexScreener-Boosts", "Jemand kauft Aufmerksamkeit für einen sehr jungen Coin. Das ist Marketing, kein Qualitätsmerkmal.", 6));
  }

  if (m.priceChange && m.priceChange.h1 > 250 && age != null && age < 180) {
    flags.push(flag("parabolic", "yellow", "+" + Math.round(m.priceChange.h1) + "% in einer Stunde", "Senkrechter Chart. Wer jetzt kauft, kauft von denen, die vorher drin waren.", 8));
  }

  // ---------- Rugcheck-Einzelrisiken ----------

  const seen = new Set();
  if (rc && rc.risks) {
    for (const r of rc.risks) {
      const key = r.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Nicht doppelt bestrafen, was wir oben schon selbst geprüft haben.
      if (/mint authority|freeze authority/i.test(r.name)) continue;
      if (/top 10|holder/i.test(r.name) && h.top10Pct != null) continue;
      if (/low liquidity|liquidity/i.test(r.name) && m.liquidityUsd != null) continue;
      const danger = r.level === "danger";
      flags.push(
        flag(
          "rc_" + key.replace(/[^a-z0-9]+/g, "_"),
          danger ? "red" : "yellow",
          "Rugcheck: " + r.name,
          r.description || "",
          danger ? 14 : 5,
        ),
      );
    }
  }

  // ---------- Zusammenrechnen ----------

  const fatal = flags.some((f) => f.fatal);
  const penalties = flags.reduce((sum, f) => sum + f.penalty, 0);
  let score = Math.max(0, Math.min(100, 100 - penalties));
  if (fatal) score = Math.min(score, 12);

  const verdict = fatal || score < 45 ? "avoid" : score < 70 ? "caution" : "ok";

  flags.sort((a, b) => {
    const rank = { red: 0, yellow: 1, info: 2, green: 3 };
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
    return b.penalty - a.penalty;
  });

  return { flags: flags, score: score, verdict: verdict, summary: summarize(verdict, flags, input) };
}

function summarize(verdict, flags, input) {
  const reds = flags.filter((f) => f.level === "red");
  const fatalFlag = flags.find((f) => f.fatal);
  if (fatalFlag) return "Finger weg: " + fatalFlag.title.toLowerCase() + ".";
  if (verdict === "avoid") {
    return reds.length
      ? "Nicht kaufen. Hauptproblem: " + reds[0].title.toLowerCase() + (reds.length > 1 ? " (und " + (reds.length - 1) + " weitere rote Punkte)." : ".")
      : "Zu viele Schwächen auf einmal - lass ihn liegen.";
  }
  if (verdict === "caution") {
    const worst = flags.find((f) => f.level === "red") || flags.find((f) => f.level === "yellow");
    return "Handelbar, aber nur mit kleinem Einsatz. Achte auf: " + (worst ? worst.title.toLowerCase() : "die gelben Punkte") + ".";
  }
  const stage = input.stage === "graduated" ? "Migriert" : "Noch auf der Kurve";
  return stage + ", saubere Verteilung, tragfähige Liquidität. Das heißt nicht, dass er steigt - nur, dass die üblichen Fallen fehlen.";
}

/**
 * Passt der Coin zu Strategie A (defensiv) oder B (aggressiv)?
 * Die Schwellen sind bewusst hart. Ein Filter, der alles durchlässt,
 * ist kein Filter.
 */
function strategyFit(input, score, verdict) {
  const m = input.market || {};
  const h = input.holders || {};
  const age = input.ageMinutes;
  const defensiveBlockers = [];
  const aggressiveBlockers = [];

  if (input.stage !== "graduated") defensiveBlockers.push("noch nicht migriert");
  if (age == null || age < 1440) defensiveBlockers.push("jünger als 24 Stunden");
  if (!(m.liquidityUsd >= 30000)) defensiveBlockers.push("Liquidität unter $30k");
  if (!(m.volume && m.volume.h24 >= 50000)) defensiveBlockers.push("24h-Volumen unter $50k");
  if (h.top10Pct == null || h.top10Pct > 25) defensiveBlockers.push("Top 10 über 25% oder unbekannt");
  if (verdict !== "ok") defensiveBlockers.push("Score unter 70");

  if (!(m.liquidityUsd >= 5000)) aggressiveBlockers.push("Liquidität unter $5k");
  if (age != null && age > 720) aggressiveBlockers.push("älter als 12 Stunden - kein frisches Momentum");
  if (h.top10Pct != null && h.top10Pct > 30) aggressiveBlockers.push("Top 10 über 30%");
  if (m.buySellRatioH1 != null && m.buySellRatioH1 < 0.8) aggressiveBlockers.push("mehr Verkäufe als Käufe");
  if (verdict === "avoid") aggressiveBlockers.push("rote Flags");

  return {
    defensive: defensiveBlockers.length === 0,
    aggressive: aggressiveBlockers.length === 0,
    defensiveBlockers: defensiveBlockers,
    aggressiveBlockers: aggressiveBlockers,
  };
}

module.exports = { evaluate, strategyFit };
