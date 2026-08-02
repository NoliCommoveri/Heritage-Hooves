-- A person: one login, holds the admin flag and (later) the action budget.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_active_stable_id INTEGER,
  last_login_real_ts INTEGER,
  created_real_ts INTEGER NOT NULL
);
