# SONAR

Landingpage und internes Terminal für die Signal- und Discovery-Schicht für Solana-Memecoins.

- **`/`** — öffentliche Landingpage (`index.html`)
- **`/app`** — das interne Werkzeug (`app.html`), passwortgeschützt, `noindex`

## Was das Terminal tut

**Scanner** (`/api/scan`) — Adresse oder pump.fun-Link einfügen, in wenigen Sekunden kommt zurück:

- Marktdaten aus allen Pools des Tokens (Preis, Marktkapitalisierung, Liquidität, Volumen, Kauf-/Verkaufsdruck)
- **Holder-Verteilung mit herausgerechneten Pools.** Der entscheidende Teil: die größten „Holder" eines pump.fun-Coins sind die Bonding Curve und der AMM-Pool. Wer die mitzählt, sieht bei jedem frischen Coin „ein Wallet hält 79 %" und der Indikator ist wertlos. Jedes Token-Konto wird zu seinem Besitzer aufgelöst und geprüft, ob dieser Besitzer selbst einem bekannten AMM-Programm gehört. Nur der Rest ist Streubesitz.
- Mint- und Freeze-Authority, LP-Sperre
- Rugcheck-Einzelrisiken (nicht deren Score — nur die einzelnen Punkte, selbst bewertet)
- **Score 0–100 mit vollständiger Begründung.** Jeder Punktabzug hängt an einem Flag im Klartext. `100 − Summe der Abzüge = Score`, nachrechenbar.
- Einordnung, ob der Coin zu Strategie A (defensiv) oder B (frisch) passt — inklusive der konkreten Gründe, warum nicht

**Radar** (`/api/feed`) — neue und heiß laufende Token, gefiltert nach Liquidität, Alter, Volumen, Phase und Score. Presets für beide Strategien.

**Watchlist** — lokal im Browser, wird bei jedem Öffnen neu geprüft.

**Alerts** (`/api/alerts`) — Treffer nach Telegram, getaktet über GitHub Actions.

### Was der Score nicht kann

Er misst, wie wahrscheinlich man bei einem Coin *strukturell* verliert: kein Ausstieg wegen dünner Liquidität, Dev mit zu großem Sack, Wash-Volumen, aktive Mint-Rechte. Er sagt **nicht** voraus, ob ein Coin steigt. 90 Punkte und trotzdem auf null ist der Normalfall in dieser Anlageklasse.

## Aufbau

```
index.html              Landingpage (unverändert)
app.html                Terminal-Oberfläche, eine Datei, kein Build
api/
  login.js              POST, prüft das gemeinsame Passwort
  scan.js               GET  /api/scan?address=…
  feed.js               GET  /api/feed?minLiquidity=…&stage=…
  alerts.js             GET  /api/alerts?secret=…  (für den Zeitplan)
  _lib/
    auth.js             Passwortprüfung (gesalzener Hash, zeitkonstanter Vergleich)
    http.js             Fetch mit Timeout, Retry, Cache, Parallelitätsgrenze
    dexscreener.js      Marktdaten, Phasenerkennung, Alter
    rugcheck.js         Contract-Risiken
    solana.js           RPC: Authorities und Holder-Verteilung ohne Pools
    score.js            Bewertung und Strategie-Einordnung
    scan.js             setzt einen vollständigen Report zusammen
    feed.js             Radar-Liste mit leichter Bewertung
scripts/selftest.js     Selbsttest ohne Netzwerk
```

Kein Build, keine Abhängigkeiten, kein `package.json`. Vercel erkennt den `api/`-Ordner und deployt die Dateien als Node-Functions; alles andere wird statisch ausgeliefert.

## Zugang

Ein gemeinsames Passwort für alle Endpunkte. Im Repository liegt nur ein gesalzener SHA-256-Hash (`api/_lib/auth.js`) — das Repo ist öffentlich, deshalb ist das Passwort lang und zufällig.

Passwort ändern, ohne Code anzufassen: in Vercel die Variable `SONAR_PASSWORD` setzen, sie hat Vorrang vor dem Hash. Oder den Hash ersetzen:

```bash
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('<SALT aus auth.js>'+'<neues Passwort>').digest('hex'))"
```

## Environment-Variablen (alle optional)

| Variable | Wofür | Ohne sie |
|---|---|---|
| `SOLANA_RPC` | eigener RPC, z. B. ein kostenloser Helius-Key | öffentlicher Endpunkt, drosselt `getTokenLargestAccounts` — die Holder-Verteilung fehlt dann öfter |
| `SONAR_PASSWORD` | Passwort ohne Code-Änderung überschreiben | der Hash in `auth.js` gilt |
| `TELEGRAM_BOT_TOKEN` | Bot vom BotFather | Alerts antworten mit Fehler |
| `TELEGRAM_CHAT_ID` | Ziel-Chat oder Gruppe | dito |
| `SONAR_CRON_SECRET` | schützt `/api/alerts` | der Endpunkt bleibt gesperrt |

Für die Alerts zusätzlich das Repository-Secret `SONAR_CRON_SECRET` in GitHub setzen (Settings → Secrets and variables → Actions), damit `.github/workflows/sonar-alerts.yml` den Endpunkt aufrufen darf.

## Telegram einrichten

1. In Telegram `@BotFather` anschreiben, `/newbot`, Namen vergeben → Token kommt zurück.
2. Den Bot in die eigene Gruppe einladen (oder ihm direkt schreiben).
3. Chat-ID holen: `https://api.telegram.org/bot<TOKEN>/getUpdates` aufrufen, nachdem im Chat eine Nachricht geschrieben wurde. Die `chat.id` steht in der Antwort.
4. `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` in Vercel eintragen, `SONAR_CRON_SECRET` in Vercel **und** in den GitHub-Secrets.
5. Testlauf: Actions → „SONAR Alerts" → *Run workflow* mit `dry = 1`. Es wird nichts gesendet, aber die Treffer stehen im Log.

## Tests

```bash
node scripts/selftest.js
```

Läuft ohne Netzwerk, ersetzt `fetch` durch Fixtures und prüft die gesamte Kette — insbesondere, dass die Bonding Curve aus der Holder-Rechnung fällt und dass eine aktive Mint-Authority den Coin unabhängig vom Score auf „nicht kaufen" setzt.

## Datenquellen

DexScreener (Marktdaten, Profile, Boosts), Rugcheck (Contract-Risiken), öffentliches Solana-RPC. Alle kostenlos und alle mit Rate-Limits — jede Quelle darf einzeln ausfallen, der Report weist das dann in `sources` und `warnings` aus.

Kein vollständiger Launch-Stream: DexScreener bietet keinen offenen „alle neuen Paare"-Endpunkt. Der Radar arbeitet mit den zuletzt aktualisierten Token-Profilen und den gebuchten Boosts — also mit dem, was gerade Aufmerksamkeit einsammelt.

## Rechtliches

Keine Anlageberatung. Der Handel mit Memecoins führt bei der Mehrheit der Teilnehmer zu Verlusten.

## Lizenz

MIT
