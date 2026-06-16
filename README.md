# Metin2 Character Tracker

Strona do śledzenia postaci Metin2 — zadania dzienne, medale, kryształy ducha, koń, bio.

---

## 🚀 Uruchomienie na Render.com (darmowe)

### 1. MongoDB Atlas (darmowa baza danych)

1. Wejdź na **mongodb.com/cloud/atlas** i załóż darmowe konto
2. Stwórz klaster (wybierz **Free / M0**)
3. W sekcji **Database Access** — dodaj użytkownika z hasłem
4. W sekcji **Network Access** — dodaj `0.0.0.0/0` (dostęp z everywhere)
5. Kliknij **Connect → Drivers** i skopiuj URI, np.:
   ```
   mongodb+srv://user:haslo@cluster0.xxxxx.mongodb.net/characters_tracker
   ```

### 2. GitHub

1. Załóż konto na **github.com**
2. Stwórz nowe repozytorium (np. `metin2-chars`)
3. Wgraj wszystkie pliki z tego ZIP-a do repo

### 3. Render.com

1. Wejdź na **render.com** i załóż darmowe konto
2. Kliknij **New → Web Service**
3. Podłącz swoje repozytorium GitHub
4. Ustaw:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. W sekcji **Environment Variables** dodaj:
   - `MONGO_URI` = *(wklej URI z MongoDB Atlas)*
   - `PASSWORD`  = *(twoje hasło do strony)*
6. Kliknij **Deploy** — za chwilę strona będzie dostępna pod adresem render.com

---

## 🔧 Konfiguracja lokalna (testowanie)

```bash
npm install
MONGO_URI="..." PASSWORD="haslo" node server.js
```

Lub bez MongoDB (dane tylko w pamięci):
```bash
PASSWORD="haslo" node server.js
```

Otwórz: http://localhost:3000/characters.html

---

## 📁 Struktura plików

```
├── server.js          ← serwer Node.js
├── package.json       ← zależności
└── public/
    ├── characters.html  ← główna strona
    ├── icons/           ← ikonki zadań i klas
    ├── items/           ← ikonki przedmiotów
    └── *.png            ← obrazki
```
