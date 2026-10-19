'use strict';
/*
 * Firebase-Konfiguration für die Online-Funktionen (Google-Anmeldung,
 * Cloud-Spielstände, Region, gemeinsame Städte).
 *
 * Anleitung: siehe ONLINE-EINRICHTUNG.md. In der Firebase-Konsole unter
 * Projekteinstellungen → Allgemein → „Meine Apps“ → Web-App das Objekt
 * „firebaseConfig“ kopieren und hier statt null eintragen, z. B.:
 *
 * const FIREBASE_CONFIG = {
 *   apiKey: 'AIza…',
 *   authDomain: 'mein-projekt.firebaseapp.com',
 *   databaseURL: 'https://mein-projekt-default-rtdb.europe-west1.firebasedatabase.app',
 *   projectId: 'mein-projekt',
 *   appId: '1:…:web:…',
 * };
 *
 * Diese Werte sind öffentlich (sie stehen in jeder Firebase-Web-App im Quelltext);
 * geschützt werden die Daten durch die Sicherheitsregeln in firebase/database.rules.json.
 *
 * Ohne Konfiguration läuft das Spiel offline wie bisher. Zum lokalen Testen mit dem
 * Firebase-Emulator die Seite mit „?emulator“ aufrufen (siehe ONLINE-EINRICHTUNG.md).
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB_IysWsP7rV-1bZR7q4G9-zOPxt0XhXJA",
  authDomain: "simcity-nachbau.firebaseapp.com",
  databaseURL: "https://simcity-nachbau-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "simcity-nachbau",
  storageBucket: "simcity-nachbau.firebasestorage.app",
  messagingSenderId: "934726648860",
  appId: "1:934726648860:web:bcca084219028315fa4bd9",
  measurementId: "G-1BRYS6NVCG"
  };
