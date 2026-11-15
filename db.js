import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TZ = process.env.APP_TZ || 'Europe/Moscow';
export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'nmchv-student.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export const nowIso = () => new Date().toISOString();
export const todayStr = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
};

export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPw(pw, stored) {
  try {
    const [v, s, h] = stored.split('$');
    if (v !== 's1') return false;
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('student','tutor','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  photo_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  main_goal TEXT NOT NULL DEFAULT '',
  directions TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'Активно занимается',
  motivation TEXT NOT NULL DEFAULT '',
  notify_freq TEXT NOT NULL DEFAULT 'all'
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tutor_students(
  tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tutor_id, student_id)
);
CREATE TABLE IF NOT EXISTS educational_goals(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  set_date TEXT NOT NULL,
  target_date TEXT,
  priority TEXT NOT NULL DEFAULT 'Обычный',
  status TEXT NOT NULL DEFAULT 'Активна',
  criteria TEXT NOT NULL DEFAULT '[]',
  tutor_comment TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_routes(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Образовательный маршрут',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS route_stages(
  id INTEGER PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES learning_routes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id INTEGER REFERENCES educational_goals(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  weight INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'Обычный'
);
CREATE TABLE IF NOT EXISTS milestones(
  id INTEGER PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES route_stages(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS resource_categories(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resources(
  id INTEGER PRIMARY KEY,
  owner_student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  url TEXT,
  tutor_note TEXT NOT NULL DEFAULT '',
  stage_id INTEGER REFERENCES route_stages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'К изучению',
  favorite INTEGER NOT NULL DEFAULT 0,
  added_by_self INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES route_stages(id) ON DELETE SET NULL,
  milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  goal_id INTEGER REFERENCES educational_goals(id) ON DELETE SET NULL,
  resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Самостоятельная работа',
  direction TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Обычный',
  status TEXT NOT NULL DEFAULT 'Не начато',
  due_date TEXT,
  link TEXT,
  source TEXT NOT NULL DEFAULT 'tutor',
  minutes_spent INTEGER NOT NULL DEFAULT 0,
  tutor_feedback TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_student ON tasks(student_id, status);
CREATE TABLE IF NOT EXISTS task_comments(
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress_records(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reflections(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers TEXT NOT NULL DEFAULT '{}',
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reflection_questions(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  ref TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_logs(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_student ON activity_logs(student_id, created_at);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'session',
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tools(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'tool',
  url TEXT,
  category TEXT NOT NULL DEFAULT 'Инструменты',
  status TEXT NOT NULL DEFAULT 'Доступно',
  position INTEGER NOT NULL DEFAULT 0
);
`);
