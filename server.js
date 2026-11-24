import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSupabaseClient, getUserFromToken } from './lib/supabase.js';
import {
  select, insert, update, remove, removeWhere, get,
  client as supaClient,
} from './lib/db.js';
import { computeRoute, goalProgress, WEIGHT } from './progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

/* ───────── Supabase клиенты ───────── */
// Клиент от имени текущего пользователя (JWT) — RLS применяется.
function sbFor(accessToken) {
  return createSupabaseClient(accessToken);
}
// Админский клиент (server-side, только service role) — для создания
// пользователей и ролей. Не используется в клиентском коде.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbAdmin = SERVICE_ROLE_KEY ? createSupabaseClient(SERVICE_ROLE_KEY) : null;

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
  if (s.t === 'bool') return v ? true : false;
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

const isStaff = (u) => u.role === 'tutor' || u.role === 'admin';

/* ───────── авторизация (Supabase Auth) ───────── */
// Извлекает Bearer-токен из заголовка Authorization.
function extractToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Возвращает текущего пользователя из подтверждённой сессии Supabase Auth (JWT).
// Подгружает роль из tutor_user_roles.
async function currentUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = sbFor(token);
  const row = await get(sb, 'tutor_user_roles', { user_id: user.id });
  const role = row ? row.role : 'student';
  const active = row === undefined || row.active !== false;
  if (!active) return null;
  return { id: user.id, email: user.email || '', role, token };
}

function needStaff(u) { if (!isStaff(u)) throw bad('Недостаточно прав', 403); }
function needAdmin(u) { if (u.role !== 'admin') throw bad('Только для администратора', 403); }

async function assertAccess(u, studentId) {
  if (!studentId) throw bad('Не найдено', 404);
  if (u.role === 'student') { if (u.id !== studentId) throw bad('Нет доступа', 403); return; }
  const st = await get(sbFor(u.token), 'tutor_students', { tutor_id: u.id, student_id: studentId });
  if (u.role === 'admin') return;
  if (!st) throw bad('Нет доступа к этому ученику', 403);
}

function scope(u, url) {
  if (u.role === 'student') return u.id;
  const sid = url.searchParams.get('student');
  if (!sid) throw bad('Не указан ученик');
  // assertAccess is async; caller must await. Here we return sid and check inside.
  return sid;
}

async function assertAccessBySid(u, sid) {
  if (u.role === 'student') { if (u.id !== sid) throw bad('Нет доступа', 403); return sid; }
  if (u.role === 'admin') return sid;
  const st = await get(sbFor(u.token), 'tutor_students', { tutor_id: u.id, student_id: sid });
  if (!st) throw bad('Нет доступа к этому ученику', 403);
  return sid;
}

async function own(sb, table, id, u) {
  const r = await get(sb, table, { id });
  if (!r) throw bad('Не найдено', 404);
  const sid = r.student_id ?? r.owner_student_id;
  if (sid) await assertAccessBySid(u, sid);
  return r;
}

async function tutorsOf(sb, sid) {
  const rows = await select(sb, 'tutor_students', { student_id: sid });
  return rows.map((r) => r.tutor_id);
}

async function nameOf(sb, id) {
  const p = await get(sb, 'profiles', { id });
  return p ? p.full_name : '—';
}

async function log(sb, sid, actor, kind, text) {
  await insert(sb, 'tutor_activity_logs', { student_id: sid, actor_id: actor, kind, text, created_at: new Date().toISOString() });
}

const FREQ = { all: null, important: ['task', 'comment', 'review', 'deadline'], minimal: ['comment', 'review'] };
async function notify(sb, userId, kind, title, body = '', link = null, ref = null) {
  const p = await get(sb, 'profiles', { id: userId });
  const allow = FREQ[p?.notify_freq || 'all'];
  if (allow && !allow.includes(kind)) return;
  if (ref) {
    const existing = await get(sb, 'notifications', { user_id: userId, ref });
    if (existing) return;
  }
  await insert(sb, 'notifications', { user_id: userId, kind, title, body, link, ref, is_read: false, created_at: new Date().toISOString() });
}

/* ───────── профиль / пользователь ───────── */
async function me(sb, u) {
  const p = await get(sb, 'profiles', { id: u.id });
  const profile = p ? { ...p, directions: JSON.parse(p.directions || '[]') } : null;
  return { id: u.id, email: u.email, role: u.role, profile };
}

/* ───────── валидация ссылок ───────── */
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
async function checkRefs(sb, sid, d) {
  if (d.stage_id && !(await get(sb, 'tutor_route_stages', { id: d.stage_id, student_id: sid }))) throw bad('Этап не найден');
  if (d.milestone_id && !(await get(sb, 'tutor_milestones', { id: d.milestone_id, student_id: sid }))) throw bad('Контрольная точка не найдена');
  if (d.goal_id && !(await get(sb, 'tutor_educational_goals', { id: d.goal_id, student_id: sid }))) throw bad('Цель не найден');
}

/* ───────── маршруты API ───────── */
const R = [];
const route = (method, re, fn, pub = false) => R.push({ method, re: new RegExp('^' + re + '$'), fn, pub });

route('GET', '/api/public', () => ({ demo: false, accounts: [] }), true);
route('POST', '/api/auth/login', async ({ req, res, body }) => {
  const email = String(body.email || '').trim().toLowerCase();
  const sb = sbFor(null);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: String(body.password || '') });
  if (error || !data.user) throw bad('Неверный email или пароль', 401);
  const u = await currentUserFromToken(req, data.session.access_token);
  res.setHeader('Set-Cookie', `sb-token=${data.session.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
  return { ...u, access_token: data.session.access_token };
}, true);

route('POST', '/api/auth/register', async ({ req, res, body }) => {
  const email = String(body.email || '').trim().toLowerCase();
  const full_name = String(body.full_name || '').trim();
  if (!full_name) throw bad('Укажите имя');
  const sb = sbFor(null);
  const { data, error } = await sb.auth.signUp({ email, password: String(body.password || ''), options: { data: { full_name } } });
  if (error || !data.user) throw bad(error?.message || 'Не удалось создать аккаунт', 400);
  if (!data.session) throw bad('Не удалось создать сессию', 400);
  const u = await currentUserFromToken(req, data.session.access_token);
  // Создаём профиль, роль и маршрут от имени нового пользователя (он сам студент).
  const sbUser = sbFor(data.session.access_token);
  await insert(sbUser, 'profiles', { id: u.id, email, full_name, start_date: todayStr() });
  await insert(sbUser, 'tutor_user_roles', { user_id: u.id, role: 'student', active: true });
  await insert(sbUser, 'tutor_learning_routes', { student_id: u.id, title: 'Образовательный маршрут', created_at: new Date().toISOString() });
  await log(sbUser, u.id, u.id, 'start', 'Начало работы в NMCHV Student');
  res.setHeader('Set-Cookie', `sb-token=${data.session.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
  return { ...u, access_token: data.session.access_token };
}, true);

route('POST', '/api/auth/logout', async ({ user, res }) => {
  const token = user.token;

  const sb = sbFor(token);
  try { await sb.auth.signOut(); } catch {}
  res.setHeader('Set-Cookie', 'sb-token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

/* ── единый вход NMCHV (login.nmchv.ru) ── */
// Общая авторизация NMCHV: после входа на login.nmchv.ru браузер перенаправляется
// сюда с параметром ?token=<JWT>. Мы сохраняем токен в HttpOnly-cookie и возвращаем
// пользователя в приложение.
route('GET', '/api/auth/callback', async ({ req, res, url }) => {
  const token = url.searchParams.get('token');
  if (!token) throw bad('Токен сессии не передан', 400);
  const user = await currentUserFromToken(req, token);
  if (!user) throw bad('Недействительный токен сессии', 401);
  res.setHeader('Set-Cookie', `sb-token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
  const redirect = url.searchParams.get('redirect') || '/';
  res.writeHead(302, { Location: redirect, 'Cache-Control': 'no-store' });
  res.end();
});

async function currentUserFromToken(req, token) {
  const user = await getUserFromToken(token);
  if (!user) return null;
  const sb = sbFor(token);
  const row = await get(sb, 'tutor_user_roles', { user_id: user.id });
  const role = row ? row.role : 'student';
  return { id: user.id, email: user.email || '', role, token };
}

route('GET', '/api/me', async ({ user }) => {
  const sb = sbFor(user.token);
  return me(sb, user);
});

route('PATCH', '/api/me', async ({ user, body }) => {
  const sb = sbFor(user.token);
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
  if (k.length) {
    const existing = await get(sb, 'profiles', { id: user.id });
    if (existing) await update(sb, 'profiles', user.id, d);
    else await insert(sb, 'profiles', { id: user.id, email: user.email, ...d, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  return me(sb, user);
});

route('POST', '/api/me/password', async ({ user, body }) => {
  const sb = sbFor(user.token);
  const pwOk = (p) => { if (typeof p !== 'string' || p.length < 8 || p.length > 100) throw bad('Пароль: от 8 до 100 символов'); return p; };
  const { error } = await sb.auth.updateUser({ password: pwOk(body.next) });
  if (error) throw bad('Не удалось сменить пароль', 400);
  return { ok: true };
});

/* ── панель ученика ── */
route('GET', '/api/dashboard', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const p = await get(sb, 'profiles', { id: sid });
  const r = await computeRoute(sb, sid);
  const goals = await goalProgress(sb, sid);
  const T = todayStr();
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid }, { order: 'due_date,id' });
  const openTasks = tasks.filter((t) => t.status !== 'Выполнено').sort((a, b) => ((a.due_date || '9').localeCompare(b.due_date || '9'))).slice(0, 7);
  const nowMin = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16).replace(' ', 'T');
  const events = await select(sb, 'tutor_events', { student_id: sid }, { order: 'starts_at' });
  const upcomingEvents = events.filter((e) => e.starts_at && e.starts_at.slice(0, 16) >= nowMin).slice(0, 6);
  const Tdate = T;
  const mile = await select(sb, 'tutor_milestones', { student_id: sid, done: false }, { order: 'due_date,id' });
  const upcomingMile = mile.filter((m) => m.due_date && m.due_date >= Tdate).slice(0, 5);
  const upcoming = [
    ...upcomingEvents.map((e) => ({ kind: e.kind, title: e.title, at: e.starts_at, note: e.note })),
    ...upcomingMile.filter((m) => !r.stages.flatMap((s) => s.milestones).find((x) => x.id === m.id)?.done).map((m) => ({ kind: 'checkpoint', title: m.title, at: m.due_date, note: '' })),
    ...openTasks.filter((t) => t.due_date && t.due_date >= Tdate && ['Высокий', 'Критический'].includes(t.priority)).map((t) => ({ kind: 'deadline', title: t.title, at: t.due_date, note: 'Дедлайн задачи' })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 7);
  const activity = await select(sb, 'tutor_activity_logs', { student_id: sid }, { order: 'created_at,id', limit: 8 });
  const activityWithActor = await Promise.all(activity.map(async (a) => {
    const actor = a.actor_id ? await nameOf(sb, a.actor_id) : '';
    return { ...a, actor };
  }));
  const comment = await get(sb, 'tutor_activity_logs', { student_id: sid, kind: 'tutor_comment' });
  const commentRow = comment ? { ...comment, actor: comment.actor_id ? await nameOf(sb, comment.actor_id) : '' } : null;
  const overdueRow = await get(sb, 'tutor_tasks', { student_id: sid });
  const overdue = tasks.filter((t) => t.status !== 'Выполнено' && t.due_date && t.due_date < T).length;
  return {
    profile: { ...p, directions: JSON.parse(p.directions || '[]') },
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: r.tasksDone, tasksTotal: r.tasksTotal,
    activeGoals: goals.filter((g) => g.status === 'Активна').length,
    days: p?.start_date ? Math.max(0, Math.floor((Date.parse(T) - Date.parse(p.start_date)) / 864e5)) : 0,
    current: r.current && { id: r.current.id, title: r.current.title, pct: r.current.pct, end_date: r.current.end_date },
    mainGoal: goals.find((g) => g.status === 'Активна' && g.priority === 'Высокий') || goals.find((g) => g.status === 'Активна') || null,
    tasks: openTasks, upcoming, activity: activityWithActor, comment: commentRow, overdue, today: T,
  };
});

/* ── маршрут ── */
route('GET', '/api/route', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const r = await computeRoute(sb, sid);
  const goalsMap = Object.fromEntries((await goalProgress(sb, sid)).map((g) => [g.id, g.title]));
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid }, { order: 'due_date,id' });
  const stages = r.stages.map((s) => ({
    ...s, goal_title: goalsMap[s.goal_id] || null,
    milestones: s.milestones.map((m) => ({ ...m, tasks: tasks.filter((t) => t.milestone_id === m.id) })),
    looseTasks: tasks.filter((t) => t.stage_id === s.id && !t.milestone_id),
  }));
  const history = await select(sb, 'tutor_activity_logs', { student_id: sid, kind: 'route' }, { order: 'created_at,id', limit: 30 });
  const goalList = await select(sb, 'tutor_educational_goals', { student_id: sid }, { order: 'id' });
  return { overall: r.overall, doneStages: r.doneStages, stages, history, goals: goalList.map((g) => ({ id: g.id, title: g.title })), today: todayStr() };
});

async function stageOwn(sb, user, id) {
  return own(sb, 'tutor_route_stages', id, user);
}
route('POST', '/api/stages', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, S.stage);
  await checkRefs(sb, sid, d);
  const rt = await get(sb, 'tutor_learning_routes', { student_id: sid });
  if (!rt) throw bad('Маршрут не найден', 404);
  const posRow = await get(sb, 'tutor_route_stages', { student_id: sid });
  const allStages = await select(sb, 'tutor_route_stages', { student_id: sid }, { order: 'position,id' });
  const pos = allStages.length;
  const inserted = await insert(sb, 'tutor_route_stages', { ...d, weight: d.weight || 1, priority: d.priority || 'Обычный', route_id: rt.id, student_id: sid, position: pos });
  await log(sb, sid, user.id, 'route', `Добавлен этап «${d.title}»`);
  await notify(sb, sid, 'route', 'Изменён маршрут', `Добавлен этап «${d.title}»`, '#/route');
  return { id: inserted.id };
});
route('PATCH', '/api/stages/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const s = await stageOwn(sb, user, +params[0]);
  const d = V(body, S.stage, true);
  await checkRefs(sb, s.student_id, d);
  await update(sb, 'tutor_route_stages', s.id, d);
  const what = d.end_date && d.end_date !== s.end_date ? `Срок этапа «${s.title}» перенесён на ${d.end_date}` : `Обновлён этап «${d.title || s.title}»`;
  await log(sb, s.student_id, user.id, 'route', what);
  await notify(sb, s.student_id, 'route', 'Изменён маршрут', what, '#/route');
  return { ok: true };
});
route('DELETE', '/api/stages/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const s = await stageOwn(sb, user, +params[0]);
  await remove(sb, 'tutor_route_stages', s.id);
  await log(sb, s.student_id, user.id, 'route', `Удалён этап «${s.title}»`);
  await notify(sb, s.student_id, 'route', 'Изменён маршрут', `Удалён этап «${s.title}»`, '#/route');
  return { ok: true };
});
route('POST', '/api/stages/(\\d+)/move', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const s = await stageOwn(sb, user, +params[0]);
  const dir = body.dir === 1 ? 1 : body.dir === -1 ? -1 : 0; if (!dir) throw bad('Неверное направление');
  const all = await select(sb, 'tutor_route_stages', { student_id: s.student_id }, { order: 'position,id' });
  const ids = all.map((r) => r.id);
  const i = ids.indexOf(s.id), j = i + dir;
  if (j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [k, id] of ids.entries()) await update(sb, 'tutor_route_stages', id, { position: k });
  await log(sb, s.student_id, user.id, 'route', `Изменена последовательность этапов («${s.title}»)`);
  await notify(sb, s.student_id, 'route', 'Изменён маршрут', `Изменён порядок этапов: «${s.title}»`, '#/route');
  return { ok: true };
});
route('POST', '/api/stages/(\\d+)/milestones', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const s = await stageOwn(sb, user, +params[0]);
  const d = V(body, S.milestone);
  const allMs = await select(sb, 'tutor_milestones', { stage_id: s.id }, { order: 'position,id' });
  const pos = allMs.length;
  const inserted = await insert(sb, 'tutor_milestones', { ...d, done: d.done || false, done_at: d.done ? new Date().toISOString() : null, stage_id: s.id, student_id: s.student_id, position: pos });
  await log(sb, s.student_id, user.id, 'route', `Добавлена контрольная точка «${d.title}» в этап «${s.title}»`);
  await notify(sb, s.student_id, 'route', 'Изменён маршрут', `Новая контрольная точка: «${d.title}»`, '#/route');
  return { id: inserted.id };
});
route('PATCH', '/api/milestones/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const m = await own(sb, 'tutor_milestones', +params[0], user);
  const d = V(body, S.milestone, true);
  if (d.done !== undefined) d.done_at = d.done ? new Date().toISOString() : null;
  await update(sb, 'tutor_milestones', m.id, d);
  if (d.done && !m.done) await log(sb, m.student_id, user.id, 'milestone', `Достигнута контрольная точка «${m.title}»`);
  return { ok: true };
});
route('DELETE', '/api/milestones/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const m = await own(sb, 'tutor_milestones', +params[0], user);
  await remove(sb, 'tutor_milestones', m.id);
  await log(sb, m.student_id, user.id, 'route', `Удалена контрольная точка «${m.title}»`);
  return { ok: true };
});

/* ── цели ── */
route('GET', '/api/goals', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const stages = await select(sb, 'tutor_route_stages', { student_id: sid }, { order: 'position' });
  const goals = await goalProgress(sb, sid);
  return { goals: goals.map((g) => ({ ...g, stageList: stages.filter((s) => s.goal_id === g.id) })), stages };
});
route('POST', '/api/goals', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, S.goal);
  const crit = criteriaOf(body.criteria);
  const inserted = await insert(sb, 'tutor_educational_goals', {
    ...d, student_id: sid, set_date: d.set_date || todayStr(), priority: d.priority || 'Обычный', status: d.status || 'Активна',
    criteria: crit || '[]', created_by: user.id, created_at: new Date().toISOString(),
  });
  await log(sb, sid, user.id, 'goal', `Добавлена цель «${d.title}»`);
  if (isStaff(user)) await notify(sb, sid, 'route', 'Новая цель', `«${d.title}»`, '#/goals');
  return { id: inserted.id };
});
route('PATCH', '/api/goals/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  const g = await own(sb, 'tutor_educational_goals', +params[0], user);
  const d = V(body, S.goal, true);
  const crit = criteriaOf(body.criteria); if (crit !== undefined) d.criteria = crit;
  if (isStaff(user) && body.tutor_comment !== undefined) {
    d.tutor_comment = coerce(body.tutor_comment, { t: 'text', max: 1500, label: 'Комментарий' }, 'tutor_comment');
    if (d.tutor_comment && d.tutor_comment !== g.tutor_comment) await notify(sb, g.student_id, 'comment', 'Комментарий к цели', `«${g.title}»`, '#/goals');
  }
  if (user.role === 'student' && g.created_by !== user.id) { for (const k of Object.keys(d)) if (k !== 'criteria') delete d[k]; }
  await update(sb, 'tutor_educational_goals', g.id, d);
  if (d.status === 'Достигнута' && g.status !== 'Достигнута') await log(sb, g.student_id, user.id, 'goal', `Цель достигнута: «${g.title}»`);
  return { ok: true };
});
route('DELETE', '/api/goals/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const g = await own(sb, 'tutor_educational_goals', +params[0], user);
  if (user.role === 'student' && g.created_by !== user.id) throw bad('Цели от тьютора удаляет тьютор', 403);
  await remove(sb, 'tutor_educational_goals', g.id);
  await log(sb, g.student_id, user.id, 'goal', `Удалена цель «${g.title}»`);
  return { ok: true };
});

/* ── задачи ── */
route('GET', '/api/tasks', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid }, { order: 'due_date,id' });
  const stages = await select(sb, 'tutor_route_stages', { student_id: sid }, { order: 'position' });
  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
  const ms = await select(sb, 'tutor_milestones', { student_id: sid }, { order: 'position' });
  const goals = await select(sb, 'tutor_educational_goals', { student_id: sid }, { order: 'id' });
  const p = await get(sb, 'profiles', { id: sid });
  const enriched = await Promise.all(tasks.map(async (t) => {
    const s = stageMap[t.stage_id];
    const m = ms.find((x) => x.id === t.milestone_id);
    const g = goals.find((x) => x.id === (t.goal_id ?? s?.goal_id));
    const comments = await select(sb, 'tutor_task_comments', { task_id: t.id });
    return { ...t, stage_title: s ? s.title : null, goal_title: g ? g.title : null, milestone_title: m ? m.title : null, comments: comments.length };
  }));
  return { tasks: enriched, directions: JSON.parse(p?.directions || '[]'), stages, milestones: ms, goals, today: todayStr() };
});

route('POST', '/api/tasks', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  let d;
  const staff = isStaff(user);
  if (staff) { d = V(body, S.taskStaff); delete d.tutor_feedback; }
  else {
    d = V(body, S.taskStaff);
    for (const k of ['tutor_feedback', 'instructions', 'resource_id']) delete d[k];
  }
  await checkRefs(sb, sid, d);
  const source = staff ? 'tutor' : 'personal';
  const st = d.status || 'Не начато';
  const inserted = await insert(sb, 'tutor_tasks', {
    ...d, student_id: sid, priority: d.priority || 'Обычный', status: st, type: d.type || 'Самостоятельная работа', source,
    completed_at: st === 'Выполнено' ? new Date().toISOString() : null, created_by: user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const id = inserted.id;
  if (source === 'tutor') {
    await log(sb, sid, user.id, 'task', `Назначена задача «${d.title}»`);
    await notify(sb, sid, 'task', 'Новая задача', `«${d.title}»${d.due_date ? ' · срок ' + d.due_date : ''}`, '#/tasks', `task-new-${id}`);
  } else await log(sb, sid, user.id, 'task', `Добавлена личная задача «${d.title}»`);
  return { id };
});

route('PATCH', '/api/tasks/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  const t = await own(sb, 'tutor_tasks', +params[0], user);
  let d = V(body, S.taskStaff, true);
  const staff = isStaff(user);
  const personal = t.source === 'personal';
  if (!staff && !personal) {
    const allowed = {}; for (const k of ['status', 'minutes_spent', 'link']) if (d[k] !== undefined) allowed[k] = d[k];
    d = allowed;
    if (d.status === 'Выполнено') d.status = 'На проверке';
  }
  if (!staff && personal) { delete d.tutor_feedback; delete d.instructions; delete d.resource_id; }
  await checkRefs(sb, t.student_id, d);
  if (d.status && d.status !== t.status) {
    if (d.status === 'Выполнено') d.completed_at = new Date().toISOString();
    else if (t.status === 'Выполнено') d.completed_at = null;
  }
  d.updated_at = new Date().toISOString();
  await update(sb, 'tutor_tasks', t.id, d);
  const ns = d.status;
  if (ns && ns !== t.status) {
    if (ns === 'Выполнено') {
      await log(sb, t.student_id, user.id, 'task_done', `Выполнена задача «${t.title}»`);
      if (staff && t.status === 'На проверке') await notify(sb, t.student_id, 'review', 'Задача принята', `«${t.title}»${d.tutor_feedback ? ' — ' + d.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
    } else if (ns === 'На проверке') {
      await log(sb, t.student_id, user.id, 'task', `Задача «${t.title}» отправлена на проверку`);
      const tutors = await tutorsOf(sb, t.student_id);
      for (const tid of tutors) await notify(sb, tid, 'review', 'Задача на проверке', `${await nameOf(sb, t.student_id)}: «${t.title}»`, `#/student/${t.student_id}/tasks`);
    } else if (staff && t.status === 'На проверке' && ns === 'В процессе') {
      await log(sb, t.student_id, user.id, 'task', `Задача «${t.title}» возвращена на доработку`);
      await notify(sb, t.student_id, 'review', 'Задача возвращена на доработку', `«${t.title}»${d.tutor_feedback ? ' — ' + d.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
    }
  } else if (staff && d.tutor_feedback && d.tutor_feedback !== t.tutor_feedback) {
    await notify(sb, t.student_id, 'comment', 'Обратная связь по задаче', `«${t.title}»`, '#/tasks');
  }
  return { ok: true, status: ns || t.status };
});

route('DELETE', '/api/tasks/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const t = await own(sb, 'tutor_tasks', +params[0], user);
  if (!isStaff(user) && t.source !== 'personal') throw bad('Задачи тьютора удаляет тьютор', 403);
  await remove(sb, 'tutor_tasks', t.id);
  return { ok: true };
});

route('GET', '/api/tasks/(\\d+)/comments', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const t = await own(sb, 'tutor_tasks', +params[0], user);
  const rows = await select(sb, 'tutor_task_comments', { task_id: t.id }, { order: 'id' });
  return Promise.all(rows.map(async (c) => {
    const p = await get(sb, 'profiles', { id: c.author_id });
    return { ...c, author: p ? p.full_name : '' };
  }));
});
route('POST', '/api/tasks/(\\d+)/comments', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  const t = await own(sb, 'tutor_tasks', +params[0], user);
  const d = V(body, { body: { t: 'text', req: 1, max: 1500, label: 'Комментарий' } });
  const inserted = await insert(sb, 'tutor_task_comments', { task_id: t.id, student_id: t.student_id, author_id: user.id, body: d.body, created_at: new Date().toISOString() });
  const id = inserted.id;
  if (isStaff(user)) await notify(sb, t.student_id, 'comment', 'Новый комментарий к задаче', `«${t.title}»: ${d.body.slice(0, 100)}`, '#/tasks');
  else {
    const tutors = await tutorsOf(sb, t.student_id);
    for (const tid of tutors) await notify(sb, tid, 'comment', 'Комментарий ученика', `${await nameOf(sb, t.student_id)} · «${t.title}»`, `#/student/${t.student_id}/tasks`);
  }
  return { id };
});

/* ── обратная связь тьютора ── */
route('POST', '/api/feedback', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, { text: { t: 'text', req: 1, max: 2000, label: 'Комментарий' } });
  await log(sb, sid, user.id, 'tutor_comment', d.text);
  await notify(sb, sid, 'comment', 'Комментарий тьютора', d.text.slice(0, 140), '#/home');
  return { ok: true };
});
route('GET', '/api/feedback', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const rows = await select(sb, 'tutor_activity_logs', { student_id: sid, kind: 'tutor_comment' }, { order: 'created_at,id', limit: 50 });
  return Promise.all(rows.map(async (a) => {
    const p = a.actor_id ? await get(sb, 'profiles', { id: a.actor_id }) : null;
    return { id: a.id, text: a.text, created_at: a.created_at, actor: p ? p.full_name : '' };
  }));
});
route('PATCH', '/api/student-profile', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, {
    motivation: { t: 'str', max: 300, label: 'Фраза' }, main_goal: { t: 'str', max: 300, label: 'Цель' },
    status: { t: 'str', max: 80, label: 'Статус' },
  }, true);
  const k = Object.keys(d);
  if (k.length) await update(sb, 'profiles', sid, d);
  return { ok: true };
});

/* ── события ── */
route('GET', '/api/events', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  return select(sb, 'tutor_events', { student_id: sid }, { order: 'starts_at' });
});
route('POST', '/api/events', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, S.event);
  const inserted = await insert(sb, 'tutor_events', { ...d, kind: d.kind || 'session', student_id: sid, created_by: user.id });
  await notify(sb, sid, 'route', 'Новое событие', `${d.title} · ${d.starts_at.replace('T', ' ')}`, '#/home');
  return { id: inserted.id };
});
route('DELETE', '/api/events/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const e = await own(sb, 'tutor_events', +params[0], user);
  await remove(sb, 'tutor_events', e.id);
  return { ok: true };
});

/* ── библиотека ── */
route('GET', '/api/resources', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const items = await select(sb, 'tutor_resources', { owner_student_id: sid }, { order: 'favorite,id' });
  const stages = await select(sb, 'tutor_route_stages', { student_id: sid }, { order: 'position' });
  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s.title]));
  const enriched = items.map((r) => ({ ...r, stage_title: r.stage_id ? stageMap[r.stage_id] : null }));
  return {
    items: enriched,
    categories: (await select(sb, 'tutor_resource_categories', {}, { order: 'position' })).map((c) => c.name),
    stages: stages.map((s) => ({ id: s.id, title: s.title })),
  };
});
route('POST', '/api/resources', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, S.resource);
  await checkRefs(sb, sid, d);
  const staff = isStaff(user);
  if (!staff) delete d.tutor_note;
  const inserted = await insert(sb, 'tutor_resources', {
    ...d, status: d.status || 'К изучению', favorite: d.favorite || false, owner_student_id: sid,
    tutor_id: staff ? user.id : null, added_by_self: staff ? false : true, created_at: new Date().toISOString(),
  });
  const id = inserted.id;
  await log(sb, sid, user.id, 'resource', `Добавлен материал «${d.title}»`);
  if (staff) await notify(sb, sid, 'resource', 'Новый материал', `«${d.title}»`, '#/library');
  return { id };
});
route('PATCH', '/api/resources/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_resources', +params[0], user);
  let d = V(body, S.resource, true);
  if (!isStaff(user)) {
    if (r.added_by_self) delete d.tutor_note;
    else d = Object.fromEntries(Object.entries(d).filter(([k]) => ['status', 'favorite'].includes(k)));
  }
  await checkRefs(sb, r.owner_student_id, d);
  await update(sb, 'tutor_resources', r.id, d);
  return { ok: true };
});
route('DELETE', '/api/resources/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_resources', +params[0], user);
  if (!isStaff(user) && !r.added_by_self) throw bad('Материалы тьютора удаляет тьютор', 403);
  await remove(sb, 'tutor_resources', r.id);
  return { ok: true };
});
route('GET', '/api/library/shared', async ({ user }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  return select(sb, 'tutor_resources', { owner_student_id: null, tutor_id: user.id }, { order: 'id' });
});
route('POST', '/api/library/shared', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const d = V(body, S.resource); delete d.stage_id; delete d.favorite; delete d.status;
  const inserted = await insert(sb, 'tutor_resources', { ...d, owner_student_id: null, tutor_id: user.id, created_at: new Date().toISOString() });
  return { id: inserted.id };
});
route('DELETE', '/api/library/shared/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const r = await get(sb, 'tutor_resources', { id: +params[0], owner_student_id: null, tutor_id: user.id });
  if (!r) throw bad('Не найдено', 404);
  await remove(sb, 'tutor_resources', r.id);
  return { ok: true };
});
route('POST', '/api/library/assign', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const r = await get(sb, 'tutor_resources', { id: Number(body.resource_id), owner_student_id: null, tutor_id: user.id });
  if (!r) throw bad('Материал не найден', 404);
  const ids = Array.isArray(body.student_ids) ? body.student_ids.map(Number).filter(Boolean).slice(0, 100) : [];
  if (!ids.length) throw bad('Выберите учеников');
  let n = 0;
  for (const sid of ids) {
    await assertAccessBySid(user, String(sid));
    await insert(sb, 'tutor_resources', { owner_student_id: sid, tutor_id: user.id, title: r.title, description: r.description, category: r.category, url: r.url, tutor_note: r.tutor_note, status: 'К изучению', added_by_self: false, created_at: new Date().toISOString() });
    await log(sb, sid, user.id, 'resource', `Добавлен материал «${r.title}»`);
    await notify(sb, sid, 'resource', 'Новый материал', `«${r.title}»`, '#/library');
    n++;
  }
  return { assigned: n };
});

/* ── рефлексия ── */
route('GET', '/api/reflections', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  let rows = await select(sb, 'tutor_reflections', { student_id: sid }, { order: 'created_at,id' });
  if (user.role !== 'student') rows = rows.filter((r) => !r.is_private);
  const questions = await select(sb, 'tutor_reflection_questions', { student_id: sid }, { order: 'id' });
  return {
    items: rows.map((r) => ({ ...r, answers: JSON.parse(r.answers || '{}') })),
    questions,
  };
});
route('POST', '/api/reflections', async ({ user, body }) => {
  const sb = sbFor(user.token);
  if (user.role !== 'student') throw bad('Записи ведёт ученик', 403);
  const a = body.answers;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw bad('Нет ответов');
  const clean = {}; let n = 0;
  const entries = Object.entries(a).slice(0, 20);
  for (const [k, v] of entries) { const t = String(v || '').trim().slice(0, 3000); if (t) { clean[String(k).slice(0, 300)] = t; n++; } }
  if (!n) throw bad('Заполните хотя бы один ответ');
  const inserted = await insert(sb, 'tutor_reflections', { student_id: user.id, answers: JSON.stringify(clean), is_private: body.is_private ? true : false, created_at: new Date().toISOString() });
  await log(sb, user.id, user.id, 'reflection', body.is_private ? 'Добавлена личная запись рефлексии' : 'Добавлена запись рефлексии');
  return { id: inserted.id };
});
route('PATCH', '/api/reflections/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_reflections', +params[0], user);
  if (user.role !== 'student') throw bad('Нет доступа', 403);
  await update(sb, 'tutor_reflections', r.id, { is_private: body.is_private ? true : false });
  return { ok: true };
});
route('DELETE', '/api/reflections/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_reflections', +params[0], user);
  if (user.role !== 'student') throw bad('Нет доступа', 403);
  await remove(sb, 'tutor_reflections', r.id);
  return { ok: true };
});
route('POST', '/api/reflection-questions', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, { text: { t: 'str', req: 1, max: 300, label: 'Вопрос' } });
  await notify(sb, sid, 'comment', 'Новый вопрос для рефлексии', d.text, '#/reflection');
  const inserted = await insert(sb, 'tutor_reflection_questions', { student_id: sid, text: d.text, created_by: user.id, created_at: new Date().toISOString() });
  return { id: inserted.id };
});
route('DELETE', '/api/reflection-questions/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_reflection_questions', +params[0], user);
  await remove(sb, 'tutor_reflection_questions', r.id);
  return { ok: true };
});

/* ── результаты / достижения ── */
route('GET', '/api/records', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  return select(sb, 'tutor_progress_records', { student_id: sid }, { order: 'recorded_at,id' });
});
route('POST', '/api/records', async ({ user, url, body }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const d = V(body, S.record);
  const inserted = await insert(sb, 'tutor_progress_records', { ...d, student_id: sid });
  await log(sb, sid, user.id, 'record', `Зафиксировано: ${d.title}${d.value ? ' — ' + d.value : ''}`);
  return { id: inserted.id };
});
route('DELETE', '/api/records/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  const r = await own(sb, 'tutor_progress_records', +params[0], user);
  await remove(sb, 'tutor_progress_records', r.id);
  return { ok: true };
});

/* ── аналитика и отчёт ── */
const monday = (ds) => { const d = new Date(ds + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

route('GET', '/api/analytics', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const T = todayStr();
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid });
  const done = tasks.filter((t) => t.status === 'Выполнено' && t.completed_at);
  const dday = (t) => String(t.completed_at).slice(0, 10);
  const wk0 = monday(T);
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const from = addDays(wk0, -7 * i), to = addDays(from, 6);
    weeks.push({
      from, done: done.filter((t) => dday(t) >= from && dday(t) <= to).length,
      planned: tasks.filter((t) => t.due_date && t.due_date >= from && t.due_date <= to).length,
      progress: (await computeRoute(sb, sid, i === 0 ? T : to)).overall,
    });
  }
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    months.push({ key, done: done.filter((t) => dday(t).startsWith(key)).length });
  }
  const p = await get(sb, 'profiles', { id: sid });
  const dirNames = [...new Set([...JSON.parse(p?.directions || '[]'), ...tasks.map((t) => t.direction).filter(Boolean)])];
  const directions = [];
  for (const name of dirNames) {
    const ts = tasks.filter((t) => t.direction === name);
    let tot = 0, dn = 0;
    for (const t of ts) { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; }
    directions.push({ name, total: ts.length, done: ts.filter((t) => t.status === 'Выполнено').length, pct: tot ? Math.round((dn / tot) * 100) : 0, minutes: ts.reduce((a, t) => a + t.minutes_spent, 0) });
  }
  const r = await computeRoute(sb, sid);
  const plan = r.stages.map((s) => ({
    title: s.title, start: s.start_date, planned_end: s.end_date, actual_end: s.actual_end, pct: s.pct, status: s.status,
    delta: s.actual_end && s.end_date ? Math.round((Date.parse(s.actual_end) - Date.parse(s.end_date)) / 864e5) : null,
  }));
  const lateDone = done.filter((t) => t.due_date);
  const onTime = lateDone.filter((t) => dday(t) <= t.due_date).length;
  const goals = await goalProgress(sb, sid);
  return {
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: done.length, tasksTotal: tasks.length,
    minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0), onTimePct: lateDone.length ? Math.round((onTime / lateDone.length) * 100) : null,
    weeks, months, directions, plan, goals,
    records: await select(sb, 'tutor_progress_records', { student_id: sid }, { order: 'recorded_at,id' }), today: T,
  };
});

route('GET', '/api/report', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const from = coerce(url.searchParams.get('from'), { t: 'date', req: 1, label: 'С' }, 'from');
  const to = coerce(url.searchParams.get('to'), { t: 'date', req: 1, label: 'По' }, 'to');
  if (from > to) throw bad('Неверный период');
  const p = await get(sb, 'profiles', { id: sid });
  const inRange = (s) => s && String(s).slice(0, 10) >= from && String(s).slice(0, 10) <= to;
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid });
  const doneTasks = tasks.filter((t) => t.status === 'Выполнено').filter((t) => inRange(t.completed_at));
  const r0 = await computeRoute(sb, sid, addDays(from, -1));
  const r1 = await computeRoute(sb, sid, to);
  const stagesCompleted = r1.stages.filter((s) => s.status === 'completed' && inRange(s.actual_end)).map((s) => ({ title: s.title, date: s.actual_end }));
  const records = await select(sb, 'tutor_progress_records', { student_id: sid }, { order: 'recorded_at' });
  const goalsAchievedLogs = await select(sb, 'tutor_activity_logs', { student_id: sid, kind: 'goal' }, { order: 'created_at' });
  const goalsAchieved = goalsAchievedLogs.filter((x) => inRange(x.created_at) && /Цель достигнута/.test(x.text));
  const commentsLogs = await select(sb, 'tutor_activity_logs', { student_id: sid, kind: 'tutor_comment' }, { order: 'created_at' });
  const comments = commentsLogs.filter((x) => inRange(x.created_at));
  const routeLogs = await select(sb, 'tutor_activity_logs', { student_id: sid, kind: 'route' }, { order: 'created_at' });
  const routeChanges = routeLogs.filter((x) => inRange(x.created_at));
  return {
    student: { name: p?.full_name, main_goal: p?.main_goal }, from, to,
    progressStart: r0.overall, progressEnd: r1.overall,
    stagesCompleted,
    tasks: doneTasks.map((t) => ({ title: t.title, direction: t.direction, stage: null, date: String(t.completed_at).slice(0, 10), minutes: t.minutes_spent })),
    minutes: doneTasks.reduce((a, t) => a + t.minutes_spent, 0),
    records: records.filter((x) => inRange(x.recorded_at)),
    goalsAchieved: goalsAchieved.map((x) => ({ text: x.text, created_at: x.created_at })),
    comments: comments.map((x) => ({ text: x.text, created_at: x.created_at })),
    routeChanges: routeChanges.map((x) => ({ text: x.text, created_at: x.created_at })),
  };
});

route('GET', '/api/history', async ({ user, url }) => {
  const sb = sbFor(user.token);
  const sid = user.role === 'student' ? user.id : await assertAccessBySid(user, url.searchParams.get('student') || '');
  const rows = await select(sb, 'tutor_activity_logs', { student_id: sid }, { order: 'created_at,id', limit: 200 });
  return Promise.all(rows.map(async (a) => {
    const p = a.actor_id ? await get(sb, 'profiles', { id: a.actor_id }) : null;
    return { id: a.id, kind: a.kind, text: a.text, created_at: a.created_at, actor: p ? p.full_name : '' };
  }));
});

/* ── уведомления ── */
route('GET', '/api/notifications', async ({ user }) => {
  const sb = sbFor(user.token);
  if (user.role === 'student') {
    const T = todayStr(), soon = todayStr(2);
    const tasks = await select(sb, 'tutor_tasks', { student_id: user.id });
    for (const t of tasks) {
      if (t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date >= T && t.due_date <= soon) {
        const ref = `dl-${t.id}-${t.due_date}`;
        const existing = await get(sb, 'notifications', { user_id: user.id, ref });
        if (!existing) await notify(sb, user.id, 'deadline', 'Приближается дедлайн', `«${t.title}» · ${t.due_date}`, '#/tasks', ref);
      }
    }
  }
  const items = await select(sb, 'notifications', { user_id: user.id }, { order: 'created_at,id', limit: 60 });
  const unreadRows = await select(sb, 'notifications', { user_id: user.id, is_read: false });
  return { items, unread: unreadRows.length };
});
route('POST', '/api/notifications/read', async ({ user, body }) => {
  const sb = sbFor(user.token);
  if (body.id) await update(sb, 'notifications', Number(body.id), { is_read: true });
  else {
    const rows = await select(sb, 'notifications', { user_id: user.id, is_read: false });
    for (const n of rows) await update(sb, 'notifications', n.id, { is_read: true });
  }
  return { ok: true };
});

/* ── инструменты NMCHV ── */
route('GET', '/api/tools', async ({ user }) => {
  const sb = sbFor(user.token);
  return select(sb, 'tutor_tools', {}, { order: 'position,id' });
});
route('POST', '/api/tools', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  const inserted = await insert(sb, 'tutor_tools', { ...V(body, S.tool), status: body.status || 'Доступно' });
  return { id: inserted.id };
});
route('PATCH', '/api/tools/(\\d+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  await update(sb, 'tutor_tools', +params[0], V(body, S.tool, true));
  return { ok: true };
});
route('DELETE', '/api/tools/(\\d+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  await remove(sb, 'tutor_tools', +params[0]);
  return { ok: true };
});

/* ── тьютор ── */
route('GET', '/api/tutor/students', async ({ user }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  let rows;
  if (user.role === 'admin') {
    rows = await select(sb, 'tutor_user_roles', { role: 'student', active: true });
  } else {
    const links = await select(sb, 'tutor_students', { tutor_id: user.id });
    rows = links.map((l) => ({ user_id: l.student_id }));
  }
  const T = todayStr();
  const out = [];
  for (const row of rows) {
    const id = row.user_id;
    const p = await get(sb, 'profiles', { id });
    const r = await computeRoute(sb, id);
    const u = await get(sb, 'profiles', { id }); // email from auth not in profiles; fetch role row
    const roleRow = await get(sb, 'tutor_user_roles', { user_id: id });
    const activeTasks = await get(sb, 'tutor_tasks', { student_id: id });
    const active = activeTasks.filter((t) => !['Выполнено', 'Отложено'].includes(t.status)).length;
    const review = activeTasks.filter((t) => t.status === 'На проверке').length;
    const overdue = activeTasks.filter((t) => t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date < T).length;
    const nextDeadlineRow = activeTasks.filter((t) => t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date >= T).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'))[0];
    out.push({
      id, email: p?.email || '', name: p?.full_name, photo_url: p?.photo_url, main_goal: p?.main_goal, status: p?.status,
      stage: r.current?.title || (r.totalStages ? 'Все этапы завершены' : 'Маршрут не создан'), progress: r.overall,
      active, review, overdue, nextDeadline: nextDeadlineRow ? nextDeadlineRow.due_date : null,
      lastActivity: null,
    });
  }
  return out;
});
route('POST', '/api/tutor/students', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  // Создание ученика требует service role (Supabase Auth admin API).
  if (!sbAdmin) throw bad('Создание пользователей недоступно (не настроен service role)', 500);
  const dirs = Array.isArray(body.directions) ? body.directions : [];
  const { data, error } = await sbAdmin.auth.admin.createUser({
    email: body.email, password: body.password, email_confirm: true,
    user_metadata: { full_name: String(body.full_name || '') },
  });
  if (error || !data.user) throw bad(error?.message || 'Не удалось создать ученика', 400);
  const id = data.user.id;
  await sbAdmin.from('tutor_user_roles').insert({ user_id: id, role: 'student', active: true });
  await sbAdmin.from('profiles').insert({ id, email: body.email.toLowerCase(), full_name: String(body.full_name || ''), main_goal: body.main_goal || '', directions: JSON.stringify(dirs.slice(0, 12).map((d) => String(d).slice(0, 60))), start_date: todayStr() });
  await sbAdmin.from('tutor_learning_routes').insert({ student_id: id, title: 'Образовательный маршрут', created_at: new Date().toISOString() });
  await sbAdmin.from('tutor_students').insert({ tutor_id: user.id, student_id: id, created_at: new Date().toISOString() });
  return { id };
});
route('DELETE', '/api/tutor/students/([0-9a-f-]+)', async ({ user, params }) => {
  const sb = sbFor(user.token);
  needStaff(user);
  if (user.role === 'admin') throw bad('Используйте раздел администратора', 400);
  const sid = params[0];
  await assertAccessBySid(user, sid);
  await removeWhere(sb, 'tutor_students', { tutor_id: user.id, student_id: sid });
  return { ok: true };
});

/* ── администратор ── */
route('GET', '/api/admin/users', async ({ user }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  const users = await select(sb, 'tutor_user_roles', {}, { order: 'id' });
  const links = await select(sb, 'tutor_students');
  const out = [];
  for (const ur of users) {
    const id = ur.user_id;
    const p = await get(sb, 'profiles', { id });
    const roleRow = await get(sb, 'tutor_user_roles', { user_id: id });
    out.push({
      id, email: p?.email || '', role: roleRow?.role || ur.role, active: roleRow?.active !== false,
      created_at: roleRow?.created_at, name: p?.full_name,
      tutors: links.filter((l) => l.student_id === id).map((l) => l.tutor_id),
      students: links.filter((l) => l.tutor_id === id).map((l) => l.student_id),
    });
  }
  return { users: out };
});
route('POST', '/api/admin/users', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  if (!sbAdmin) throw bad('Создание пользователей недоступно (не настроен service role)', 500);
  if (!['student', 'tutor', 'admin'].includes(body.role)) throw bad('Неверная роль');
  const { data, error } = await sbAdmin.auth.admin.createUser({
    email: body.email, password: body.password, email_confirm: true,
    user_metadata: { full_name: String(body.full_name || '') },
  });
  if (error || !data.user) throw bad(error?.message || 'Не удалось создать пользователя', 400);
  const id = data.user.id;
  await sbAdmin.from('tutor_user_roles').insert({ user_id: id, role: body.role, active: true });
  await sbAdmin.from('profiles').insert({ id, email: body.email.toLowerCase(), full_name: String(body.full_name || ''), start_date: todayStr() });
  if (body.role === 'student') {
    await sbAdmin.from('tutor_learning_routes').insert({ student_id: id, created_at: new Date().toISOString() });
  }
  return { id };
});
route('PATCH', '/api/admin/users/([0-9a-f-]+)', async ({ user, params, body }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  const id = String(params[0]); // uuid
  const roleRow = await get(sb, 'tutor_user_roles', { user_id: id });
  if (!roleRow) throw bad('Не найдено', 404);
  if (id === user.id && (body.role && body.role !== 'admin' || body.active === false || body.active === 0)) throw bad('Нельзя понизить или отключить себя');
  if (body.role) {
    if (!['student', 'tutor', 'admin'].includes(body.role)) throw bad('Неверная роль');
    await sbAdmin.from('tutor_user_roles').update({ role: body.role }).eq('user_id', id);
    if (body.role === 'student') {
      const hasRoute = await get(sb, 'tutor_learning_routes', { student_id: id });
      if (!hasRoute) await sbAdmin.from('tutor_learning_routes').insert({ student_id: id, created_at: new Date().toISOString() });
    }
  }
  if (body.active !== undefined) {
    await sbAdmin.from('tutor_user_roles').update({ active: body.active ? true : false }).eq('user_id', id);
    if (!body.active) {
      // нельзя легко удалить сессии без service role; пропускаем
    }
  }
  if (body.password) {
    const pwOk = (p) => { if (typeof p !== 'string' || p.length < 8 || p.length > 100) throw bad('Пароль: от 8 до 100 символов'); return p; };
    await sbAdmin.auth.admin.updateUserById(id, { password: pwOk(body.password) });
  }
  return { ok: true };
});
route('POST', '/api/admin/link', async ({ user, body }) => {
  const sb = sbFor(user.token);
  needAdmin(user);
  const tutorId = String(body.tutor_id);
  const studentId = String(body.student_id);
  const t = await get(sb, 'tutor_user_roles', { user_id: tutorId });
  const s = await get(sb, 'tutor_user_roles', { user_id: studentId });
  if (!t || t.role !== 'tutor' && t.role !== 'admin') throw bad('Неверные пользователи');
  if (!s || s.role !== 'student') throw bad('Неверные пользователи');
  if (body.unlink) await removeWhere(sb, 'tutor_students', { tutor_id: tutorId, student_id: studentId });
  else {
    const existing = await get(sb, 'tutor_students', { tutor_id: tutorId, student_id: studentId });
    if (!existing) await insert(sb, 'tutor_students', { tutor_id: tutorId, student_id: studentId, created_at: new Date().toISOString() });
  }
  return { ok: true };
});

/* ───────── HTTP ───────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; script-src 'self' https://cdn.jsdelivr.net https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
      if (m !== 'GET' && m !== 'HEAD' && req.headers['x-requested-with'] !== 'nmchv') throw bad('Запрос отклонён', 403);
      const user = await currentUser(req);
      if (!found.pub && !user) throw bad('Требуется вход', 401);
      const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
      const out = await found.fn({ req, res, user, url, params, body });
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

server.listen(PORT, '0.0.0.0', () => console.log(`NMCHV Tutor: http://localhost:${PORT}`));
