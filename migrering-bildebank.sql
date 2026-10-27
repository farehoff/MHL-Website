-- Kjøres EN gang på en eksisterende database (Cloudflare → D1 → mhl-db → Console).
CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY AUTOINCREMENT,caption TEXT,mime TEXT NOT NULL,data TEXT NOT NULL,active INTEGER DEFAULT 1,team_id INTEGER,created_at TEXT DEFAULT (datetime('now')));
