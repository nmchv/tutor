const STORAGE_KEY = 'nmchv-student-data';
const SESSION_KEY = 'nmchv-session';

let dataCache = null;
let sessionCache = null;

function loadData() {
  if (dataCache) return dataCache;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { dataCache = JSON.parse(stored); } catch { dataCache = null; }
  }
  if (!dataCache) {
    dataCache = getInitialData();
    saveData();
  }
  return dataCache;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataCache));
}

function getSession() {
  if (sessionCache) return sessionCache;
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try { sessionCache = JSON.parse(stored); } catch { sessionCache = null; }
  }
  return sessionCache;
}

function setSession(session) {
  sessionCache = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function getInitialData() {
  return {
    users: [], profiles: [], tutor_students: [],
    learning_routes: [], route_stages: [], milestones: [],
    educational_goals: [], tasks: [], task_comments: [],
    resources: [], progress_records: [], reflections: [],
    reflection_questions: [], events: [], activity_logs: [],
    notifications: [], tools: [], resource_categories: [],
  };
}

function generateId(table) {
  const data = loadData();
  const maxId = data[table].reduce((max, item) => Math.max(max, item.id || 0), 0);
  return maxId + 1;
}

function nowIso() { return new Date().toISOString(); }
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }); }

function simpleHash(str) {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = ((h2 << 5) + h2) ^ c;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const h = simpleHash(pw + saltHex);
  return 's1$' + saltHex + '$' + h;
}

async function verifyPw(pw, stored) {
  try {
    const [v, s, h] = stored.split('$');
    if (v !== 's1') return false;
    const calc = simpleHash(pw + s);
    return calc === h;
  } catch { return false; }
}

function log(sid, actor, kind, text) {
  const data = loadData();
  data.activity_logs.push({ id: generateId('activity_logs'), student_id: sid, actor_id: actor, kind, text, created_at: nowIso() });
  saveData();
}

function notify(userId, kind, title, body = '', link = null, ref = null) {
  const data = loadData();
  const p = data.profiles.find(p => p.user_id === userId);
  const freq = p?.notify_freq || 'all';
  const FREQ = { all: null, important: ['task', 'comment', 'review', 'deadline'], minimal: ['comment', 'review'] };
  const allow = FREQ[freq];
  if (allow && !allow.includes(kind)) return;
  if (ref && data.notifications.find(n => n.user_id === userId && n.ref === ref)) return;
  data.notifications.push({ id: generateId('notifications'), user_id: userId, kind, title, body, link, ref, is_read: 0, created_at: nowIso() });
  saveData();
}

const Store = {
  loadData, saveData, getSession, setSession, nowIso, todayStr, log, notify,

  async getPublicInfo() { return { demo: false, accounts: [] }; },

  async login(email, password) {
    const data = loadData();
    email = email.trim().toLowerCase();
    const user = data.users.find(u => u.email.toLowerCase() === email);
    if (!user || !user.active) throw new Error('Неверный email или пароль');
    let ok = false;
    if (user.password_hash) {
      ok = await verifyPw(password, user.password_hash);
    } else if (user.password) {
      ok = password === user.password;
      if (ok) {
        user.password_hash = await hashPw(password);
        delete user.password;
        saveData();
      }
    }
    if (!ok) throw new Error('Неверный email или пароль');
    const profile = data.profiles.find(p => p.user_id === user.id);
    const session = { user: { id: user.id, email: user.email, role: user.role }, profile, token: crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '') };
    setSession(session);
    return { id: user.id, email: user.email, role: user.role, profile: { ...profile, directions: profile.directions } };
  },

  async register({ email, password, full_name }) {
    const data = loadData();
    email = email.trim().toLowerCase();
    if (data.users.find(u => u.email.toLowerCase() === email)) throw new Error('Пользователь с таким email уже существует');
    const password_hash = await hashPw(password);
    const id = generateId('users');
    data.users.push({ id, email, password_hash, role: 'student', active: true, created_at: nowIso() });
    data.profiles.push({ user_id: id, full_name: full_name.trim().slice(0, 100), main_goal: '', directions: '[]', start_date: todayStr(), status: 'Активно занимается', motivation: '', bio: '', photo_url: null, notify_freq: 'all' });
    data.learning_routes.push({ id: generateId('learning_routes'), student_id: id, title: 'Образовательный маршрут', created_at: nowIso() });
    log(id, null, 'start', 'Начало работы в NMCHV Student');
    saveData();
    const session = { user: { id, email, role: 'student' }, profile: data.profiles.find(p => p.user_id === id), token: crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '') };
    setSession(session);
    return { id, email, role: 'student', profile: data.profiles.find(p => p.user_id === id) };
  },

  async logout() { setSession(null); },

  async me() { const s = getSession(); if (!s) throw new Error('Unauthorized'); return s; },

  async updateProfile(body) {
    const data = loadData();
    const s = getSession(); if (!s) throw new Error('Unauthorized');
    const profile = data.profiles.find(p => p.user_id === s.user.id);
    Object.assign(profile, body);
    if (body.directions) profile.directions = JSON.stringify(body.directions);
    saveData();
    s.profile = profile;
    setSession(s);
    return { id: s.user.id, email: s.user.email, role: s.user.role, profile: { ...profile, directions: JSON.parse(profile.directions || '[]') } };
  },

  async changePassword(current, next) {
    const data = loadData();
    const s = getSession(); if (!s) throw new Error('Unauthorized');
    const user = data.users.find(u => u.id === s.user.id);
    if (!await verifyPw(current, user.password_hash)) throw new Error('Текущий пароль неверен');
    user.password_hash = await hashPw(next);
    saveData();
    return { ok: true };
  },

  scope(sid) {
    const s = getSession(); if (!s) throw new Error('Unauthorized');
    if (s.user.role === 'student') { if (s.user.id !== sid) throw new Error('Нет доступа'); return sid; }
    if (!sid) throw new Error('Не указан ученик');
    const student = data.users.find(u => u.id === sid && u.role === 'student');
    if (!student) throw new Error('Ученик не найден');
    if (s.user.role === 'admin') return sid;
    const link = data.tutor_students.find(t => t.tutor_id === s.user.id && t.student_id === sid);
    if (!link) throw new Error('Нет доступа к этому ученику');
    return sid;
  },

  async dashboard(studentId) {
    const data = loadData();
    const sid = this.scope(studentId);
    const p = data.profiles.find(p => p.user_id === sid);
    const route = this.computeRoute(sid);
    const goals = this.goalProgress(sid);
    const T = todayStr();
    const tasks = data.tasks.filter(t => t.student_id === sid && t.status !== 'Выполнено').sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).slice(0, 7);
    const nowMin = new Date().toISOString().slice(0, 16);
    const events = data.events.filter(e => e.student_id === sid && e.starts_at >= nowMin).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 6);
    const mile = data.milestones.filter(m => m.student_id === sid && !m.done && m.due_date >= T).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
    const upcoming = [
      ...events.map(e => ({ kind: e.kind, title: e.title, at: e.starts_at, note: e.note })),
      ...mile.filter(m => !route.stages.flatMap(s => s.milestones).find(x => x.id === m.id)?.done).map(m => ({ kind: 'checkpoint', title: m.title, at: m.due_date, note: data.route_stages.find(s => s.id === m.stage_id)?.title })),
      ...tasks.filter(t => t.due_date && t.due_date >= T && ['Высокий', 'Критический'].includes(t.priority)).map(t => ({ kind: 'deadline', title: t.title, at: t.due_date, note: 'Дедлайн задачи' })),
    ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 7);
    const activity = data.activity_logs.filter(a => a.student_id === sid).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
    const comment = data.activity_logs.filter(a => a.student_id === sid && a.kind === 'tutor_comment').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    const overdue = data.tasks.filter(t => t.student_id === sid && t.status !== 'Выполнено' && t.due_date && t.due_date < T).length;
    let dirs = [];
    try { dirs = typeof p.directions === 'string' ? JSON.parse(p.directions || '[]') : (p.directions || []); } catch { dirs = []; }
    return {
      profile: { ...p, directions: dirs },
      overall: route.overall, doneStages: route.doneStages, totalStages: route.totalStages, tasksDone: route.tasksDone, tasksTotal: route.tasksTotal,
      activeGoals: goals.filter(g => g.status === 'Активна').length,
      days: p.start_date ? Math.max(0, Math.floor((Date.parse(T) - Date.parse(p.start_date)) / 864e5)) : 0,
      current: route.current && { id: route.current.id, title: route.current.title, pct: route.current.pct, end_date: route.current.end_date },
      mainGoal: goals.find(g => g.status === 'Активна' && g.priority === 'Высокий') || goals.find(g => g.status === 'Активна') || null,
      tasks, upcoming, activity, comment, overdue, today: T,
    };
  },

  computeRoute(sid, asOf = null) {
    const data = loadData();
    const stages = data.route_stages.filter(s => s.student_id === sid).sort((a, b) => a.position - b.position || a.id - b.id);
    const ms = data.milestones.filter(m => m.student_id === sid).sort((a, b) => a.position - b.position || a.id - b.id);
    const tasks = data.tasks.filter(t => t.student_id === sid);
    const isDone = (t) => t.status === 'Выполнено' && t.completed_at && (!asOf || t.completed_at.slice(0, 10) <= asOf);
    const T = todayStr();

    const WEIGHT = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 };
    let sumW = 0, sumP = 0, doneStages = 0;
    const out = stages.map(s => {
      const st = tasks.filter(t => t.stage_id === s.id);
      const sm = ms.filter(m => m.stage_id === s.id).map(m => {
        const mt = st.filter(t => t.milestone_id === m.id);
        const manual = asOf ? m.done && m.done_at && m.done_at.slice(0, 10) <= asOf : !!m.done;
        const done = mt.length ? mt.every(isDone) : manual;
        return { ...m, done: done ? 1 : 0, taskCount: mt.length, taskDone: mt.filter(isDone).length, hasTasks: mt.length > 0 };
      });
      let total = 0, doneW = 0;
      st.forEach(t => { const w = WEIGHT[t.priority] || 2; total += w; if (isDone(t)) doneW += w; });
      sm.filter(m => !m.hasTasks).forEach(m => { total += 2; if (m.done) doneW += 2; });
      const pct = total ? Math.round((doneW / total) * 100) : 0;
      let status = 'future';
      if (total && pct >= 100) status = 'completed';
      else if (s.end_date && s.end_date < T) status = 'overdue';
      else if (!s.start_date || s.start_date <= T) status = 'current';
      if (status === 'completed') doneStages++;
      const doneDates = st.filter(isDone).map(t => t.completed_at.slice(0, 10)).sort();
      sumW += s.weight || 1;
      sumP += (s.weight || 1) * pct;
      return {
        ...s, pct, status, milestones: sm,
        tasksTotal: st.length, tasksDone: st.filter(isDone).length,
        actual_end: status === 'completed' ? doneDates[doneDates.length - 1] || null : null,
      };
    });
    const overall = sumW ? Math.round(sumP / sumW) : 0;
    const current = out.find(s => s.status !== 'completed') || null;
    const isDoneAll = tasks.filter(isDone).length;
    return { stages: out, overall, doneStages, totalStages: out.length, current, tasksDone: isDoneAll, tasksTotal: tasks.length };
  },

  goalProgress(sid) {
    const data = loadData();
    const goals = data.educational_goals.filter(g => g.student_id === sid).sort((a, b) => a.id - b.id);
    const stages = data.route_stages.filter(s => s.student_id === sid);
    const tasks = data.tasks.filter(t => t.student_id === sid);
    const stageGoal = Object.fromEntries(stages.map(s => [s.id, s.goal_id]));
    const WEIGHT = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 };
    return goals.map(g => {
      let criteria = [];
      try { criteria = JSON.parse(g.criteria); } catch {}
      const mine = tasks.filter(t => (t.goal_id ?? stageGoal[t.stage_id]) === g.id);
      let tot = 0, dn = 0;
      mine.forEach(t => { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; });
      const critPct = criteria.length ? Math.round((criteria.filter(c => c.done).length / criteria.length) * 100) : null;
      let pct = tot ? Math.round((dn / tot) * 100) : critPct ?? 0;
      if (g.status === 'Достигнута') pct = 100;
      return {
        ...g, criteria, pct, critPct,
        tasksTotal: mine.length, tasksDone: mine.filter(t => t.status === 'Выполнено').length,
        stages: stages.filter(s => s.goal_id === g.id).map(s => s.id),
        stageList: stages.filter(s => s.goal_id === g.id),
      };
    });
  },

  async getRoute(studentId) {
    const sid = this.scope(studentId);
    const r = this.computeRoute(sid);
    const goals = Object.fromEntries(this.goalProgress(sid).map(g => [g.id, g.title]));
    const data = loadData();
    const tasks = data.tasks.filter(t => t.student_id === sid).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    const stages = r.stages.map(s => ({
      ...s, goal_title: goals[s.goal_id] || null,
      milestones: s.milestones.map(m => ({ ...m, tasks: tasks.filter(t => t.milestone_id === m.id) })),
      looseTasks: tasks.filter(t => t.stage_id === s.id && !t.milestone_id),
    }));
    const history = data.activity_logs.filter(a => a.student_id === sid && a.kind === 'route').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
    const goalList = data.educational_goals.filter(g => g.student_id === sid).map(g => ({ id: g.id, title: g.title }));
    return { overall: r.overall, doneStages: r.doneStages, stages, history, goals: goalList, today: todayStr() };
  },

  async createStage(sid, body) {
    const data = loadData();
    const rt = data.learning_routes.find(r => r.student_id === sid);
    const pos = (Math.max(...data.route_stages.filter(s => s.student_id === sid).map(s => s.position), -1)) + 1;
    const id = generateId('route_stages');
    data.route_stages.push({ ...body, weight: body.weight || 1, priority: body.priority || 'Обычный', route_id: rt.id, student_id: sid, position: pos, id });
    log(sid, getSession().user.id, 'route', `Добавлен этап «${body.title}»`);
    notify(sid, 'route', 'Изменён маршрут', `Добавлен этап «${body.title}»`, '#/route');
    saveData();
    return { id };
  },

  async updateStage(id, body) {
    const data = loadData();
    const s = data.route_stages.find(x => x.id === id);
    Object.assign(s, body);
    saveData();
    return { ok: true };
  },

  async deleteStage(id) {
    const data = loadData();
    const s = data.route_stages.find(x => x.id === id);
    data.route_stages = data.route_stages.filter(x => x.id !== id);
    data.milestones = data.milestones.filter(m => m.stage_id !== id);
    log(s.student_id, getSession().user.id, 'route', `Удалён этап «${s.title}»`);
    notify(s.student_id, 'route', 'Изменён маршрут', `Удалён этап «${s.title}»`, '#/route');
    saveData();
    return { ok: true };
  },

  async moveStage(id, dir) {
    const data = loadData();
    const s = data.route_stages.find(x => x.id === id);
    const all = data.route_stages.filter(x => x.student_id === s.student_id).sort((a, b) => a.position - b.position || a.id - b.id).map(x => x.id);
    const i = all.indexOf(id), j = i + dir;
    if (j < 0 || j >= all.length) return { ok: true };
    [all[i], all[j]] = [all[j], all[i]];
    all.forEach((id, k) => { const st = data.route_stages.find(x => x.id === id); st.position = k; });
    log(s.student_id, getSession().user.id, 'route', `Изменена последовательность этапов («${s.title}»)`);
    saveData();
    return { ok: true };
  },

  async createMilestone(stageId, body) {
    const data = loadData();
    const s = data.route_stages.find(x => x.id === stageId);
    const pos = (Math.max(...data.milestones.filter(m => m.stage_id === stageId).map(m => m.position), -1)) + 1;
    const id = generateId('milestones');
    data.milestones.push({ ...body, done: body.done || 0, done_at: body.done ? nowIso() : null, stage_id: s.id, student_id: s.student_id, position: pos, id });
    log(s.student_id, getSession().user.id, 'route', `Добавлена контрольная точка «${body.title}» в этап «${s.title}»`);
    notify(s.student_id, 'route', 'Изменён маршрут', `Новая контрольная точка: «${body.title}»`, '#/route');
    saveData();
    return { id };
  },

  async updateMilestone(id, body) {
    const data = loadData();
    const m = data.milestones.find(x => x.id === id);
    if (body.done !== undefined) body.done_at = body.done ? nowIso() : null;
    Object.assign(m, body);
    if (body.done && !m.done) log(m.student_id, getSession().user.id, 'milestone', `Достигнута контрольная точка «${m.title}»`);
    saveData();
    return { ok: true };
  },

  async deleteMilestone(id) {
    const data = loadData();
    const m = data.milestones.find(x => x.id === id);
    data.milestones = data.milestones.filter(x => x.id !== id);
    log(m.student_id, getSession().user.id, 'route', `Удалена контрольная точка «${m.title}»`);
    saveData();
    return { ok: true };
  },

  async getGoals(studentId) {
    const sid = this.scope(studentId);
    const data = loadData();
    const stages = data.route_stages.filter(s => s.student_id === sid).sort((a, b) => a.position - b.position);
    return { goals: this.goalProgress(sid).map(g => ({ ...g, stageList: stages.filter(s => s.goal_id === g.id) })), stages };
  },

  async createGoal(sid, body) {
    const data = loadData();
    const crit = body.criteria ? JSON.stringify(body.criteria) : '[]';
    const id = generateId('educational_goals');
    data.educational_goals.push({
      ...body, student_id: sid, set_date: body.set_date || todayStr(), priority: body.priority || 'Обычный', status: body.status || 'Активна',
      criteria: crit, created_by: getSession().user.id, created_at: nowIso(), id
    });
    log(sid, getSession().user.id, 'goal', `Добавлена цель «${body.title}»`);
    if (isStaff()) notify(sid, 'route', 'Новая цель', `«${body.title}»`, '#/goals');
    saveData();
    return { id };
  },

  async updateGoal(id, body) {
    const data = loadData();
    const g = data.educational_goals.find(x => x.id === id);
    if (body.criteria !== undefined) body.criteria = JSON.stringify(body.criteria);
    Object.assign(g, body);
    if (body.status === 'Достигнута' && g.status !== 'Достигнута') log(g.student_id, getSession().user.id, 'goal', `Цель достигнута: «${g.title}»`);
    saveData();
    return { ok: true };
  },

  async deleteGoal(id) {
    const data = loadData();
    const g = data.educational_goals.find(x => x.id === id);
    data.educational_goals = data.educational_goals.filter(x => x.id !== id);
    log(g.student_id, getSession().user.id, 'goal', `Удалена цель «${g.title}»`);
    saveData();
    return { ok: true };
  },

  async getTasks(studentId) {
    const sid = this.scope(studentId);
    const tasks = data.tasks.filter(t => t.student_id === sid).map(t => ({
      ...t, stage_title: data.route_stages.find(s => s.id === t.stage_id)?.title,
      goal_title: data.educational_goals.find(g => g.id === (t.goal_id || data.route_stages.find(s => s.id === t.stage_id)?.goal_id))?.title,
      milestone_title: data.milestones.find(m => m.id === t.milestone_id)?.title,
      comments: data.task_comments.filter(c => c.task_id === t.id).length
    }));
    const p = data.profiles.find(p => p.user_id === sid);
    const stages = data.route_stages.filter(s => s.student_id === sid).sort((a, b) => a.position - b.position);
    const milestones = data.milestones.filter(m => m.student_id === sid).sort((a, b) => a.position - b.position);
    const goals = data.educational_goals.filter(g => g.student_id === sid).map(g => ({ id: g.id, title: g.title }));
    return { tasks, directions: JSON.parse(p.directions || '[]'), stages, milestones, goals, today: todayStr() };
  },

  async createTask(sid, body) {
    const data = loadData();
    const staff = isStaff();
    const personal = !staff;
    const source = staff ? 'tutor' : 'personal';
    const st = body.status || 'Не начато';
    const id = generateId('tasks');
    data.tasks.push({
      ...body, student_id: sid, priority: body.priority || 'Обычный', status: st, type: body.type || 'Самостоятельная работа', source,
      completed_at: st === 'Выполнено' ? nowIso() : null, created_by: getSession().user.id, created_at: nowIso(), updated_at: nowIso(), id
    });
    if (source === 'tutor') {
      log(sid, getSession().user.id, 'task', `Назначена задача «${body.title}»`);
      notify(sid, 'task', 'Новая задача', `«${body.title}»${body.due_date ? ' · срок ' + body.due_date : ''}`, '#/tasks', 'task-new-' + id);
    } else log(sid, getSession().user.id, 'task', `Добавлена личная задача «${body.title}»`);
    saveData();
    return { id };
  },

  async updateTask(id, body) {
    const data = loadData();
    const t = data.tasks.find(x => x.id === id);
    const staff = isStaff();
    const personal = t.source === 'personal';
    if (!staff && !personal) {
      const allowed = {}; for (const k of ['status', 'minutes_spent', 'link']) if (body[k] !== undefined) allowed[k] = body[k];
      body = allowed;
      if (body.status === 'Выполнено') body.status = 'На проверке';
    }
    if (!staff && personal) { delete body.tutor_feedback; delete body.instructions; delete body.resource_id; }
    if (body.status && body.status !== t.status) {
      if (body.status === 'Выполнено') body.completed_at = nowIso();
      else if (t.status === 'Выполнено') body.completed_at = null;
    }
    body.updated_at = nowIso();
    Object.assign(t, body);
    const ns = body.status;
    if (ns && ns !== t.status) {
      if (ns === 'Выполнено') {
        log(t.student_id, getSession().user.id, 'task_done', `Выполнена задача «${t.title}»`);
        if (staff && t.status === 'На проверке') notify(t.student_id, 'review', 'Задача принята', `«${t.title}»${body.tutor_feedback ? ' — ' + body.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
      } else if (ns === 'На проверке') {
        log(t.student_id, getSession().user.id, 'task', `Задача «${t.title}» отправлена на проверку`);
        const tutors = data.tutor_students.filter(ts => ts.student_id === t.student_id).map(ts => ts.tutor_id);
        tutors.forEach(tid => notify(tid, 'review', 'Задача на проверке', `${data.profiles.find(p => p.user_id === t.student_id)?.full_name}: «${t.title}»`, `#/student/${t.student_id}/tasks`));
      } else if (staff && t.status === 'На проверке' && ns === 'В процессе') {
        log(t.student_id, getSession().user.id, 'task', `Задача «${t.title}» возвращена на доработку`);
        notify(t.student_id, 'review', 'Задача возвращена на доработку', `«${t.title}»${body.tutor_feedback ? ' — ' + body.tutor_feedback.slice(0, 120) : ''}`, '#/tasks');
      }
    } else if (staff && body.tutor_feedback && body.tutor_feedback !== t.tutor_feedback) {
      notify(t.student_id, 'comment', 'Обратная связь по задаче', `«${t.title}»`, '#/tasks');
    }
    saveData();
    return { ok: true, status: ns || t.status };
  },

  async deleteTask(id) {
    const data = loadData();
    const t = data.tasks.find(x => x.id === id);
    if (!isStaff() && t.source !== 'personal') throw new Error('Задачи тьютора удаляет тьютор');
    data.tasks = data.tasks.filter(x => x.id !== id);
    data.task_comments = data.task_comments.filter(c => c.task_id !== id);
    saveData();
    return { ok: true };
  },

  async getTaskComments(taskId) {
    const data = loadData();
    return data.task_comments.filter(c => c.task_id === taskId).map(c => ({
      ...c, author: data.profiles.find(p => p.user_id === c.author_id)?.full_name || '—'
    }));
  },

  async addTaskComment(taskId, body) {
    const data = loadData();
    const t = data.tasks.find(x => x.id === taskId);
    const id = generateId('task_comments');
    data.task_comments.push({ task_id: taskId, student_id: t.student_id, author_id: getSession().user.id, body: body.body, created_at: nowIso(), id });
    if (isStaff()) notify(t.student_id, 'comment', 'Новый комментарий к задаче', `«${t.title}»: ${body.body.slice(0, 100)}`, '#/tasks');
    else {
      const tutors = data.tutor_students.filter(ts => ts.student_id === t.student_id).map(ts => ts.tutor_id);
      tutors.forEach(tid => notify(tid, 'comment', 'Комментарий ученика', `${data.profiles.find(p => p.user_id === t.student_id)?.full_name} · «${t.title}»`, `#/student/${t.student_id}/tasks`));
    }
    saveData();
    return { id };
  },

  async addFeedback(sid, body) {
    const data = loadData();
    log(sid, getSession().user.id, 'tutor_comment', body.text);
    notify(sid, 'comment', 'Комментарий тьютора', body.text.slice(0, 140), '#/home');
    saveData();
    return { ok: true };
  },

  async getFeedback(studentId) {
    const sid = this.scope(studentId);
    return data.activity_logs.filter(a => a.student_id === sid && a.kind === 'tutor_comment').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
  },

  async updateStudentProfile(sid, body) {
    const data = loadData();
    const p = data.profiles.find(x => x.user_id === sid);
    Object.assign(p, body);
    saveData();
    return { ok: true };
  },

  async getEvents(studentId) {
    const sid = this.scope(studentId);
    return data.events.filter(e => e.student_id === sid).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  },

  async createEvent(sid, body) {
    const data = loadData();
    const id = generateId('events');
    data.events.push({ ...body, kind: body.kind || 'session', student_id: sid, created_by: getSession().user.id, id });
    notify(sid, 'route', 'Новое событие', `${body.title} · ${body.starts_at.replace('T', ' ')}`, '#/home');
    saveData();
    return { id };
  },

  async deleteEvent(id) {
    const data = loadData();
    data.events = data.events.filter(e => e.id !== id);
    saveData();
    return { ok: true };
  },

  async getResources(studentId) {
    const sid = this.scope(studentId);
    const items = data.resources.filter(r => r.owner_student_id === sid).map(r => ({
      ...r, stage_title: data.route_stages.find(s => s.id === r.stage_id)?.title
    })).sort((a, b) => b.favorite - a.favorite || b.id - a.id);
    return {
      items, categories: data.resource_categories.map(c => c.name),
      stages: data.route_stages.filter(s => s.student_id === sid).sort((a, b) => a.position - b.position),
    };
  },

  async createResource(sid, body) {
    const data = loadData();
    const staff = isStaff();
    if (!staff) delete body.tutor_note;
    const id = generateId('resources');
    data.resources.push({ ...body, status: body.status || 'К изучению', favorite: body.favorite || 0, owner_student_id: sid, tutor_id: staff ? getSession().user.id : null, added_by_self: staff ? 0 : 1, created_at: nowIso(), id });
    log(sid, getSession().user.id, 'resource', `Добавлен материал «${body.title}»`);
    if (staff) notify(sid, 'resource', 'Новый материал', `«${body.title}»`, '#/library');
    saveData();
    return { id };
  },

  async updateResource(id, body) {
    const data = loadData();
    const r = data.resources.find(x => x.id === id);
    if (!isStaff()) {
      if (r.added_by_self) delete body.tutor_note;
      else body = Object.fromEntries(Object.entries(body).filter(([k]) => ['status', 'favorite'].includes(k)));
    }
    Object.assign(r, body);
    saveData();
    return { ok: true };
  },

  async deleteResource(id) {
    const data = loadData();
    const r = data.resources.find(x => x.id === id);
    if (!isStaff() && !r.added_by_self) throw new Error('Материалы тьютора удаляет тьютор');
    data.resources = data.resources.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async getSharedLibrary() {
    const data = loadData();
    return data.resources.filter(r => r.owner_student_id === null && r.tutor_id === getSession().user.id).sort((a, b) => b.id - a.id);
  },

  async createSharedResource(body) {
    const data = loadData();
    const id = generateId('resources');
    data.resources.push({ ...body, owner_student_id: null, tutor_id: getSession().user.id, created_at: nowIso(), id });
    saveData();
    return { id };
  },

  async deleteSharedResource(id) {
    const data = loadData();
    const r = data.resources.find(x => x.id === id && x.owner_student_id === null && x.tutor_id === getSession().user.id);
    if (!r) throw new Error('Не найдено');
    data.resources = data.resources.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async assignResource(resourceId, studentIds) {
    const data = loadData();
    const r = data.resources.find(x => x.id === resourceId && x.owner_student_id === null && x.tutor_id === getSession().user.id);
    if (!r) throw new Error('Материал не найден');
    let n = 0;
    for (const sid of studentIds) {
      data.resources.push({ owner_student_id: sid, tutor_id: getSession().user.id, title: r.title, description: r.description, category: r.category, url: r.url, tutor_note: r.tutor_note, status: 'К изучению', added_by_self: 0, created_at: nowIso(), id: generateId('resources') });
      log(sid, getSession().user.id, 'resource', `Добавлен материал «${r.title}»`);
      notify(sid, 'resource', 'Новый материал', `«${r.title}»`, '#/library');
      n++;
    }
    saveData();
    return { assigned: n };
  },

  async getReflections(studentId) {
    const sid = this.scope(studentId);
    let rows = data.reflections.filter(r => r.student_id === sid).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    if (!isStaff()) rows = rows.filter(r => !r.is_private);
    return {
      items: rows.map(r => ({ ...r, answers: JSON.parse(r.answers || '{}') })),
      questions: data.reflection_questions.filter(q => q.student_id === sid).sort((a, b) => b.id - a.id),
    };
  },

  async createReflection(body) {
    const data = loadData();
    const s = getSession();
    if (s.user.role !== 'student') throw new Error('Записи ведёт ученик');
    const a = body.answers;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Нет ответов');
    const clean = {}; let n = 0;
    for (const [k, v] of Object.entries(a).slice(0, 20)) { const t = String(v || '').trim().slice(0, 3000); if (t) { clean[String(k).slice(0, 300)] = t; n++; } }
    if (!n) throw new Error('Заполните хотя бы один ответ');
    const id = generateId('reflections');
    data.reflections.push({ student_id: s.user.id, answers: JSON.stringify(clean), is_private: body.is_private ? 1 : 0, created_at: nowIso(), id });
    log(s.user.id, s.user.id, 'reflection', body.is_private ? 'Добавлена личная запись рефлексии' : 'Добавлена запись рефлексии');
    saveData();
    return { id };
  },

  async updateReflection(id, body) {
    const data = loadData();
    const r = data.reflections.find(x => x.id === id);
    r.is_private = body.is_private ? 1 : 0;
    saveData();
    return { ok: true };
  },

  async deleteReflection(id) {
    const data = loadData();
    data.reflections = data.reflections.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async createReflectionQuestion(sid, body) {
    const data = loadData();
    const id = generateId('reflection_questions');
    data.reflection_questions.push({ student_id: sid, text: body.text, created_by: getSession().user.id, created_at: nowIso(), id });
    notify(sid, 'comment', 'Новый вопрос для рефлексии', body.text, '#/reflection');
    saveData();
    return { id };
  },

  async deleteReflectionQuestion(id) {
    const data = loadData();
    data.reflection_questions = data.reflection_questions.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async getRecords(studentId) {
    const sid = this.scope(studentId);
    return data.progress_records.filter(r => r.student_id === sid).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id - a.id);
  },

  async createRecord(sid, body) {
    const data = loadData();
    const id = generateId('progress_records');
    data.progress_records.push({ ...body, student_id: sid, id });
    log(sid, getSession().user.id, 'record', `Зафиксировано: ${body.title}${body.value ? ' — ' + body.value : ''}`);
    saveData();
    return { id };
  },

  async deleteRecord(id) {
    const data = loadData();
    data.progress_records = data.progress_records.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async getAnalytics(studentId) {
    const sid = this.scope(studentId);
    const T = todayStr();
    const tasks = data.tasks.filter(t => t.student_id === sid);
    const done = tasks.filter(t => t.status === 'Выполнено' && t.completed_at);
    const dday = t => t.completed_at.slice(0, 10);

    const monday = ds => { const d = new Date(ds + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
    const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const from = addDays(monday(T), -7 * i), to = addDays(from, 6);
      weeks.push({
        from, done: done.filter(t => dday(t) >= from && dday(t) <= to).length,
        planned: tasks.filter(t => t.due_date && t.due_date >= from && t.due_date <= to).length,
        progress: this.computeRoute(sid, i === 0 ? T : to).overall,
      });
    }
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
      const key = d.toISOString().slice(0, 7);
      months.push({ key, done: done.filter(t => dday(t).startsWith(key)).length });
    }
    const p = data.profiles.find(p => p.user_id === sid);
    const dirNames = [...new Set([...JSON.parse(p.directions || '[]'), ...tasks.map(t => t.direction).filter(Boolean)])];
    const WEIGHT = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 };
    const directions = dirNames.map(name => {
      const ts = tasks.filter(t => t.direction === name);
      let tot = 0, dn = 0; ts.forEach(t => { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; });
      return { name, total: ts.length, done: ts.filter(t => t.status === 'Выполнено').length, pct: tot ? Math.round((dn / tot) * 100) : 0, minutes: ts.reduce((a, t) => a + t.minutes_spent, 0) };
    });
    const r = this.computeRoute(sid);
    const plan = r.stages.map(s => ({
      title: s.title, start: s.start_date, planned_end: s.end_date, actual_end: s.actual_end, pct: s.pct, status: s.status,
      delta: s.actual_end && s.end_date ? Math.round((Date.parse(s.actual_end) - Date.parse(s.end_date)) / 864e5) : null,
    }));
    const lateDone = done.filter(t => t.due_date);
    const onTime = lateDone.filter(t => dday(t) <= t.due_date).length;
    const goals = this.goalProgress(sid).map(g => ({ id: g.id, title: g.title, pct: g.pct, status: g.status, category: g.category, target_date: g.target_date }));
    return {
      overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: done.length, tasksTotal: tasks.length,
      minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0), onTimePct: lateDone.length ? Math.round((onTime / lateDone.length) * 100) : null,
      weeks, months, directions, plan, goals,
      records: data.progress_records.filter(r => r.student_id === sid).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id - a.id), today: T,
    };
  },

  async getReport(studentId, from, to) {
    const sid = this.scope(studentId);
    if (from > to) throw new Error('Неверный период');
    const p = data.profiles.find(p => p.user_id === sid);
    const inRange = s => s && s.slice(0, 10) >= from && s.slice(0, 10) <= to;
    const tasks = data.tasks.filter(t => t.student_id === sid && t.status === 'Выполнено' && inRange(t.completed_at)).map(t => ({
      ...t, stage_title: data.route_stages.find(s => s.id === t.stage_id)?.title
    }));
    const r0 = this.computeRoute(sid, addDays(from, -1)), r1 = this.computeRoute(sid, to);
    return {
      student: { name: p.full_name, main_goal: p.main_goal }, from, to,
      progressStart: r0.overall, progressEnd: r1.overall,
      stagesCompleted: r1.stages.filter(s => s.status === 'completed' && inRange(s.actual_end)).map(s => ({ title: s.title, date: s.actual_end })),
      tasks: tasks.map(t => ({ title: t.title, direction: t.direction, stage: t.stage_title, date: t.completed_at.slice(0, 10), minutes: t.minutes_spent })),
      minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0),
      records: data.progress_records.filter(r => r.student_id === sid && inRange(r.recorded_at)).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
      goalsAchieved: data.activity_logs.filter(a => a.student_id === sid && a.kind === 'goal' && a.text.startsWith('Цель достигнута') && inRange(a.created_at)),
      comments: data.activity_logs.filter(a => a.student_id === sid && a.kind === 'tutor_comment' && inRange(a.created_at)),
      routeChanges: data.activity_logs.filter(a => a.student_id === sid && a.kind === 'route' && inRange(a.created_at)),
    };
  },

  async getHistory(studentId) {
    const sid = this.scope(studentId);
    return data.activity_logs.filter(a => a.student_id === sid).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 200);
  },

  async getNotifications() {
    const s = getSession(); if (!s) throw new Error('Unauthorized');
    if (s.user.role === 'student') {
      const T = todayStr(), soon = addDays(T, 2);
      data.tasks.filter(t => t.student_id === s.user.id && !['Выполнено', 'Отложено'].includes(t.status) && t.due_date && t.due_date >= T && t.due_date <= soon)
        .forEach(t => notify(s.user.id, 'deadline', 'Приближается дедлайн', `«${t.title}» · ${t.due_date}`, '#/tasks', `dl-${t.id}-${t.due_date}`));
    }
    const items = data.notifications.filter(n => n.user_id === s.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 60);
    return { items, unread: data.notifications.filter(n => n.user_id === s.user.id && !n.is_read).length };
  },

  async markNotificationsRead(id) {
    const data = loadData();
    const s = getSession(); if (!s) throw new Error('Unauthorized');
    if (id) data.notifications = data.notifications.map(n => n.id === id && n.user_id === s.user.id ? { ...n, is_read: 1 } : n);
    else data.notifications = data.notifications.map(n => n.user_id === s.user.id ? { ...n, is_read: 1 } : n);
    saveData();
    return { ok: true };
  },

  async getTools() { return data.tools.sort((a, b) => a.position - b.position || a.id - b.id); },

  async createTool(body) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    const id = generateId('tools');
    data.tools.push({ ...body, status: body.status || 'Доступно', id });
    saveData();
    return { id };
  },

  async updateTool(id, body) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    const t = data.tools.find(x => x.id === id);
    Object.assign(t, body);
    saveData();
    return { ok: true };
  },

  async deleteTool(id) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    data.tools = data.tools.filter(x => x.id !== id);
    saveData();
    return { ok: true };
  },

  async getTutorStudents() {
    if (!isStaff()) throw new Error('Недостаточно прав');
    const s = getSession();
    const rows = s.user.role === 'admin'
      ? data.users.filter(u => u.role === 'student' && u.active).map(u => ({ id: u.id }))
      : data.tutor_students.filter(ts => ts.tutor_id === s.user.id).map(ts => ({ id: ts.student_id }));
    const T = todayStr();
    return rows.map(({ id }) => {
      const p = data.profiles.find(p => p.user_id === id);
      const r = this.computeRoute(id);
      const u = data.users.find(u => u.id === id);
      return {
        id, email: u.email, name: p.full_name, photo_url: p.photo_url, main_goal: p.main_goal, status: p.status,
        stage: r.current?.title || (r.totalStages ? 'Все этапы завершены' : 'Маршрут не создан'), progress: r.overall,
        activeTasks: data.tasks.filter(t => t.student_id === id && !['Выполнено', 'Отложено'].includes(t.status)).length,
        review: data.tasks.filter(t => t.student_id === id && t.status === 'На проверке').length,
        overdue: data.tasks.filter(t => t.student_id === id && !['Выполнено', 'Отложено'].includes(t.status) && t.due_date && t.due_date < T).length,
        nextDeadline: data.tasks.filter(t => t.student_id === id && !['Выполнено', 'Отложено'].includes(t.status) && t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.due_date,
        lastActivity: data.activity_logs.filter(a => a.student_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at,
      };
    });
  },

  async createStudent(body) {
    if (!isStaff()) throw new Error('Недостаточно прав');
    const data = loadData();
    const id = generateId('users');
    const password_hash = await hashPw(body.password);
    data.users.push({ id, email: body.email.toLowerCase(), password_hash, role: 'student', active: true, created_at: nowIso() });
    data.profiles.push({ user_id: id, full_name: body.full_name.trim(), main_goal: body.main_goal || '', directions: JSON.stringify(body.directions || []), start_date: todayStr(), status: 'Активно занимается', motivation: '', bio: '', photo_url: null, notify_freq: 'all' });
    data.learning_routes.push({ id: generateId('learning_routes'), student_id: id, title: 'Образовательный маршрут', created_at: nowIso() });
    const s = getSession();
    data.tutor_students.push({ tutor_id: s.user.id, student_id: id, created_at: nowIso() });
    log(id, s.user.id, 'start', 'Начало работы в NMCHV Student');
    saveData();
    return { id };
  },

  async getAdminUsers() {
    if (!isAdmin()) throw new Error('Только для администратора');
    const users = data.users.map(u => {
      const p = data.profiles.find(p => p.user_id === u.id);
      const tutors = data.tutor_students.filter(ts => ts.student_id === u.id).map(ts => ts.tutor_id);
      const students = data.tutor_students.filter(ts => ts.tutor_id === u.id).map(ts => ts.student_id);
      return { ...u, name: p?.full_name || '—', tutors, students };
    });
    return { users };
  },

  async updateAdminUser(id, body) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    const u = data.users.find(x => x.id === id);
    if (body.role) u.role = body.role;
    if (body.active !== undefined) u.active = body.active ? 1 : 0;
    if (body.password) u.password_hash = await hashPw(body.password);
    saveData();
    return { ok: true };
  },

  async toggleUserActive(id, active) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    const u = data.users.find(x => x.id === id);
    u.active = active ? 1 : 0;
    saveData();
    return { ok: true };
  },

  async linkTutorStudent(tutorId, studentId, unlink) {
    if (!isAdmin()) throw new Error('Только для администратора');
    const data = loadData();
    if (unlink) data.tutor_students = data.tutor_students.filter(ts => !(ts.tutor_id === tutorId && ts.student_id === studentId));
    else if (!data.tutor_students.find(ts => ts.tutor_id === tutorId && ts.student_id === studentId)) data.tutor_students.push({ tutor_id: tutorId, student_id: studentId, created_at: nowIso() });
    saveData();
    return { ok: true };
  },
};

function isStaff() { const s = getSession(); return s && s.user.role !== 'student'; }
function isAdmin() { const s = getSession(); return s && s.user.role === 'admin'; }

window.Store = Store;