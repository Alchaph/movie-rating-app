# Movie Rating App

Eine vollständige Film-Bewertungs-Anwendung mit Server-Side Rendering (SSR) unter Verwendung von Express.js und Handlebars.

## Quick Start

```bash
# 1. Repository klonen
git clone https://github.com/Alchaph/movie-rating-app.git
cd movie-rating-app

# 2. Abhängigkeiten installieren
npm install

# 3. Anwendung starten
npm start
```

Die Anwendung ist dann unter **http://localhost:3000** erreichbar.

## Features

- **Benutzer-Authentifizierung**: Registrierung, Login, Logout mit Passwort-Hashing (bcrypt)
- **Film-CRUD**: Erstellen, Lesen, Aktualisieren, Löschen von Filmen
- **Datei-Upload**: Bild-Upload für Filme mit Multer
- **Likes & Favoriten**: Filme liken und zu persönlichen Favoriten hinzufügen
- **Filtern & Sortieren**: Nach Kategorie, Autor filtern; nach Datum oder Likes sortieren
- **SQLite-Datenbank**: Persistente Datenspeicherung mit better-sqlite3

## Voraussetzungen

- Node.js 18+ 
- npm

## Installation (Schritt für Schritt)

### 1. Repository klonen

```bash
git clone https://github.com/Alchaph/movie-rating-app.git
cd movie-rating-app
```

### 2. Abhängigkeiten installieren

```bash
npm install
```

### 3. Umgebungsvariablen konfigurieren (optional)

Erstelle eine `.env` Datei im Projektverzeichnis:

```env
# Session-Secret (in Produktion ändern!)
SESSION_SECRET=dev-secret-change-me-in-production

# Datenbank-Dateipfad (optional, Standard: ./data/app.db)
DB_FILE=./data/app.db

# Server-Port (optional, Standard: 3000)
PORT=3000
```

> **Hinweis:** Die `.env` Datei ist optional. Die Anwendung funktioniert auch ohne sie mit Standardwerten.

### 4. Anwendung starten

```bash
# Produktionsmodus
npm start

# Entwicklungsmodus (mit Auto-Reload bei Dateiänderungen)
npm run dev
```

### 5. Im Browser öffnen

Öffne http://localhost:3000 in deinem Browser.

Die Datenbank (`data/app.db`) und der Upload-Ordner (`public/uploads/`) werden automatisch erstellt.

## Projektstruktur

```
movie-rating-app/
├── app.js                 # Express-Hauptanwendung
├── db/
│   └── index.js          # Datenbank-Layer (SQLite)
├── helpers/
│   ├── formatDate.js     # Datum-Formatierungs-Helper
│   └── slugify.js        # URL-Slug-Generator
├── views/
│   ├── layouts/
│   │   └── main.hbs      # Haupt-Layout
│   ├── partials/
│   │   ├── header.hbs    # Navigation
│   │   └── footer.hbs    # Footer
│   ├── home.hbs          # Startseite
│   ├── about.hbs         # Über-Seite
│   ├── users.hbs         # Benutzerliste
│   ├── register.hbs      # Registrierung
│   ├── login.hbs         # Login
│   ├── content_list.hbs  # Filmliste
│   ├── content_new.hbs   # Neuer Film
│   ├── content_edit.hbs  # Film bearbeiten
│   ├── detail.hbs        # Filmdetails
│   ├── favorites_list.hbs # Favoritenliste
│   └── error.hbs         # Fehlerseite
├── public/
│   ├── css/
│   │   ├── style.css         # Haupt-Styles
│   │   ├── content_new.css   # Styles für neue Inhalte
│   │   └── content_edit.css  # Styles für Bearbeitung
│   └── uploads/              # Hochgeladene Bilder
├── data/                     # SQLite-Datenbank
├── package.json
├── .env
└── .gitignore
```

## API-Routen

### Öffentlich
- `GET /` - Startseite mit Filmen nach Kategorie
- `GET /about` - Über-Seite
- `GET /content` - Alle Filme (mit Filtern)
- `GET /content/:slug` - Filmdetails

### Authentifizierung
- `GET /register` - Registrierungsformular
- `POST /register` - Neuen Benutzer erstellen
- `GET /login` - Login-Formular
- `POST /login` - Einloggen
- `POST /logout` - Ausloggen

### Geschützt (Login erforderlich)
- `GET /users` - Benutzerliste
- `GET /content/new` - Neuen Film erstellen
- `POST /content` - Film speichern
- `GET /content/:slug/edit` - Film bearbeiten
- `POST /content/:slug/edit` - Änderungen speichern
- `POST /content/:slug/delete` - Film löschen
- `POST /content/:slug/like` - Like toggeln
- `POST /content/:slug/fav` - Favorit toggeln
- `GET /me/favorites` - Eigene Favoriten

## Kategorien

- `sifi` - Science Fiction
- `krimi` - Krimi
- `horror` - Horror
- `komoedie` - Komödie

## Technologien

- **Express.js** - Web-Framework
- **express-handlebars** - Template-Engine (SSR)
- **better-sqlite3** - SQLite-Datenbank
- **express-session** - Session-Management
- **bcrypt** - Passwort-Hashing
- **multer** - Datei-Upload

## Lizenz

ISC
