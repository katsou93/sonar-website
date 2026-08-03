# SONAR — Landingpage

Statische Landingpage für **SONAR**, die Signal- und Discovery-Schicht für Solana-Memecoins.

**Live:** https://DEIN-USERNAME.github.io/sonar-website/

---

## Was ist SONAR?

Kein Trading-Terminal, sondern die Schicht **davor**: SONAR erkennt Memecoin-Narrative auf X und
Telegram, während sie entstehen, prüft Token automatisch auf Rug-Risiko und erklärt in Klartext,
warum sich gerade etwas bewegt. Ein Screen statt acht Tabs.

Wir führen keine Trades aus, verbinden uns nicht mit Wallets und verwahren nichts.

## Inhalt des Repos

```
index.html                  Komplette Landingpage (Single File, kein Build nötig)
404.html                    Fehlerseite
assets/og-image.png         Vorschaubild für X, Telegram, WhatsApp (1200×630)
robots.txt / sitemap.xml    SEO-Basics
.nojekyll                   Verhindert Jekyll-Verarbeitung auf GitHub Pages
.github/workflows/deploy.yml  Automatisches Deployment bei jedem Push auf main
```

Keine Abhängigkeiten, kein Build-Schritt, kein npm. `index.html` ist vollständig eigenständig —
HTML, CSS und JavaScript in einer Datei. Zum Ansehen einfach doppelklicken.

## Lokal öffnen

```bash
open index.html          # macOS
start index.html         # Windows
```

Oder mit lokalem Server:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Deployment

Jeder Push auf `main` löst automatisch ein Deployment über GitHub Pages aus
(siehe `.github/workflows/deploy.yml`). Einmalig muss in den Repo-Einstellungen unter
**Settings → Pages → Source** die Option **GitHub Actions** ausgewählt werden.

### Eigene Domain

1. Datei `CNAME` im Repo-Root anlegen, Inhalt: `sonar.fun` (nur die Domain, keine Leerzeichen)
2. Beim Domain-Anbieter einen `CNAME`-Eintrag auf `DEIN-USERNAME.github.io` setzen
3. In **Settings → Pages** die Domain eintragen und **Enforce HTTPS** aktivieren

## Anpassen

| Was | Wo |
|---|---|
| Name „SONAR" | Suchen & Ersetzen in `index.html`, `README.md`, `assets/og-image.png` neu erzeugen |
| Farben | CSS-Variablen ganz oben im `<style>`-Block (`--grn`, `--prp`, `--bg` …) |
| Texte | Direkt im HTML, alle Abschnitte sind kommentiert (`<!-- ============ HERO ============ -->`) |
| Preise | Abschnitt `<section id="preise">` |
| FAQ | Abschnitt `<section id="faq">` |

## Wichtig vor dem echten Launch

- [ ] **Impressum, Datenschutzerklärung und AGB** ergänzen — in Deutschland Pflicht, sonst Abmahnrisiko
- [ ] E-Mail-Formular an einen echten Dienst anbinden (Formspree, Buttondown, ConvertKit o. ä.)
- [ ] Statistiken einbauen (Plausible oder Umami — DSGVO-freundlicher als Google Analytics)
- [ ] Alle Beispieldaten sind **erfunden** und dienen nur der Illustration
- [ ] Domain und Social-Handles sichern

## Rechtlicher Hinweis

SONAR ist ein reines Informations- und Analysewerkzeug. Keine Anlageberatung, keine
Anlagevermittlung, keine Vermögensverwaltung, keine Kauf- oder Verkaufsempfehlungen und keine
Ausführung von Transaktionen. Der Handel mit Memecoins ist hochspekulativ; der Totalverlust des
eingesetzten Kapitals ist der statistische Regelfall.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
