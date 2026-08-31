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
  if (input.authoritiesKnown === false) {
    flags.push(
      flag(
        "authorities_unknown",
        "yellow",
        "Contract-Rechte nicht prüfbar",
        "Keine Quelle konnte sagen, ob Mint- und Freeze-Rechte abgeschaltet sind. Das ist die Frage, an der ein Rug hängt - ohne Antwort darauf ist der Rest des Berichts nur die halbe Geschichte.",
        18,
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
  } else if (h.topHoldersPctExternal != null) {
    // Ersatzwert von Jupiter. Wir wissen nicht sicher, ob dort Pools
    // herausgerechnet sind, deshalb bewusst weichere Schwellen und ein
    // eigener Flag-Name - keine falsche Präzision vortäuschen.
    if (h.topHoldersPctExternal > 45) {
      flags.push(flag("top_holders_ext_high", "yellow", "Top-Holder halten " + pct(h.topHoldersPctExternal) + " (Jupiter)", "Fremdwert, Pools womöglich mitgezählt - als Richtung lesen, nicht als exakte Zahl. Hoch genug, um vorsichtig zu sein.", 12));
    } else if (h.topHoldersPctExternal > 25) {
      flags.push(flag("top_holders_ext_mid", "yellow", "Top-Holder halten " + pct(h.topHoldersPctExternal) + " (Jupiter)", "Fremdwert von Jupiter. Grenzwertig konzentriert.", 6));
    } else {
      flags.push(flag("top_holders_ext_ok", "green", "Top-Holder halten " + pct(h.topHoldersPctExternal) + " (Jupiter)", "Nach Jupiters Zahlen breit gestreut.", 0));
    }
  } else if (!input.light) {
    flags.push(flag("top10_unknown", "info", "Holder-Verteilung nicht ermittelbar", "Weder eigener RPC noch Jupiter liefern die Verteilung. Ohne diese Zahl fehlt der wichtigste Rug-Filter - im Zweifel nicht kaufen.", 10));
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

  // Entscheidend ist nicht das Verhältnis allein, sondern ob DEIN Einsatz
  // wieder rauskommt. Ein etablierter Coin hat oft nur 0,3% Liquidität zur
  // Marktkapitalisierung und trotzdem einen Pool mit hunderttausenden Dollar -
  // da steigst du mit 0,2 SOL problemlos aus. Nur die Kombination aus dünnem
  // Verhältnis UND flachem Pool ist die Falle, vor der wir warnen wollen.
  const DEEP_POOL = 250000;
  if (m.liquidityToMcap != null) {
    const deep = (m.liquidityUsd || 0) >= DEEP_POOL;
    if (m.liquidityToMcap < 0.05 && deep) {
      flags.push(
        flag("liq_ratio_thin_deep", "info", "Liquidität " + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung", "Wenig im Verhältnis zur Bewertung, aber mit " + eur(m.liquidityUsd) + " im Pool kommst du mit normaler Positionsgröße raus.", 0),
      );
    } else if (m.liquidityToMcap < 0.02) {
      flags.push(flag("liq_thin", "red", "Liquidität nur " + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung", "Der Chart sieht nach viel Geld aus, im Pool liegen aber nur " + eur(m.liquidityUsd) + ". Klassische Falle.", 25));
    } else if (m.liquidityToMcap < 0.05) {
      flags.push(flag("liq_lowish", "yellow", "Dünne Liquidität (" + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung)", "Größere Verkäufe bewegen den Kurs stark. Position klein halten.", 12));
    } else {
      flags.push(flag("liq_ok", "green", "Liquidität trägt", eur(m.liquidityUsd) + " im Pool, " + pct(m.liquidityToMcap * 100) + " der Marktkapitalisierung.", 0));
    }
  }

  // Flacher Pool ist kein Betrugsmerkmal, sondern eine Grenze für die
  // Positionsgröße - deshalb bewusst milde bewertet und mit einem konkreten
  // Hinweis statt einer roten Flagge. (Unter $1.500 greift oben das K.-o.)
  if (m.liquidityUsd != null && m.liquidityUsd >= 1500) {
    if (m.liquidityUsd < 5000) {
      flags.push(flag("pool_very_shallow", "yellow", "Sehr flacher Pool (" + eur(m.liquidityUsd) + ")", "Nur Mini-Einsätze. Schon ein Verkauf im dreistelligen Bereich bewegt hier den Kurs spürbar.", 10));
    } else if (m.liquidityUsd < 15000) {
      flags.push(flag("pool_shallow", "info", "Flacher Pool (" + eur(m.liquidityUsd) + ")", "Handelbar, aber Position entsprechend klein halten - du bist bei größeren Beträgen dein eigener Gegenwind.", 4));
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

  // ---------- Echtes gegen künstliches Volumen ----------
  //
  // Der wichtigste Filter, den wir haben. Jupiter trennt organischen Umsatz
  // von dem, was Bots untereinander hin- und herschieben. Ein Coin, dessen
  // Umsatz zu 97 % aus Wash-Trading besteht, sieht im Chart aus wie Nachfrage
  // und ist in Wirklichkeit eine Bühne, auf der du das Publikum bist.
  const org = input.organic || {};
  if (org.shareH1 != null && (m.volume && m.volume.h1) > 3000) {
    const share = org.shareH1 * 100;
    if (org.shareH1 < 0.03) {
      flags.push(flag("wash_extreme", "red", "Nur " + share.toFixed(1) + "% echtes Volumen", "Der Rest sind Bots, die sich gegenseitig handeln. Der Umsatz im Chart ist keine Nachfrage - er ist Kulisse.", 22));
    } else if (org.shareH1 < 0.1) {
      flags.push(flag("wash_high", "yellow", "Nur " + share.toFixed(1) + "% echtes Volumen", "Überwiegend Bot-Umsatz. Es kann trotzdem laufen, aber die Zahlen im Chart bedeuten weniger, als sie aussehen.", 10));
    } else if (org.shareH1 >= 0.3) {
      flags.push(flag("organic_volume", "green", share.toFixed(0) + "% echtes Volumen", "Ungewöhnlich hoher Anteil echter Trades - hier kaufen tatsächlich Menschen.", 0));
    }
  }

  if (org.scoreLabel === "high") {
    flags.push(flag("organic_high", "green", "Jupiter-Qualität: hoch", "Jupiters eigene, bot-bereinigte Bewertung der Handelsaktivität ist hoch.", 0));
  } else if (org.scoreLabel === "low" && age != null && age > 60) {
    flags.push(flag("organic_low", "yellow", "Jupiter-Qualität: niedrig", "Die bot-bereinigte Aktivität ist schwach - wenig echtes Interesse hinter den Zahlen.", 5));
  }

  if (org.holderChangeH1 != null) {
    if (org.holderChangeH1 < -15) {
      flags.push(flag("holders_leaving", "red", Math.round(org.holderChangeH1) + "% Holder in einer Stunde weg", "Die Leute steigen aus. Wer jetzt kauft, kauft von ihnen.", 15));
    } else if (org.holderChangeH1 > 50) {
      flags.push(flag("holders_growing", "green", "+" + Math.round(org.holderChangeH1) + "% Holder in einer Stunde", "Es kommen echte neue Halter dazu, nicht nur Umsatz.", 0));
    }
  }

  if (input.isToken2022) {
    flags.push(flag("token2022", "info", "Token-2022-Standard", "Dieser Standard erlaubt Zusatzfunktionen wie Übertragungsgebühren. Bei pump.fun-Coins normal, aber ein Grund, den ersten Verkauf klein zu testen.", 0));
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
  if (fatalFlag) return "Finger weg — " + fatalFlag.title + ".";
  if (verdict === "avoid") {
    const rest = reds.length - 1;
    const extra = rest === 1 ? " (und ein weiterer roter Punkt)." : rest > 1 ? " (und " + rest + " weitere rote Punkte)." : ".";
    return reds.length
      ? "Nicht kaufen. Hauptproblem: " + reds[0].title + extra
      : "Zu viele Schwächen auf einmal - lass ihn liegen.";
  }
  if (verdict === "caution") {
    const worst = flags.find((f) => f.level === "red") || flags.find((f) => f.level === "yellow");
    return "Handelbar, aber nur mit kleinem Einsatz. Achte auf: " + (worst ? worst.title : "die gelben Punkte") + ".";
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
