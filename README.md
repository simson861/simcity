# SimCity 1989 – Nachbau

Ein möglichst originalgetreuer Nachbau des Stadtsimulators *SimCity* (Maxis, 1989) für den Browser –
reines HTML/JavaScript, ohne Abhängigkeiten, ohne Build-Schritt.

**Starten:** `index.html` im Browser öffnen (Doppelklick genügt). Alternativ über einen lokalen Webserver,
z. B. `npx serve .`.

## Umfang

Die Simulation folgt den Regeln des Originals (wie im später als „Micropolis“ veröffentlichten Quelltext):

- **Karte** 120 × 100 Felder, zufällig erzeugte Landschaft mit Flüssen, Seen, Wäldern (optional Insel)
- **Zonen** Wohnen / Gewerbe / Industrie (3 × 3) mit Wachstum nach Nachfrage (R/C/I-Anzeige), Bodenwert,
  Umweltverschmutzung, Verkehrsanbindung und Stromversorgung; Einzelhäuser, Dichtestufen, Krankenhäuser und Kirchen
- **Bauwerkzeuge** Bulldozer, Straße (Brücken), Schiene (Tunnel), Stromleitung (Unterwasserkabel), Park,
  Polizei, Feuerwehr, Stadion, Seehafen, Kohle- und Atomkraftwerk, Flughafen, Abfrage
- **Verkehr** Fahrtensimulation zwischen den Zonen, Staus, Verkehrshubschrauber
- **Strom** Netz über Leitungen und aneinandergrenzende Zonen, Kraftwerkskapazität (Kohle 700 / Atom 2000 Felder),
  blinkender Blitz bei unversorgten Zonen
- **Karten** Stadtplan, Zonen, Stromnetz, Verkehrsnetz, Bevölkerungsdichte, Wachstum, Verkehrsdichte,
  Umweltverschmutzung, Kriminalität, Bodenwert, Feuerwehr- und Polizei-Abdeckung
- **Grafiken** Wohnen, Gewerbe, Industrie, Geldfluss, Kriminalität, Umwelt (10 und 120 Jahre)
- **Haushalt** jährlich im Januar: Steuersatz 0–20 %, Mittel für Verkehr, Feuerwehr, Polizei; Auto-Budget;
  Straßenverfall bei Unterfinanzierung
- **Bewertung** Bürgerumfrage, größte Probleme, Einwohner, Zuwanderung, Grundstückswert, Stadtkategorie, Wertung 0–1000
- **Katastrophen** Feuer, Überschwemmung, Flugzeugabsturz, Tornado, Erdbeben, Monster, Kernschmelze
  (auch zufällig, abschaltbar), außerdem Zug- und Schiffsunglücke
- **Fahrzeuge** Zug, Hubschrauber, Flugzeug, Schiff
- **Szenarien** Dullsville 1900, San Francisco 1906, Hamburg 1944, Bern 1965, Tokio 1957, Detroit 1972,
  Boston 2010, Rio de Janeiro 2047 – mit Zielen und Fristen wie im Original
- **Optionen** Auto-Abriss, Auto-Budget, Auto-Gehe-zu, Ton; Tempo Pause/Langsam/Mittel/Schnell
- **Speichern/Laden** im Browser (localStorage) oder als Datei (Export/Import)
- Meldungen und Meilensteine (Kleinstadt, Stadt, Hauptstadt, Metropole, Megalopolis), Cheat „FUND“

## Bedienung

| Aktion | Eingabe |
|---|---|
| Bauen | Linksklick, Linien (Straße, Schiene, Leitung, Bulldozer, Park) durch Ziehen |
| Karte verschieben | Rechts-/Mittelklick + Ziehen, Pfeiltasten, Hand-Werkzeug, Klick in die Übersichtskarte |
| Zoomen | Mausrad, `+` / `−` |
| Pause | Leertaste |
| Fenster | `M` Karte, `G` Grafiken, `B` Haushalt, `E` Bewertung, `Esc` schließt |
| Werkzeuge | `B` Bulldozer, `Q` Abfrage, `R` Straße, `T` Schiene, `L` Leitung, `P` Park, `1`–`0` Zonen/Gebäude |

## Hinweise

- Sämtliche Grafiken und Klänge werden im Programm erzeugt; es werden keine Originaldateien verwendet.
- Die Szenario-Städte werden nachgebaut (passende Geografie und Problemlage), da die Original-Stadtdateien nicht vorliegen.
- *SimCity* ist eine Marke von Electronic Arts. Dies ist ein privates Fan-Projekt ohne Verbindung zu EA oder Maxis.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/core.js` | Konstanten, Zufall, Stadtzustand, Bauwerkzeuge, Speichern |
| `js/mapgen.js` | Landschaftsgenerator |
| `js/sim.js` | Simulation (Zonen, Verkehr, Strom, Umwelt, Kriminalität, Haushalt, Bewertung, Meldungen) |
| `js/sprites.js` | Fahrzeuge, Monster, Tornado, Explosionen, Katastrophen |
| `js/scenarios.js` | Die acht Szenarien |
| `js/gfx.js` | Prozedurale Pixelgrafik für Felder und Gebäude |
| `js/view.js` | Darstellung von Stadt und Übersichtskarte |
| `js/ui.js` | Menüs, Fenster, Dialoge |
| `js/sound.js` | Klangeffekte (WebAudio) |
| `js/main.js` | Start und Hauptschleife |
