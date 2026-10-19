# Online-Funktionen einrichten

Für die Google-Anmeldung, Cloud-Spielstände, die Region mit Bestenliste und gemeinsame Städte nutzt das Spiel
**Firebase** (Authentication + Realtime Database) von Google. Der kostenlose Tarif „Spark“ reicht für private Runden.
Ohne Einrichtung läuft das Spiel weiterhin komplett offline.

Die Einrichtung ist einmalig und dauert etwa 10 Minuten.

## 1. Firebase-Projekt anlegen

1. <https://console.firebase.google.com> öffnen und mit deinem Google-Konto anmelden.
2. **Projekt hinzufügen** → Namen eingeben (z. B. `simcity-nachbau`) → Google Analytics kann aus bleiben → **Projekt erstellen**.

## 2. Google-Anmeldung aktivieren

1. Links **Build → Authentication** → **Jetzt starten**.
2. Reiter **Anmeldemethode** → **Google** → **Aktivieren**, Support-E-Mail auswählen → **Speichern**.
3. Reiter **Einstellungen → Autorisierte Domains** → **Domain hinzufügen** → `simson861.github.io` eintragen.
   (`localhost` ist schon eingetragen und reicht zum lokalen Testen.)

## 3. Datenbank anlegen und absichern

1. Links **Build → Realtime Database** → **Datenbank erstellen**.
2. Standort **Belgien (europe-west1)** wählen → **Im gesperrten Modus starten** → **Aktivieren**.
3. Reiter **Regeln**: den gesamten Inhalt durch den Inhalt der Datei [`firebase/database.rules.json`](firebase/database.rules.json)
   ersetzen → **Veröffentlichen**.
   Die Regeln sorgen dafür, dass jeder nur seine eigenen Spielstände lesen und schreiben kann und nur der Gastgeber
   einer gemeinsamen Stadt deren Zustand ändern darf.

## 4. Web-App registrieren und Konfiguration eintragen

1. Zahnrad oben links → **Projekteinstellungen** → Reiter **Allgemein** → unten bei „Meine Apps“ auf **`</>`** (Web) klicken.
2. Spitznamen eingeben (z. B. `simcity`), **Firebase Hosting nicht** ankreuzen → **App registrieren**.
3. Es erscheint ein Code-Block mit `const firebaseConfig = { … }`. Diese Werte in [`js/firebase-config.js`](js/firebase-config.js)
   statt `null` eintragen:

   ```js
   const FIREBASE_CONFIG = {
     apiKey: '…',
     authDomain: '…firebaseapp.com',
     databaseURL: 'https://…europe-west1.firebasedatabase.app',
     projectId: '…',
     appId: '…',
   };
   ```

   Wichtig ist `databaseURL` – falls sie im Code-Block fehlt, steht sie oben auf der Seite **Realtime Database**.
   Diese Werte sind nicht geheim; sie dürfen öffentlich im Repository stehen.

Alternativ kannst du die Werte auch Claude schicken, dann trägt Claude sie ein.

## 5. Spiel veröffentlichen (GitHub Pages)

1. Im Repository auf GitHub: **Settings → Pages**.
2. Bei **Source** „Deploy from a branch“ wählen, Branch **main**, Ordner **/ (root)** → **Save**.
3. Nach ein bis zwei Minuten ist das Spiel unter <https://simson861.github.io/simcity/> erreichbar.

Ist das Repository privat, braucht GitHub Pages ein kostenpflichtiges GitHub-Konto – oder du stellst das Repository auf öffentlich.

## Lokal testen (ohne echtes Firebase-Projekt)

Mit dem Firebase-Emulator lassen sich alle Online-Funktionen ohne Google-Konto ausprobieren:

```bash
npm i -g firebase-tools            # benötigt Java 11+
cd firebase && firebase emulators:start --project demo-simcity
# in einem zweiten Terminal im Repository:
python3 -m http.server 8080
```

Dann <http://localhost:8080/index.html?emulator> öffnen. Im Emulator-Modus fragt die Anmeldung nur nach einem
Testnamen; mehrere Browserfenster mit verschiedenen Namen ergeben verschiedene Spieler.

## Grenzen des kostenlosen Tarifs

Spark-Tarif der Realtime Database: 1 GB Speicher, 10 GB Datenübertragung pro Monat, 100 gleichzeitige Verbindungen.
Ein Spielstand ist etwa 50–150 KB groß; eine gemeinsame Stadt überträgt pro Spieler grob 1–3 MB pro Stunde.
