import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, q, hashPw, verifyPw, nowIso, todayStr, TZ } from './db.js';
import { seedIfEmpty, DEMO } from './seed.js';
import { computeRoute, goalProgress, WEIGHT } from './progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 14;

seedIfEmpty();

/* ───────── утилиты ───────── */
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (m, c = 400) => new HttpError(c, m);

const E = {
  priority: ['Низкий', 'Обычный', 'Высокий', 'Критический'],
  status: ['Не начато', 'В процессе', 'На проверке', 'Выполнено', 'Отложено'],
  type: ['Изучение материала', 'Практическое задание', 'Тестирование', 'Исследование', 'Подготовка проекта', 'Самостоятельная работа', 'Рефлексия', 'Консультация'],
  goalCat: ['Академические', 'Профессиональные', 'Языковые', 'Личностное развитие', 'Исследовательские', 'Дополнительное образование'],
  goalStatus: ['Активна', 'Достигнута', 'На паузе', 'Отменена'],
  resStatus: ['К изучению', 'Изучается', 'Изучено'],
  eventKind: ['session', 'checkpoint', 'deadline', 'event'],
  recKind: ['test', 'project', 'achievement', 'event'],
  freq: ['all', 'important', 'minimal'],
};

function coerce(v, s, k) {
  const label = s.label || k;
  if (s.t === 'bool') return v ? 1 : 0;
  if (v === null || v === undefined || v === '') {
    if (s.req) throw bad(`Поле «${label}» обязательно`);
    return s.t === 'str' || s.t === 'text' ? '' : null;
  }
  switch (s.t) {
    case 'str': case 'text': {
      if (typeof v !== 'string') throw bad(`Поле «${label}» должно быть текстом`);
      const t = v.trim(); const max = s.max || (s.t === 'text' ? 5000 : 200);
      if (t.length > max) throw bad(`Поле «${label}» слишком длинное (макс. ${max})`);
      if (s.req && !t) throw bad(`Поле «${label}» обязательно`);
      return t;
    }
    case 'enum':
      if (!s.vals.includes(v)) throw bad(`Недопустимое значение поля «${label}»`);
      return v;
    case 'date': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw bad(`Поле «${label}»: неверная дата`);
      return v;
    }
    case 'datetime': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) || isNaN(Date.parse(v))) throw bad(`Поле «${label}»: неверные дата и время`);
      return v.slice(0, 16);
    }
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (s.min ?? -1e9) || n > (s.max ?? 1e9)) throw bad(`Поле «${label}»: недопустимое число`);
      return n;
    }
    case 'id': {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw bad(`Поле «${label}»: неверная ссылка`);
      return n;
    }
    case 'url': {
      if (typeof v !== 'string' || v.length > 500) throw bad(`Поле «${label}»: неверная ссылка`);
      let u; try { u = new URL(v.trim()); } catch { throw bad(`Поле «${label}»: неверная ссылка`); }
      if (!['http:', 'https:'].includes(u.protocol)) throw bad(`Поле «${label}»: допустимы только http/https`);
      return u.toString();
    }
  }
  throw bad('Ошибка валидации');
}
function V(body, spec, partial = false) {
  if (!body || typeof body !== 'object') throw bad('Неверный формат запроса');
  const out = {};
  for (const [k, s] of Object.entries(spec)) {
    if (body[k] === undefined) { if (!partial && s.req) throw bad(`Поле «${s.label || k}» обязательно`); continue; }
    out[k] = coerce(body[k], s, k);
  }
  return out;
}
const ins = (t, d) => { const k = Object.keys(d); return Number(q.run(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`, ...k.map((x) => d[x] ?? null)).lastInsertRowid); };
const upd = (t, id, d) => { const k = Object.keys(d); if (k.length) q.run(`UPDATE ${t} SET ${k.map((x) => x + '=?').join(',')} WHERE id=?`, ...k.map((x) => d[x] ?? null), id); };

const isStaff = (u) => u.role === 'tutor' || u.role === 'admin';
function assertAccess(u, studentId) {
  if (!studentId) throw bad('Не найдено', 404);
  if (u.role === 'student') { if (u.id !== studentId) throw bad('Нет доступа', 403); return; }
  const st = q.get("SELECT id FROM users WHERE id=? AND role='student'", studentId);
  if (!st) throw bad('Ученик не найден', 404);
  if (u.role === 'admin') return;
  if (!q.get('SELECT 1 x FROM tutor_students WHERE tutor_id=? AND student_id=?', u.id, studentId)) throw bad('Нет доступа к этому ученику', 403);
}
function scope(u, url) {
  if (u.role === 'student') return u.id;
  const sid = Number(url.searchParams.get('student'));
  if (!sid) throw bad('Не указан ученик');
  assertAccess(u, sid);
  return sid;
}
function needStaff(u) { if (!isStaff(u)) throw bad('Недостаточно прав', 403); }
function needAdmin(u) { if (u.role !== 'admin') throw bad('Только для администратора', 403); }
function own(table, id, u) {
  const r = q.get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!r) throw bad('Не найдено', 404);
  assertAccess(u, r.student_id ?? r.owner_student_id);
  return r;
}
const tutorsOf = (sid) => q.all('SELECT tutor_id FROM tutor_students WHERE student_id=?', sid).map((r) => r.tutor_id);
const nameOf = (id) => q.get('SELECT full_name n FROM profiles WHERE user_id=?', id)?.n || '—';

function log(sid, actor, kind, text) { q.run('INSERT INTO activity_logs(student_id,actor_id,kind,text,created_at) VALUES(?,?,?,?,?)', sid, actor, kind, text, nowIso()); }
const FREQ = { all: null, important: ['task', 'comment', 'review', 'deadline'], minimal: ['comment', 'review'] };
function notify(userId, kind, title, body = '', link = null, ref = null) {
  const p = q.get('SELECT notify_freq f FROM profiles WHERE user_id=?', userId);
  const allow = FREQ[p?.f || 'all'];
  if (allow && !allow.includes(kind)) return;
  if (ref && q.get('SELECT 1 x FROM notifications WHERE user_id=? AND ref=?', userId, ref)) return;
  q.run('INSERT INTO notifications(user_id,kind,title,body,link,ref,is_read,created_at) VALUES(?,?,?,?,?,?,0,?)', userId, kind, title, body, link, ref, nowIso());
}

/* ───────── сессии ───────── */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function parseCookies(h) { const o = {}; (h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function startSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(token), userId, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function currentUser(req) {
  const t = parseCookies(req.headers.cookie).sid;
  if (!t) return null;
  const s = q.get('SELECT s.user_id,s.expires_at FROM sessions s WHERE token_hash=?', sha(t));
  if (!s) return null;
  if (s.expires_at < nowIso()) { q.run('DELETE FROM sessions WHERE token_hash=?', sha(t)); return null; }
  const u = q.get('SELECT id,email,role,active FROM users WHERE id=?', s.user_id);
  if (!u || !u.active) return null;
  return { ...u, token: t };
}
const attempts = new Map();
function throttle(key, max = 8, windowMs = 600000) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) throw bad('Слишком много попыток. Попробуйте позже.', 429);
  a.push(now); attempts.set(key, a);
}
setInterval(() => { q.run('DELETE FROM sessions WHERE expires_at<?', nowIso()); attempts.clear(); }, 3600000).unref();

const pwOk = (p) => { if (typeof p !== 'string' || p.length < 8 || p.length > 100) throw bad('Пароль: от 8 до 100 символов'); return p; };
const emailOk = (e) => { if (typeof e !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) || e.length > 120) throw bad('Неверный email'); return e.trim().toLowerCase(); };

function createUser({ email, password, role, full_name, main_goal = '', directions = [], tutorId = null }) {
  email = emailOk(email); pwOk(password);
  if (!full_name || !full_name.trim()) throw bad('Укажите имя');
  if (q.get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('Пользователь с таким email уже существует', 409);
  const id = ins('users', { email, password_hash: hashPw(password), role, active: 1, created_at: nowIso() });
  ins('profiles', { user_id: id, full_name: full_name.trim().slice(0, 100), main_goal: String(main_goal).slice(0, 300), directions: JSON.stringify(directions.slice(0, 12).map((d) => String(d).slice(0, 60))), start_date: todayStr() });
  if (role === 'student') {
    ins('learning_routes', { student_id: id, title: 'Образовательный маршрут', created_at: nowIso() });
    if (tutorId) ins('tutor_students', { tutor_id: tutorId, student_id: id, created_at: nowIso() });
    log(id, tutorId, 'start', 'Начало работы в NMCHV Student');
  }
  return id;
}

function me(u) {
  const p = q.get('SELECT * FROM profiles WHERE user_id=?', u.id);
  return { id: u.id, email: u.email, role: u.role, profile: { ...p, directions: JSON.parse(p.directions || '[]') } };
}

/* ───────── спецификации полей ───────── */
const S = {
  goal: {
    title: { t: 'str', req: 1, label: 'Название' }, description: { t: 'text', label: 'Описание' },
    category: { t: 'enum', vals: E.goalCat, req: 1, label: 'Категория' }, set_date: { t: 'date', label: 'Дата постановки' },
    target_date: { t: 'date', label: 'Планируемая дата' }, priority: { t: 'enum', vals: E.priority, label: 'Приоритет' },
    status: { t: 'enum', vals: E.goalStatus, label: 'Статус' },
  },
  stage: {
    title: { t: 'str', req: 1, label: 'Название этапа' }, description: { t: 'text', label: 'Описание' },
    start_date: { t: 'date', label: 'Начало' }, end_date: { t: 'date', label: 'Окончание' },
    weight: { t: 'int', min: 1, max: 10, label: 'Вес' }, priority: { t: 'enum', vals: E.priority, label: 'Приоритет' },
    goal_id: { t: 'id', label: 'Цель' },
  },
  milestone: {
    title: { t: 'str', req: 1, label: 'Название' }, due_date: { t: 'date', label: 'Срок' }, done: { t: 'bool' },
  },
  taskStaff: {
    title: { t: 'str', req: 1, label: 'Название' }, description: { t: 'text', label: 'Описание' }, instructions: { t: 'text', label: 'Инструкция' },
    type: { t: 'enum', vals: E.type, label: 'Тип' }, direction: { t: 'str', max: 80, label: 'Направление' },
    priority: { t: 'enum', vals: E.priority, label: 'Приоритет' }, status: { t: 'enum', vals: E.status, label: 'Статус' },
    due_date: { t: 'date', label: 'Срок' }, link: { t: 'url', label: 'Ссылка' },
    stage_id: { t: 'id', label: 'Этап' }, milestone_id: { t: 'id', label: 'Контрольная точка' }, goal_id: { t: 'id', label: 'Цель' },
    resource_id: { t: 'id', label: 'Материал' }, tutor_feedback: { t: 'text', label: 'Обратная связь' },
    minutes_spent: { t: 'int', min: 0, max: 100000, label: 'Минуты' },
  },
  resource: {
    title: { t: 'str', req: 1, label: 'Название' }, description: { t: 'text', label: 'Описание' },
    category: { t: 'str', req: 1, max: 60, label: 'Категория' }, url: { t: 'url', label: 'Ссылка' },
    tutor_note: { t: 'text', label: 'Рекомендация' }, stage_id: { t: 'id', label: 'Этап' },
    status: { t: 'enum', vals: E.resStatus, label: 'Статус' }, favorite: { t: 'bool' },
  },
  event: {
    title: { t: 'str', req: 1, label: 'Название' }, kind: { t: 'enum', vals: E.eventKind, label: 'Тип' },
    starts_at: { t: 'datetime', req: 1, label: 'Дата и время' }, note: { t: 'text', max: 500, label: 'Заметка' },
  },
  record: {
    kind: { t: 'enum', vals: E.recKind, req: 1, label: 'Тип' }, title: { t: 'str', req: 1, label: 'Название' },
    value: { t: 'str', max: 60, label: 'Результат' }, note: { t: 'text', max: 1000, label: 'Заметка' },
    direction: { t: 'str', max: 80, label: 'Направление' }, recorded_at: { t: 'date', req: 1, label: 'Дата' },
  },
  tool: {
    title: { t: 'str', req: 1, label: 'Название' }, description: { t: 'text', max: 600, label: 'Описание' },
    icon: { t: 'str', max: 30, label: 'Иконка' }, url: { t: 'url', label: 'Ссылка' },
    category: { t: 'str', max: 60, label: 'Категория' }, status: { t: 'str', max: 40, label: 'Статус' }, position: { t: 'int', min: 0, max: 999 },
  },
};

function criteriaOf(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw bad('Критерии: не более 20');
  return JSON.stringify(v.map((c) => ({ text: String(c.text || '').trim().slice(0, 200), done: !!c.done })).filter((c) => c.text));
}
function checkRefs(sid, d) {
  if (d.stage_id && !q.get('SELECT 1 x FROM route_stages WHERE id=? AND student_id=?', d.stage_id, sid)) throw bad('Этап не найден');
  if (d.milestone_id && !q.get('SELECT 1 x FROM milestones WHERE id=? AND student_id=?', d.milestone_id, sid)) throw bad('Контрольная точка не найдена');
  if (d.goal_id && !q.get('SELECT 1 x FROM educational_goals WHERE id=? AND student_id=?', d.goal_id, sid)) throw bad('Цель не найдена');
}

/* ───────── маршруты API ───────── */
const R = [];
const route = (method, re, fn, pub = false) => R.push({ method, re: new RegExp('^' + re + '$'), fn, pub });

route('GET', '/api/public', () => ({ demo: DEMO.enabled, accounts: DEMO.enabled ? DEMO.accounts : [] }), true);

route('POST', '/api/auth/login', ({ req, res, body }) => {
  const email = String(body.email || '').trim().toLowerCase();
  throttle('l:' + req.socket.remoteAddress + email);
  const u = q.get('SELECT * FROM users WHERE email=?', email);
  if (!u || !u.active || !verifyPw(String(body.password || ''), u.password_hash)) throw bad('Неверный email или пароль', 401);
  startSession(res, req, u.id);
  return me(u);
}, true);

route('POST', '/api/auth/register', ({ req, res, body }) => {
  throttle('r:' + req.socket.remoteAddress, 5, 3600000);
  const id = createUser({ email: body.email, password: body.password, role: 'student', full_name: String(body.full_name || '') });
  startSession(res, req, id);
  return me({ id, email: String(body.email).trim().toLowerCase(), role: 'student' });
}, true);

route('POST', '/api/auth/logout', ({ user, res }) => {
  q.run('DELETE FROM sessions WHERE token_hash=?', sha(user.token));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => me(user));

route('PATCH', '/api/me', ({ user, body }) => {
  const d = V(body, {
    full_name: { t: 'str', req: 1, label: 'Имя' }, photo_url: { t: 'url', label: 'Фото' }, bio: { t: 'text', max: 800, label: 'О себе' },
    main_goal: { t: 'str', max: 300, label: 'Основная цель' }, status: { t: 'str', max: 80, label: 'Статус' },
    notify_freq: { t: 'enum', vals: E.freq, label: 'Частота уведомлений' },
  }, true);
  if (body.directions !== undefined) {
    if (!Array.isArray(body.directions) || body.directions.length > 12) throw bad('Направления: не более 12');
    d.directions = JSON.stringify(body.directions.map((x) => String(x).trim().slice(0, 60)).filter(Boolean));
  }
  if (user.role !== 'student') delete d.main_goal;
  const k = Object.keys(d);
  if (k.length) q.run(`UPDATE profiles SET ${k.map((x) => x + '=?').join(',')} WHERE user_id=?`, ...k.map((x) => d[x] ?? null), user.id);
  return me(user);
});

route('POST', '/api/me/password', ({ user, body }) => {
  const u = q.get('SELECT password_hash h FROM users WHERE id=?', user.id);
  if (!verifyPw(String(body.current || ''), u.h)) throw bad('Текущий пароль неверен', 403);
  q.run('UPDATE users SET password_hash=? WHERE id=?', hashPw(pwOk(body.next)), user.id);
  q.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', user.id, sha(user.token));
  return { ok: true };
});

/* ── панель ученика ── */
route('GET', '/api/dashboard', ({ user, url }) => {
  const sid = scope(user, url);
  const p = q.get('SELECT * FROM profiles WHERE user_id=?', sid);
  const r = computeRoute(sid);
  const goals = goalProgress(sid);
  const T = todayStr();
  const tasks = q.all(`SELECT t.*, s.title stage_title FROM tasks t LEFT JOIN route_stages s ON s.id=t.stage_id
    WHERE t.student_id=? AND t.status NOT IN ('Выполнено') ORDER BY (t.due_date IS NULL), t.due_date, t.id LIMIT 7`, sid);
  const nowMin = new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
  const events = q.all('SELECT * FROM events WHERE student_id=? AND starts_at>=? ORDER BY starts_at LIMIT 6', sid, nowMin);
  const mile = q.all(`SELECT m.id,m.title,m.due_date,s.title stage_title FROM milestones m JOIN route_stages s ON s.id=m.stage_id
    WHERE m.student_id=? AND m.done=0 AND m.due_date>=? ORDER BY m.due_date LIMIT 5`, sid, T);
  const upcoming = [
    ...events.map((e) => ({ kind: e.kind, title: e.title, at: e.starts_at, note: e.note })),
    ...mile.filter((m) => !r.stages.flatMap((s) => s.milestones).find((x) => x.id === m.id)?.done).map((m) => ({ kind: 'checkpoint', title: m.title, at: m.due_date, note: m.stage_title })),
    ...tasks.filter((t) => t.due_date && t.due_date >= T && ['Высокий', 'Критический'].includes(t.priority)).map((t) => ({ kind: 'deadline', title: t.title, at: t.due_date, note: 'Дедлайн задачи' })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 7);
  const activity = q.all(`SELECT a.*, p.full_name actor FROM activity_logs a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.student_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 8`, sid);
  const comment = q.get(`SELECT a.text, a.created_at, p.full_name actor FROM activity_logs a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.student_id=? AND a.kind='tutor_comment' ORDER BY a.created_at DESC, a.id DESC LIMIT 1`, sid);
  const overdue = q.get("SELECT COUNT(*) c FROM tasks WHERE student_id=? AND status<>'Выполнено' AND due_date<?", sid, T).c;
  return {
    profile: { ...p, directions: JSON.parse(p.directions || '[]') },
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: r.tasksDone, tasksTotal: r.tasksTotal,
    activeGoals: goals.filter((g) => g.status === 'Активна').length,
    days: p.start_date ? Math.max(0, Math.floor((Date.parse(T) - Date.parse(p.start_date)) / 864e5)) : 0,
    current: r.current && { id: r.current.id, title: r.current.title, pct: r.current.pct, end_date: r.current.end_date },
    mainGoal: goals.find((g) => g.status === 'Активна' && g.priority === 'Высокий') || goals.find((g) => g.status === 'Активна') || null,
    tasks, upcoming, activity, comment, overdue, today: T,
  };
});

/* ── маршрут ── */
route('GET', '/api/route', ({ user, url }) => {
  const sid = scope(user, url);
  const r = computeRoute(sid);
  const goals = Object.fromEntries(goalProgress(sid).map((g) => [g.id, g.title]));
  const tasks = q.all('SELECT id,stage_id,milestone_id,title,status,priority,due_date,type FROM tasks WHERE student_id=? ORDER BY (due_date IS NULL),due_date,id', sid);
  const stages = r.stages.map((s) => ({
    ...s, goal_title: goals[s.goal_id] || null,
    milestones: s.milestones.map((m) => ({ ...m, tasks: tasks.filter((t) => t.milestone_id === m.id) })),
    looseTasks: tasks.filter((t) => t.stage_id === s.id && !t.milestone_id),
  }));
  const history = q.all(`SELECT a.id,a.text,a.created_at,p.full_name actor FROM activity_logs a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.student_id=? AND a.kind='route' ORDER BY a.created_at DESC, a.id DESC LIMIT 30`, sid);
  const goalList = q.all('SELECT id,title FROM educational_goals WHERE student_id=? ORDER BY id', sid);
  return { overall: r.overall, doneStages: r.doneStages, stages, history, goals: goalList, today: todayStr() };
});

function stageOwn(u, id) { return own('route_stages', id, u); }
route('POST', '/api/stages', ({ user, url, body }) => {
  needStaff(user); const sid = scope(user, url);
  const d = V(body, S.stage); checkRefs(sid, d);
  const rt = q.get('SELECT id FROM learning_routes WHERE student_id=?', sid);
  const pos = (q.get('SELECT MAX(position) m FROM route_stages WHERE student_id=?', sid).m ?? -1) + 1;
  const id = ins('route_stages', { ...d, weight: d.weight || 1, priority: d.priority || 'Обычный', route_id: rt.id, student_id: sid, position: pos });
  log(sid, user.id, 'route', `Добавлен этап «${d.title}»`);
  notify(sid, 'route', 'Изменён маршрут', `Добавлен этап «${d.title}»`, '#/route');
  return { id };
});
route('PATCH', '/api/stages/(\\d+)', ({ user, params, body }) => {
  needStaff(user); const s = stageOwn(user, +params[0]);
  const d = V(body, S.stage, true); checkRefs(s.student_id, d);
  upd('route_stages', s.id, d);
  const what = d.end_date && d.end_date !== s.end_date ? `Срок этапа «${s.title}» перенесён на ${d.end_date}` : `Обновлён этап «${d.title || s.title}»`;
  log(s.student_id, user.id, 'route', what);
  notify(s.student_id, 'route', 'Изменён маршрут', what, '#/route');
  return { ok: true };
});
route('DELETE', '/api/stages/(\\d+)', ({ user, params }) => {
  needStaff(user); const s = stageOwn(user, +params[0]);
  q.run('DELETE FROM route_stages WHERE id=?', s.id);
  log(s.student_id, user.id, 'route', `Удалён этап «${s.title}»`);
  notify(s.student_id, 'route', 'Изменён маршрут', `Удалён этап «${s.title}»`, '#/route');
  return { ok: true };
});
route('POST', '/api/stages/(\\d+)/move', ({ user, params, body }) => {
  needStaff(user); const s = stageOwn(user, +params[0]);
  const dir = body.dir === 1 ? 1 : body.dir === -1 ? -1 : 0; if (!dir) throw bad('Неверное направление');
  const all = q.all('SELECT id FROM route_stages WHERE student_id=? ORDER BY position,id', s.student_id).map((r) => r.id);
  const i = all.indexOf(s.id), j = i + dir;
  if (j < 0 || j >= all.length) return { ok: true };
  [all[i], all[j]] = [all[j], all[i]];
  all.forEach((id, k) => q.run('UPDATE route_stages SET position=? WHERE id=?', k, id));
  log(s.student_id, user.id, 'route', `Изменена последовательность этапов («${s.title}»)`);
  notify(s.student_id, 'route', 'Изменён маршрут', `Изменён порядок этапов: «${s.title}»`, '#/route');
  return { ok: true };
});
route('POST', '/api/stages/(\\d+)/milestones', ({ user, params, body }) => {
  needStaff(user); const s = stageOwn(user, +params[0]);
  const d = V(body, S.milestone);
  const pos = (q.get('SELECT MAX(position) m FROM milestones WHERE stage_id=?', s.id).m ?? -1) + 1;
  const id = ins('milestones', { ...d, done: d.done || 0, done_at: d.done ? nowIso() : null, stage_id: s.id, student_id: s.student_id, position: pos });
  log(s.student_id, user.id, 'route', `Добавлена контрольная точка «${d.title}» в этап «${s.title}»`);
  notify(s.student_id, 'route', 'Изменён маршрут', `Новая контрольная точка: «${d.title}»`, '#/route');
  return { id };
});
route('PATCH', '/api/milestones/(\\d+)', ({ user, params, body }) => {
  needStaff(user); const m = own('milestones', +params[0], user);
  const d = V(body, S.milestone, true);
  if (d.done !== undefined) d.done_at = d.done ? nowIso() : null;
  upd('milestones', m.id, d);
  if (d.done && !m.done) log(m.student_id, user.id, 'milestone', `Достигнута контрольная точка «${m.title}»`);
  return { ok: true };
});
route('DELETE', '/api/milestones/(\\d+)', ({ user, params }) => {
  needStaff(user); const m = own('milestones', +params[0], user);
  q.run('DELETE FROM milestones WHERE id=?', m.id);
  log(m.student_id, user.id, 'route', `Удалена контрольная точка «${m.title}»`);
  return { ok: true };
});

/* ── цели ── */
route('GET', '/api/goals', ({ user, url }) => {
  const sid = scope(user, url);
  const stages = q.all('SELECT id,title,goal_id FROM route_stages WHERE student_id=? ORDER BY position', sid);
  return { goals: goalProgress(sid).map((g) => ({ ...g, stageList: stages.filter((s) => s.goal_id === g.id) })), stages };
});
route('POST', '/api/goals', ({ user, url, body }) => {
  const sid = scope(user, url);
  const d = V(body, S.goal);
  const crit = criteriaOf(body.criteria);
  const id = ins('educational_goals', {
    ...d, student_id: sid, set_date: d.set_date || todayStr(), priority: d.priority || 'Обычный', status: d.status || 'Активна',
    criteria: crit || '[]', created_by: user.id, created_at: nowIso(),
  });
  log(sid, user.id, 'goal', `Добавлена цель «${d.title}»`);
  if (isStaff(user)) notify(sid, 'route', 'Новая цель', `«${d.title}»`, '#/goals');
  return { id };
});
route('PATCH', '/api/goals/(\\d+)', ({ user, params, body }) => {
  const g = own('educational_goals', +params[0], user);
  const d = V(body, S.goal, true);
  const crit = criteriaOf(body.criteria); if (crit !== undefined) d.criteria = crit;
  if (isStaff(user) && body.tutor_comment !== undefined) {
    d.tutor_comment = coerce(body.tutor_comment, { t: 'text', max: 1500, label: 'Комментарий' }, 'tutor_comment');
    if (d.tutor_comment && d.tutor_comment !== g.tutor_comment) notify(g.student_id, 'comment', 'Комментарий к цели', `«${g.title}»`, '#/goals');
  }
  if (user.role === 'student' && g.created_by !== user.id) { for (const k of Object.keys(d)) if (k !== 'criteria') delete d[k]; }
  upd('educational_goals', g.id, d);
  if (d.status === 'Достигнута' && g.status !== 'Достигнута') log(g.student_id, user.id, 'goal', `Цель достигнута: «${g.title}»`);
  return { ok: true };
});
route('DELETE', '/api/goals/(\\d+)', ({ user, params }) => {
  const g = own('educational_goals', +params[0], user);
  if (user.role === 'student' && g.created_by !== user.id) throw bad('Цели от тьютора удаляет тьютор', 403);
  q.run('DELETE FROM educational_goals WHERE id=?', g.id);
  log(g.student_id, user.id, 'goal', `Удалена цель «${g.title}»`);
  return { ok: true };
});

/* ── задачи ── */
route('GET', '/api/tasks', ({ user, url }) => {
  const sid = scope(user, url);
  const tasks = q.all(`SELECT t.*, s.title stage_title, g.title goal_title, m.title milestone_title,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id=t.id) comments
    FROM tasks t LEFT JOIN route_stages s ON s.id=t.stage_id LEFT JOIN educational_goals g ON g.id=COALESCE(t.goal_id,s.goal_id)
    LEFT JOIN milestones m ON m.id=t.milestone_id
    WHERE t.student_id=? ORDER BY (t.due_date IS NULL), t.due_date, t.id`, sid);
  const p = q.get('SELECT directions FROM profiles WHERE user_id=?', sid);
  const stages = q.all('SELECT id,title FROM route_stages WHERE student_id=? ORDER BY position', sid);
  const milestones = q.all('SELECT id,stage_id,title FROM milestones WHERE student_id=? ORDER BY position', sid);
  const goals = q.all("SELECT id,title FROM educational_goals WHERE student_id=? ORDER BY id", sid);
  return { tasks, directions: JSON.parse(p.directions || '[]'), stages, milestones, goals, today: todayStr() };
});

route('POST', '/api/tasks', ({ user, url, body }) => {
  const sid = scope(user, url);
  let d;
  if (isStaff(user)) { d = V(body, S.taskStaff); delete d.tutor_feedback; }
  else {
    d = V(body, S.taskStaff);
    for (const k of ['tutor_feedback', 'instructions', 'resource_id']) delete d[k];
    if (d.status === 'Выполнено') d.status = 'Выполнено';
  }
  checkRefs(sid, d);
  const source = isStaff(user) ? 'tutor' : 'personal';
  const st = d.status || 'Не начато';
  const id = ins('tasks', {
    ...d, student_id: sid, priority: d.priority || 'Обычный', status: st, type: d.type || 'Самостоятельная работа', source,
    completed_at: st === 'Выполнено' ? nowIso() : null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(),
  });
  if (source === 'tutor') {
    log(sid, user.id, 'task', `Назначена задача «${d.title}»`);
    notify(sid, 'task', 'Новая задача', `«${d.title}»${d.due_date ? ' · срок ' + d.due_date : ''}`, '#/tasks', 'task-new-' + id);
  } else log(sid, user.id, 'task', `Добавлена личная задача «${d.title}»`);
  return { id };
});

route('PATCH', '/api/tasks/(\\d+)', ({ user, params, body }) => {
  const t = own('tasks', +params[0], user);
  let d = V(body, S.taskStaff, true);
  const staff = isStaff(user);
  const personal = t.source === 'personal';
  if (!staff && !personal) {
    const allowed = {}; for (const k of ['status', 'minutes_spent', 'link']) if (d[k] !== undefined) allowed[k] = d[k];
    d = allowed;
    if (d.status === 'Выполнено') d.status = 'На проверке';
  }
  if (!staff && personal) { delete d.tutor_feedback; delete d.instructions; delete d.resource_id; }
  checkRefs(t.student_id, d);
  if (d.status && d.status !== t.status) {
    if (d.status === 'Выполнено') d.completed_at = nowIso();
    else if (t.status === 'Выполнено') d.completed_at = null;
  }
  d.updated_at = nowIso();
  upd('tasks', t.id, d);
  const ns = d.status;
  if (ns && ns !== t.status) {
    if (ns === 'Выполнено') {
      log(t.student_id, user.id, 'task_done', `Выполнена задача «${t.title}»`);
      if (staff && t.status === 'На проверке') notify(t.student_id, 'review', 'Задача принята', `«${t.title}»${d.tutor_feedback ? ' — ' + d.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
    } else if (ns === 'На проверке') {
      log(t.student_id, user.id, 'task', `Задача «${t.title}» отправлена на проверку`);
      tutorsOf(t.student_id).forEach((tid) => notify(tid, 'review', 'Задача на проверке', `${nameOf(t.student_id)}: «${t.title}»`, `#/student/${t.student_id}/tasks`));
    } else if (staff && t.status === 'На проверке' && ns === 'В процессе') {
      log(t.student_id, user.id, 'task', `Задача «${t.title}» возвращена на доработку`);
      notify(t.student_id, 'review', 'Задача возвращена на доработку', `«${t.title}»${d.tutor_feedback ? ' — ' + d.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
    }
  } else if (staff && d.tutor_feedback && d.tutor_feedback !== t.tutor_feedback) {
    notify(t.student_id, 'comment', 'Обратная связь по задаче', `«${t.title}»`, '#/tasks');
  }
  return { ok: true, status: ns || t.status };
});

route('DELETE', '/api/tasks/(\\d+)', ({ user, params }) => {
  const t = own('tasks', +params[0], user);
  if (!isStaff(user) && t.source !== 'personal') throw bad('Задачи тьютора удаляет тьютор', 403);
  q.run('DELETE FROM tasks WHERE id=?', t.id);
  return { ok: true };
});

route('GET', '/api/tasks/(\\d+)/comments', ({ user, params }) => {
  const t = own('tasks', +params[0], user);
  return q.all(`SELECT c.id,c.body,c.created_at,c.author_id,p.full_name author FROM task_comments c JOIN profiles p ON p.user_id=c.author_id WHERE c.task_id=? ORDER BY c.id`, t.id);
});
route('POST', '/api/tasks/(\\d+)/comments', ({ user, params, body }) => {
  const t = own('tasks', +params[0], user);
  const d = V(body, { body: { t: 'text', req: 1, max: 1500, label: 'Комментарий' } });
  const id = ins('task_comments', { task_id: t.id, student_id: t.student_id, author_id: user.id, body: d.body, created_at: nowIso() });
  if (isStaff(user)) notify(t.student_id, 'comment', 'Новый комментарий к задаче', `«${t.title}»: ${d.body.slice(0, 100)}`, '#/tasks');
  else tutorsOf(t.student_id).forEach((tid) => notify(tid, 'comment', 'Комментарий ученика', `${nameOf(t.student_id)} · «${t.title}»`, `#/student/${t.student_id}/tasks`));
  return { id };
});

/* ── обратная связь тьютора ── */
route('POST', '/api/feedback', ({ user, url, body }) => {
  needStaff(user); const sid = scope(user, url);
  const d = V(body, { text: { t: 'text', req: 1, max: 2000, label: 'Комментарий' } });
  log(sid, user.id, 'tutor_comment', d.text);
  notify(sid, 'comment', 'Комментарий тьютора', d.text.slice(0, 140), '#/home');
  return { ok: true };
});
route('GET', '/api/feedback', ({ user, url }) => {
  const sid = scope(user, url);
  return q.all(`SELECT a.id,a.text,a.created_at,p.full_name actor FROM activity_logs a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.student_id=? AND a.kind='tutor_comment' ORDER BY a.created_at DESC, a.id DESC LIMIT 50`, sid);
});
route('PATCH', '/api/student-profile', ({ user, url, body }) => {
  needStaff(user); const sid = scope(user, url);
  const d = V(body, {
    motivation: { t: 'str', max: 300, label: 'Фраза' }, main_goal: { t: 'str', max: 300, label: 'Цель' },
    status: { t: 'str', max: 80, label: 'Статус' },
  }, true);
  const k = Object.keys(d);
  if (k.length) q.run(`UPDATE profiles SET ${k.map((x) => x + '=?').join(',')} WHERE user_id=?`, ...k.map((x) => d[x] ?? null), sid);
  return { ok: true };
});

/* ── события ── */
route('GET', '/api/events', ({ user, url }) => q.all('SELECT * FROM events WHERE student_id=? ORDER BY starts_at', scope(user, url)));
route('POST', '/api/events', ({ user, url, body }) => {
  needStaff(user); const sid = scope(user, url);
  const d = V(body, S.event);
  const id = ins('events', { ...d, kind: d.kind || 'session', student_id: sid, created_by: user.id });
  notify(sid, 'route', 'Новое событие', `${d.title} · ${d.starts_at.replace('T', ' ')}`, '#/home');
  return { id };
});
route('DELETE', '/api/events/(\\d+)', ({ user, params }) => {
  needStaff(user); const e = own('events', +params[0], user);
  q.run('DELETE FROM events WHERE id=?', e.id); return { ok: true };
});

/* ── библиотека ── */
route('GET', '/api/resources', ({ user, url }) => {
  const sid = scope(user, url);
  const items = q.all(`SELECT r.*, s.title stage_title FROM resources r LEFT JOIN route_stages s ON s.id=r.stage_id WHERE r.owner_student_id=? ORDER BY r.favorite DESC, r.id DESC`, sid);
  return {
    items, categories: q.all('SELECT name FROM resource_categories ORDER BY position').map((c) => c.name),
    stages: q.all('SELECT id,title FROM route_stages WHERE student_id=? ORDER BY position', sid),
  };
});
route('POST', '/api/resources', ({ user, url, body }) => {
  const sid = scope(user, url);
  const d = V(body, S.resource); checkRefs(sid, d);
  const staff = isStaff(user);
  if (!staff) { delete d.tutor_note; }
  const id = ins('resources', {
    ...d, status: d.status || 'К изучению', favorite: d.favorite || 0, owner_student_id: sid,
    tutor_id: staff ? user.id : null, added_by_self: staff ? 0 : 1, created_at: nowIso(),
  });
  log(sid, user.id, 'resource', `Добавлен материал «${d.title}»`);
  if (staff) notify(sid, 'resource', 'Новый материал', `«${d.title}»`, '#/library');
  return { id };
});
route('PATCH', '/api/resources/(\\d+)', ({ user, params, body }) => {
  const r = own('resources', +params[0], user);
  let d = V(body, S.resource, true);
  if (!isStaff(user)) {
    if (r.added_by_self) delete d.tutor_note;
    else d = Object.fromEntries(Object.entries(d).filter(([k]) => ['status', 'favorite'].includes(k)));
  }
  checkRefs(r.owner_student_id, d);
  upd('resources', r.id, d);
  return { ok: true };
});
route('DELETE', '/api/resources/(\\d+)', ({ user, params }) => {
  const r = own('resources', +params[0], user);
  if (!isStaff(user) && !r.added_by_self) throw bad('Материалы тьютора удаляет тьютор', 403);
  q.run('DELETE FROM resources WHERE id=?', r.id); return { ok: true };
});
// общая библиотека тьютора
route('GET', '/api/library/shared', ({ user }) => {
  needStaff(user);
  return q.all('SELECT * FROM resources WHERE owner_student_id IS NULL AND tutor_id=? ORDER BY id DESC', user.id);
});
route('POST', '/api/library/shared', ({ user, body }) => {
  needStaff(user);
  const d = V(body, S.resource); delete d.stage_id; delete d.favorite; delete d.status;
  return { id: ins('resources', { ...d, owner_student_id: null, tutor_id: user.id, created_at: nowIso() }) };
});
route('DELETE', '/api/library/shared/(\\d+)', ({ user, params }) => {
  needStaff(user);
  const r = q.get('SELECT * FROM resources WHERE id=? AND owner_student_id IS NULL AND tutor_id=?', +params[0], user.id);
  if (!r) throw bad('Не найдено', 404);
  q.run('DELETE FROM resources WHERE id=?', r.id); return { ok: true };
});
route('POST', '/api/library/assign', ({ user, body }) => {
  needStaff(user);
  const r = q.get('SELECT * FROM resources WHERE id=? AND owner_student_id IS NULL AND tutor_id=?', Number(body.resource_id), user.id);
  if (!r) throw bad('Материал не найден', 404);
  const ids = Array.isArray(body.student_ids) ? body.student_ids.map(Number).filter(Boolean).slice(0, 100) : [];
  if (!ids.length) throw bad('Выберите учеников');
  let n = 0;
  for (const sid of ids) {
    assertAccess(user, sid);
    ins('resources', { owner_student_id: sid, tutor_id: user.id, title: r.title, description: r.description, category: r.category, url: r.url, tutor_note: r.tutor_note, status: 'К изучению', added_by_self: 0, created_at: nowIso() });
    log(sid, user.id, 'resource', `Добавлен материал «${r.title}»`);
    notify(sid, 'resource', 'Новый материал', `«${r.title}»`, '#/library'); n++;
  }
  return { assigned: n };
});

/* ── рефлексия ── */
route('GET', '/api/reflections', ({ user, url }) => {
  const sid = scope(user, url);
  let rows = q.all('SELECT * FROM reflections WHERE student_id=? ORDER BY created_at DESC, id DESC', sid);
  if (user.role !== 'student') rows = rows.filter((r) => !r.is_private);
  return {
    items: rows.map((r) => ({ ...r, answers: JSON.parse(r.answers || '{}') })),
    questions: q.all('SELECT id,text,created_at FROM reflection_questions WHERE student_id=? ORDER BY id DESC', sid),
  };
});
route('POST', '/api/reflections', ({ user, body }) => {
  if (user.role !== 'student') throw bad('Записи ведёт ученик', 403);
  const a = body.answers;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw bad('Нет ответов');
  const clean = {}; let n = 0;
  for (const [k, v] of Object.entries(a).slice(0, 20)) { const t = String(v || '').trim().slice(0, 3000); if (t) { clean[String(k).slice(0, 300)] = t; n++; } }
  if (!n) throw bad('Заполните хотя бы один ответ');
  const id = ins('reflections', { student_id: user.id, answers: JSON.stringify(clean), is_private: body.is_private ? 1 : 0, created_at: nowIso() });
  log(user.id, user.id, 'reflection', body.is_private ? 'Добавлена личная запись рефлексии' : 'Добавлена запись рефлексии');
  return { id };
});
route('PATCH', '/api/reflections/(\\d+)', ({ user, params, body }) => {
  const r = own('reflections', +params[0], user);
  if (user.role !== 'student') throw bad('Нет доступа', 403);
  q.run('UPDATE reflections SET is_private=? WHERE id=?', body.is_private ? 1 : 0, r.id); return { ok: true };
});
route('DELETE', '/api/reflections/(\\d+)', ({ user, params }) => {
  const r = own('reflections', +params[0], user);
  if (user.role !== 'student') throw bad('Нет доступа', 403);
  q.run('DELETE FROM reflections WHERE id=?', r.id); return { ok: true };
});
route('POST', '/api/reflection-questions', ({ user, url, body }) => {
  needStaff(user); const sid = scope(user, url);
  const d = V(body, { text: { t: 'str', req: 1, max: 300, label: 'Вопрос' } });
  notify(sid, 'comment', 'Новый вопрос для рефлексии', d.text, '#/reflection');
  return { id: ins('reflection_questions', { student_id: sid, text: d.text, created_by: user.id, created_at: nowIso() }) };
});
route('DELETE', '/api/reflection-questions/(\\d+)', ({ user, params }) => {
  const r = own('reflection_questions', +params[0], user);
  q.run('DELETE FROM reflection_questions WHERE id=?', r.id); return { ok: true };
});

/* ── результаты / достижения ── */
route('GET', '/api/records', ({ user, url }) => q.all('SELECT * FROM progress_records WHERE student_id=? ORDER BY recorded_at DESC, id DESC', scope(user, url)));
route('POST', '/api/records', ({ user, url, body }) => {
  const sid = scope(user, url);
  const d = V(body, S.record);
  const id = ins('progress_records', { ...d, student_id: sid });
  log(sid, user.id, 'record', `Зафиксировано: ${d.title}${d.value ? ' — ' + d.value : ''}`);
  return { id };
});
route('DELETE', '/api/records/(\\d+)', ({ user, params }) => {
  const r = own('progress_records', +params[0], user);
  q.run('DELETE FROM progress_records WHERE id=?', r.id); return { ok: true };
});

/* ── аналитика и отчёт ── */
const monday = (ds) => { const d = new Date(ds + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

route('GET', '/api/analytics', ({ user, url }) => {
  const sid = scope(user, url);
  const T = todayStr();
  const tasks = q.all('SELECT * FROM tasks WHERE student_id=?', sid);
  const done = tasks.filter((t) => t.status === 'Выполнено' && t.completed_at);
  const dday = (t) => t.completed_at.slice(0, 10);
  const wk0 = monday(T);
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const from = addDays(wk0, -7 * i), to = addDays(from, 6);
    weeks.push({
      from, done: done.filter((t) => dday(t) >= from && dday(t) <= to).length,
      planned: tasks.filter((t) => t.due_date && t.due_date >= from && t.due_date <= to).length,
      progress: computeRoute(sid, i === 0 ? T : to).overall,
    });
  }
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    months.push({ key, done: done.filter((t) => dday(t).startsWith(key)).length });
  }
  const p = q.get('SELECT directions FROM profiles WHERE user_id=?', sid);
  const dirNames = [...new Set([...JSON.parse(p.directions || '[]'), ...tasks.map((t) => t.direction).filter(Boolean)])];
  const directions = dirNames.map((name) => {
    const ts = tasks.filter((t) => t.direction === name);
    let tot = 0, dn = 0; ts.forEach((t) => { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; });
    return { name, total: ts.length, done: ts.filter((t) => t.status === 'Выполнено').length, pct: tot ? Math.round((dn / tot) * 100) : 0, minutes: ts.reduce((a, t) => a + t.minutes_spent, 0) };
  });
  const r = computeRoute(sid);
  const plan = r.stages.map((s) => ({
    title: s.title, start: s.start_date, planned_end: s.end_date, actual_end: s.actual_end, pct: s.pct, status: s.status,
    delta: s.actual_end && s.end_date ? Math.round((Date.parse(s.actual_end) - Date.parse(s.end_date)) / 864e5) : null,
  }));
  const lateDone = done.filter((t) => t.due_date);
  const onTime = lateDone.filter((t) => dday(t) <= t.due_date).length;
  const goals = goalProgress(sid).map((g) => ({ id: g.id, title: g.title, pct: g.pct, status: g.status, category: g.category, target_date: g.target_date }));
  return {
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: done.length, tasksTotal: tasks.length,
    minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0), onTimePct: lateDone.length ? Math.round((onTime / lateDone.length) * 100) : null,
    weeks, months, directions, plan, goals,
    records: q.all('SELECT * FROM progress_records WHERE student_id=? ORDER BY recorded_at DESC, id DESC', sid), today: T,
  };
});

route('GET', '/api/report', ({ user, url }) => {
  const sid = scope(user, url);
  const from = coerce(url.searchParams.get('from'), { t: 'date', req: 1, label: 'С' }, 'from');
  const to = coerce(url.searchParams.get('to'), { t: 'date', req: 1, label: 'По' }, 'to');
  if (from > to) throw bad('Неверный период');
  const p = q.get('SELECT * FROM profiles WHERE user_id=?', sid);
  const inRange = (s) => s && s.slice(0, 10) >= from && s.slice(0, 10) <= to;
  const tasks = q.all("SELECT t.*, s.title stage_title FROM tasks t LEFT JOIN route_stages s ON s.id=t.stage_id WHERE t.student_id=? AND t.status='Выполнено'", sid).filter((t) => inRange(t.completed_at));
  const r0 = computeRoute(sid, addDays(from, -1)), r1 = computeRoute(sid, to);
  return {
    student: { name: p.full_name, main_goal: p.main_goal }, from, to,
    progressStart: r0.overall, progressEnd: r1.overall,
    stagesCompleted: r1.stages.filter((s) => s.status === 'completed' && inRange(s.actual_end)).map((s) => ({ title: s.title, date: s.actual_end })),
    tasks: tasks.map((t) => ({ title: t.title, direction: t.direction, stage: t.stage_title, date: t.completed_at.slice(0, 10), minutes: t.minutes_spent })),
    minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0),
    records: q.all('SELECT * FROM progress_records WHERE student_id=? ORDER BY recorded_at', sid).filter((x) => inRange(x.recorded_at)),
    goalsAchieved: q.all("SELECT a.text, a.created_at FROM activity_logs a WHERE a.student_id=? AND a.kind='goal' AND a.text LIKE 'Цель достигнута%' ORDER BY a.created_at", sid).filter((x) => inRange(x.created_at)),
    comments: q.all("SELECT a.text, a.created_at FROM activity_logs a WHERE a.student_id=? AND a.kind='tutor_comment' ORDER BY a.created_at", sid).filter((x) => inRange(x.created_at)),
    routeChanges: q.all("SELECT a.text, a.created_at FROM activity_logs a WHERE a.student_id=? AND a.kind='route' ORDER BY a.created_at", sid).filter((x) => inRange(x.created_at)),
  };
});

route('GET', '/api/history', ({ user, url }) => {
  const sid = scope(user, url);
  const rows = q.all(`SELECT a.id,a.kind,a.text,a.created_at,p.full_name actor FROM activity_logs a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.student_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, sid);
  return rows;
});

/* ── уведомления ── */
route('GET', '/api/notifications', ({ user }) => {
  if (user.role === 'student') {
    const T = todayStr(), soon = todayStr(2);
    q.all("SELECT id,title,due_date FROM tasks WHERE student_id=? AND status NOT IN ('Выполнено','Отложено') AND due_date BETWEEN ? AND ?", user.id, T, soon)
      .forEach((t) => notify(user.id, 'deadline', 'Приближается дедлайн', `«${t.title}» · ${t.due_date}`, '#/tasks', `dl-${t.id}-${t.due_date}`));
  }
  const items = q.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 60', user.id);
  return { items, unread: q.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', user.id).c };
});
route('POST', '/api/notifications/read', ({ user, body }) => {
  if (body.id) q.run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', Number(body.id), user.id);
  else q.run('UPDATE notifications SET is_read=1 WHERE user_id=?', user.id);
  return { ok: true };
});

/* ── инструменты NMCHV ── */
route('GET', '/api/tools', () => q.all('SELECT * FROM tools ORDER BY position,id'));
route('POST', '/api/tools', ({ user, body }) => { needAdmin(user); return { id: ins('tools', { ...V(body, S.tool), status: body.status || 'Доступно' }) }; });
route('PATCH', '/api/tools/(\\d+)', ({ user, params, body }) => { needAdmin(user); upd('tools', +params[0], V(body, S.tool, true)); return { ok: true }; });
route('DELETE', '/api/tools/(\\d+)', ({ user, params }) => { needAdmin(user); q.run('DELETE FROM tools WHERE id=?', +params[0]); return { ok: true }; });

/* ── тьютор ── */
route('GET', '/api/tutor/students', ({ user }) => {
  needStaff(user);
  const rows = user.role === 'admin'
    ? q.all("SELECT id FROM users WHERE role='student' AND active=1")
    : q.all('SELECT student_id id FROM tutor_students WHERE tutor_id=?', user.id);
  const T = todayStr();
  return rows.map(({ id }) => {
    const p = q.get('SELECT * FROM profiles WHERE user_id=?', id);
    const r = computeRoute(id);
    const u = q.get('SELECT email,active FROM users WHERE id=?', id);
    return {
      id, email: u.email, name: p.full_name, photo_url: p.photo_url, main_goal: p.main_goal, status: p.status,
      stage: r.current?.title || (r.totalStages ? 'Все этапы завершены' : 'Маршрут не создан'), progress: r.overall,
      activeTasks: q.get("SELECT COUNT(*) c FROM tasks WHERE student_id=? AND status NOT IN ('Выполнено','Отложено')", id).c,
      review: q.get("SELECT COUNT(*) c FROM tasks WHERE student_id=? AND status='На проверке'", id).c,
      overdue: q.get("SELECT COUNT(*) c FROM tasks WHERE student_id=? AND status NOT IN ('Выполнено','Отложено') AND due_date<?", id, T).c,
      nextDeadline: q.get("SELECT MIN(due_date) d FROM tasks WHERE student_id=? AND status NOT IN ('Выполнено','Отложено') AND due_date>=?", id, T).d,
      lastActivity: q.get('SELECT MAX(created_at) d FROM activity_logs WHERE student_id=? AND actor_id=?', id, id).d,
    };
  });
});
route('POST', '/api/tutor/students', ({ user, body }) => {
  needStaff(user);
  const dirs = Array.isArray(body.directions) ? body.directions : [];
  const id = createUser({ email: body.email, password: body.password, role: 'student', full_name: String(body.full_name || ''), main_goal: body.main_goal || '', directions: dirs, tutorId: user.id });
  return { id };
});
route('DELETE', '/api/tutor/students/(\\d+)', ({ user, params }) => {
  needStaff(user);
  if (user.role === 'admin') throw bad('Используйте раздел администратора', 400);
  assertAccess(user, +params[0]);
  q.run('DELETE FROM tutor_students WHERE tutor_id=? AND student_id=?', user.id, +params[0]);
  return { ok: true };
});

/* ── администратор ── */
route('GET', '/api/admin/users', ({ user }) => {
  needAdmin(user);
  const users = q.all('SELECT u.id,u.email,u.role,u.active,u.created_at,p.full_name name FROM users u LEFT JOIN profiles p ON p.user_id=u.id ORDER BY u.id');
  const links = q.all('SELECT tutor_id,student_id FROM tutor_students');
  return { users: users.map((u) => ({ ...u, tutors: links.filter((l) => l.student_id === u.id).map((l) => l.tutor_id), students: links.filter((l) => l.tutor_id === u.id).map((l) => l.student_id) })) };
});
route('POST', '/api/admin/users', ({ user, body }) => {
  needAdmin(user);
  if (!['student', 'tutor', 'admin'].includes(body.role)) throw bad('Неверная роль');
  return { id: createUser({ email: body.email, password: body.password, role: body.role, full_name: String(body.full_name || '') }) };
});
route('PATCH', '/api/admin/users/(\\d+)', ({ user, params, body }) => {
  needAdmin(user); const id = +params[0];
  const u = q.get('SELECT * FROM users WHERE id=?', id); if (!u) throw bad('Не найдено', 404);
  if (id === user.id && (body.role && body.role !== 'admin' || body.active === false || body.active === 0)) throw bad('Нельзя понизить или отключить себя');
  if (body.role) { if (!['student', 'tutor', 'admin'].includes(body.role)) throw bad('Неверная роль'); q.run('UPDATE users SET role=? WHERE id=?', body.role, id);
    if (body.role === 'student' && !q.get('SELECT 1 x FROM learning_routes WHERE student_id=?', id)) ins('learning_routes', { student_id: id, created_at: nowIso() }); }
  if (body.active !== undefined) { q.run('UPDATE users SET active=? WHERE id=?', body.active ? 1 : 0, id); if (!body.active) q.run('DELETE FROM sessions WHERE user_id=?', id); }
  if (body.password) { q.run('UPDATE users SET password_hash=? WHERE id=?', hashPw(pwOk(body.password)), id); q.run('DELETE FROM sessions WHERE user_id=?', id); }
  return { ok: true };
});
route('POST', '/api/admin/link', ({ user, body }) => {
  needAdmin(user);
  const t = q.get("SELECT id FROM users WHERE id=? AND role IN ('tutor','admin')", Number(body.tutor_id));
  const s = q.get("SELECT id FROM users WHERE id=? AND role='student'", Number(body.student_id));
  if (!t || !s) throw bad('Неверные пользователи');
  if (body.unlink) q.run('DELETE FROM tutor_students WHERE tutor_id=? AND student_id=?', t.id, s.id);
  else if (!q.get('SELECT 1 x FROM tutor_students WHERE tutor_id=? AND student_id=?', t.id, s.id)) ins('tutor_students', { tutor_id: t.id, student_id: s.id, created_at: nowIso() });
  return { ok: true };
});

/* ───────── HTTP ───────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; script-src 'self'; connect-src 'self' https://tutor.nmchv.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, code, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(code, { ...SEC, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 200_000) { reject(bad('Слишком большой запрос', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Неверный JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const url = new URL(req.url, `${proto}://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const m = req.method;
      let found = null, params = [];
      for (const r of R) { if (r.method !== m) continue; const x = r.re.exec(url.pathname); if (x) { found = r; params = x.slice(1); break; } }
      if (!found) throw bad('Не найдено', 404);
      if (m !== 'GET' && req.headers['x-requested-with'] !== 'nmchv') throw bad('Запрос отклонён', 403);
      const user = currentUser(req);
      if (!found.pub && !user) throw bad('Требуется вход', 401);
      const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
      const out = found.fn({ req, res, user, url, params, body });
      return send(res, 200, out ?? { ok: true }, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('Не найдено', 404);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) throw bad('Нет доступа', 403);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw bad('Не найдено', 404);
    const ext = path.extname(file);
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache' });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message }, { 'Content-Type': 'application/json; charset=utf-8' });
    console.error(e);
    return send(res, 500, { error: 'Внутренняя ошибка сервера' }, { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`NMCHV Student: http://localhost:${PORT}`));
