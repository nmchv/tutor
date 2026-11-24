/* Общие утилиты: API (Supabase напрямую), форматирование, иконки, модальные окна, графики */
import { sb } from './config.js';
import { computeRoute, goalProgress, todayStr } from './progress.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const S = { me: null, sid: null, accessToken: null, refresh: () => {} };
export const isStaff = () => S.me && S.me.role !== 'student';
export const href = (view) => (S.sid ? `#/student/${S.sid}/${view}` : `#/${view}`);

/* ───── Supabase слой данных ───── */

const sidFilter = (extra = {}) => (S.sid ? { student_id: S.sid, ...extra } : extra);

async function sel(table, filters = {}, opts = {}) {
  let q = sb.from(table).select(opts.columns || '*', { count: opts.count ? 'exact' : 'estimated' });
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) q = q.is(key, null);
    else if (Array.isArray(value)) q = q.in(key, value);
    else q = q.eq(key, value);
  }
  if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.single) q = q.single();
  const { data, error } = await q;
  if (error) throw new Error(error.message || 'Ошибка базы данных');
  return opts.count ? { rows: data || [], count } : (opts.single ? (data || null) : (data || []));
}

async function getOne(table, filters) { return sel(table, filters, { single: true }); }
async function insertRow(table, data) {
  const { data: inserted, error } = await sb.from(table).insert(data).select().single();
  if (error) throw new Error(error.message || 'Ошибка вставки');
  return inserted;
}
export { insertRow, todayStr };
async function updateRow(table, id, data) {
  const { data: updated, error } = await sb.from(table).update(data).eq('id', id).select().single();
  if (error) throw new Error(error.message || 'Ошибка обновления');
  return updated;
}
async function deleteRow(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message || 'Ошибка удаления');
  return { ok: true };
}
async function deleteWhere(table, filters) {
  let q = sb.from(table).delete();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) q = q.is(key, null);
    else q = q.eq(key, value);
  }
  const { error } = await q;
  if (error) throw new Error(error.message || 'Ошибка удаления');
  return { ok: true };
}

/* ───── Unified api() dispatcher — заменяет вызовы /api/* на прямые Supabase-запросы ───── */

export async function api(path, { method = 'GET', body } = {}) {
  const p = path.replace(/^\//, '').replace(/\?.*$/, '');
  const qs = new URLSearchParams(path.split('?')[1] || '');
  const sid = S.sid || null;

  /* ── Auth (прокси в Supabase Auth) ── */
  if (p === 'auth/login') {
    const { data, error } = await sb.auth.signInWithPassword({ email: String(body.email || '').trim().toLowerCase(), password: String(body.password || '') });
    if (error || !data.user) throw new Error('Неверный email или пароль');
    const meData = await getMe();
    return { ...meData, access_token: data.session.access_token };
  }
  if (p === 'auth/register') {
    const email = String(body.email || '').trim().toLowerCase();
    const full_name = String(body.full_name || '').trim();
    if (!full_name) throw new Error('Укажите имя');
    const { data, error } = await sb.auth.signUp({ email, password: String(body.password || ''), options: { data: { full_name } } });
    if (error || !data.user) throw new Error(error?.message || 'Не удалось создать аккаунт');
    if (!data.session) throw new Error('Не удалось создать сессию');
    const sbUser = sb;
    await insertRow('profiles', { id: data.user.id, email, full_name, start_date: todayStr() });
    await insertRow('tutor_user_roles', { user_id: data.user.id, role: 'student', active: true });
    await insertRow('tutor_learning_routes', { student_id: data.user.id, title: 'Образовательный маршрут', created_at: new Date().toISOString() });
    const meData = await getMe();
    return { ...meData, access_token: data.session.access_token };
  }
  if (p === 'auth/logout') {
    await sb.auth.signOut();
    return { ok: true };
  }

  /* ── Проверка авторизации для остальных эндпоинтов ── */
  const { data: session } = await sb.auth.getSession();
  if (!session?.session) throw new Error('Требуется вход', { cause: { status: 401 } });
  const user = session.session.user;
  const roleRow = await getOne('tutor_user_roles', { user_id: user.id });
  const role = roleRow ? roleRow.role : 'student';
  const meUser = { id: user.id, email: user.email || '', role, token: session.session.access_token };

  if (p === 'me') return getMe(meUser);
  if (p === 'me/password') {
    const { error } = await sb.auth.updateUser({ password: body.next });
    if (error) throw new Error('Не удалось сменить пароль');
    return { ok: true };
  }

  /* ── Public ── */
  if (p === 'public') return { demo: false, accounts: [] };

  /* ── Dashboard ── */
  if (p === 'dashboard') return getDashboard(meUser, sid);

  /* ── Route ── */
  if (p === 'route') return getRoute(meUser, sid);

  /* ── Stages ── */
  if (p === 'stages' && method === 'POST') return createStage(meUser, sid, body);
  const mStage = p.match(/^stages\/(\d+)$/);
  if (mStage && method === 'PATCH') return updateStage(meUser, +mStage[1], body);
  if (mStage && method === 'DELETE') return deleteStage(meUser, +mStage[1]);
  const mMove = p.match(/^stages\/(\d+)\/move$/);
  if (mMove && method === 'POST') return moveStage(meUser, +mMove[1], body);
  const mMsAdd = p.match(/^stages\/(\d+)\/milestones$/);
  if (mMsAdd && method === 'POST') return createMilestone(meUser, +mMsAdd[1], body);

  /* ── Milestones ── */
  const mMilestone = p.match(/^milestones\/(\d+)$/);
  if (mMilestone && method === 'PATCH') return updateMilestone(meUser, +mMilestone[1], body);
  if (mMilestone && method === 'DELETE') return deleteMilestone(meUser, +mMilestone[1]);

  /* ── Goals ── */
  if (p === 'goals') {
    if (method === 'POST') return createGoal(meUser, sid, body);
    return getGoals(meUser, sid);
  }
  const mGoal = p.match(/^goals\/(\d+)$/);
  if (mGoal && method === 'PATCH') return updateGoal(meUser, +mGoal[1], body);
  if (mGoal && method === 'DELETE') return deleteGoal(meUser, +mGoal[1]);

  /* ── Tasks ── */
  if (p === 'tasks') {
    if (method === 'POST') return createTask(meUser, sid, body);
    return getTasks(meUser, sid);
  }
  const mTask = p.match(/^tasks\/(\d+)$/);
  if (mTask && p.endsWith('/comments') && method === 'GET') return getTaskComments(meUser, +mTask[1]);
  const mTaskComment = p.match(/^tasks\/(\d+)\/comments$/);
  if (mTaskComment && method === 'POST') return createTaskComment(meUser, +mTaskComment[1], body);
  if (mTask && method === 'PATCH') return updateTask(meUser, +mTask[1], body);
  if (mTask && method === 'DELETE') return deleteTask(meUser, +mTask[1]);

  /* ── Feedback ── */
  if (p === 'feedback') {
    if (method === 'POST') return createFeedback(meUser, sid, body);
    return getFeedback(meUser, sid);
  }

  /* ── Student profile ── */
  if (p === 'student-profile' && method === 'PATCH') return updateStudentProfile(meUser, sid, body);

  /* ── Events ── */
  if (p === 'events') {
    if (method === 'POST') return createEvent(meUser, sid, body);
    return getEvents(meUser, sid);
  }
  const mEvent = p.match(/^events\/(\d+)$/);
  if (mEvent && method === 'DELETE') return deleteEvent(meUser, +mEvent[1]);

  /* ── Resources ── */
  if (p === 'resources') {
    if (method === 'POST') return createResource(meUser, sid, body);
    return getResources(meUser, sid);
  }
  const mRes = p.match(/^resources\/(\d+)$/);
  if (mRes && method === 'PATCH') return updateResource(meUser, +mRes[1], body);
  if (mRes && method === 'DELETE') return deleteResource(meUser, +mRes[1]);

  /* ── Library shared ── */
  if (p === 'library/shared') {
    if (method === 'POST') return createSharedResource(meUser, body);
    return getSharedResources(meUser);
  }
  const mShRes = p.match(/^library\/shared\/(\d+)$/);
  if (mShRes && method === 'DELETE') return deleteSharedResource(meUser, +mShRes[1]);
  if (p === 'library/assign' && method === 'POST') return assignResource(meUser, body);

  /* ── Reflections ── */
  if (p === 'reflections') {
    if (method === 'POST') return createReflection(meUser, body);
    return getReflections(meUser, sid);
  }
  const mRef = p.match(/^reflections\/(\d+)$/);
  if (mRef && method === 'PATCH') return updateReflection(meUser, +mRef[1], body);
  if (mRef && method === 'DELETE') return deleteReflection(meUser, +mRef[1]);

  /* ── Reflection questions ── */
  if (p === 'reflection-questions' && method === 'POST') return createReflectionQuestion(meUser, sid, body);
  const mRq = p.match(/^reflection-questions\/(\d+)$/);
  if (mRq && method === 'DELETE') return deleteReflectionQuestion(meUser, +mRq[1]);

  /* ── Records ── */
  if (p === 'records') {
    if (method === 'POST') return createRecord(meUser, sid, body);
    return getRecords(meUser, sid);
  }
  const mRec = p.match(/^records\/(\d+)$/);
  if (mRec && method === 'DELETE') return deleteRecord(meUser, +mRec[1]);

  /* ── Analytics ── */
  if (p === 'analytics') return getAnalytics(meUser, sid);

  /* ── Report ── */
  if (p === 'report') return getReport(meUser, sid, qs);

  /* ── History ── */
  if (p === 'history') return getHistory(meUser, sid);

  /* ── Notifications ── */
  if (p === 'notifications') {
    if (method === 'POST') return markNotificationsRead(meUser, body);
    return getNotifications(meUser);
  }

  /* ── Tools ── */
  if (p === 'tools') {
    if (method === 'POST') return createTool(meUser, body);
    return getTools(meUser);
  }
  const mTool = p.match(/^tools\/(\d+)$/);
  if (mTool && method === 'PATCH') return updateTool(meUser, +mTool[1], body);
  if (mTool && method === 'DELETE') return deleteTool(meUser, +mTool[1]);

  /* ── Tutor students ── */
  if (p === 'tutor/students') {
    if (method === 'POST') throw new Error('Создание учеников требует серверной части (service role)');
    return getTutorStudents(meUser);
  }
  const mTs = p.match(/^tutor\/students\/([0-9a-f-]+)$/);
  if (mTs && method === 'DELETE') return unlinkStudent(meUser, mTs[1]);

  /* ── Admin users ── */
  if (p === 'admin/users') {
    if (method === 'POST') throw new Error('Создание пользователей требует серверной части (service role)');
    return getAdminUsers(meUser);
  }
  const mAu = p.match(/^admin\/users\/([0-9a-f-]+)$/);
  if (mAu && method === 'PATCH') return updateAdminUser(meUser, mAu[1], body);
  if (p === 'admin/link' && method === 'POST') return adminLink(meUser, body);

  throw new Error('Неизвестный endpoint: ' + path);
}

/* ───── Endpoint handlers ───── */

async function getMe(u = null) {
  const user = u || (await currentUser());
  if (!user) throw new Error('Требуется вход');
  const p = await getOne('profiles', { id: user.id });
  const profile = p ? { ...p, directions: JSON.parse(p.directions || '[]') } : null;
  return { id: user.id, email: user.email, role: user.role, profile };
}

async function currentUser() {
  const { data: session } = await sb.auth.getSession();
  if (!session?.session) return null;
  const user = session.session.user;
  const row = await getOne('tutor_user_roles', { user_id: user.id });
  return { id: user.id, email: user.email || '', role: row ? row.role : 'student', token: session.session.access_token };
}

async function getDashboard(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const [p, stages, milestones, tasks, goals, events] = await Promise.all([
    getOne('profiles', { id: targetSid }),
    sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position,id' }),
    sel('tutor_tasks', sidFilter({ student_id: targetSid }), { order: 'due_date,id' }),
    sel('tutor_educational_goals', sidFilter({ student_id: targetSid }), { order: 'id' }),
    sel('tutor_events', sidFilter({ student_id: targetSid }), { order: 'starts_at' }),
  ]);
  const profile = p ? { ...p, directions: JSON.parse(p.directions || '[]') } : null;
  const r = computeRoute(stages, milestones, tasks);
  const gProg = goalProgress(goals, stages, tasks);
  const T = todayStr();
  const openTasks = tasks.filter((t) => t.status !== 'Выполнено').sort((a, b) => ((a.due_date || '9').localeCompare(b.due_date || '9'))).slice(0, 7);
  const nowMin = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16).replace(' ', 'T');
  const upcomingEvents = events.filter((e) => e.starts_at && e.starts_at.slice(0, 16) >= nowMin).slice(0, 6);
  const mile = milestones.filter((m) => !m.done);
  const upcomingMile = mile.filter((m) => m.due_date && m.due_date >= T).slice(0, 5);
  const stageIdsWithDoneMs = new Set(r.stages.flatMap((s) => s.milestones.filter((m) => m.done).map((m) => m.id)));
  const upcoming = [
    ...upcomingEvents.map((e) => ({ kind: e.kind, title: e.title, at: e.starts_at, note: e.note })),
    ...upcomingMile.filter((m) => !stageIdsWithDoneMs.has(m.id)).map((m) => ({ kind: 'checkpoint', title: m.title, at: m.due_date, note: '' })),
    ...openTasks.filter((t) => t.due_date && t.due_date >= T && ['Высокий', 'Критический'].includes(t.priority)).map((t) => ({ kind: 'deadline', title: t.title, at: t.due_date, note: 'Дедлайн задачи' })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 7);
  const activity = await sel('tutor_activity_logs', sidFilter({ student_id: targetSid }), { order: 'created_at,id', limit: 8 });
  const activityWithActor = await Promise.all(activity.map(async (a) => {
    const actor = a.actor_id ? await getOne('profiles', { id: a.actor_id }) : null;
    return { ...a, actor: actor ? actor.full_name : '' };
  }));
  const comment = await getOne('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'tutor_comment' }));
  const commentRow = comment ? { ...comment, actor: comment.actor_id ? (await getOne('profiles', { id: comment.actor_id }))?.full_name || '' : '' } : null;
  const overdue = tasks.filter((t) => t.status !== 'Выполнено' && t.due_date && t.due_date < T).length;
  return {
    profile: { ...profile, directions: JSON.parse(profile?.directions || '[]') },
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: r.tasksDone, tasksTotal: r.tasksTotal,
    activeGoals: gProg.filter((g) => g.status === 'Активна').length,
    days: profile?.start_date ? Math.max(0, Math.floor((Date.parse(T) - Date.parse(profile.start_date)) / 864e5)) : 0,
    current: r.current && { id: r.current.id, title: r.current.title, pct: r.current.pct, end_date: r.current.end_date },
    mainGoal: gProg.find((g) => g.status === 'Активна' && g.priority === 'Высокий') || gProg.find((g) => g.status === 'Активна') || null,
    tasks: openTasks, upcoming, activity: activityWithActor, comment: commentRow, overdue, today: T,
  };
}

async function getRoute(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const [stages, milestones, tasks, history, goals] = await Promise.all([
    sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position,id' }),
    sel('tutor_tasks', sidFilter({ student_id: targetSid }), { order: 'due_date,id' }),
    sel('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'route' }), { order: 'created_at,id', limit: 30 }),
    sel('tutor_educational_goals', sidFilter({ student_id: targetSid }), { order: 'id' }),
  ]);
  const r = computeRoute(stages, milestones, tasks);
  const goalsMap = Object.fromEntries(goals.map((g) => [g.id, g.title]));
  const routeStages = r.stages.map((s) => ({
    ...s, goal_title: goalsMap[s.goal_id] || null,
    milestones: s.milestones.map((m) => ({ ...m, tasks: tasks.filter((t) => t.milestone_id === m.id) })),
    looseTasks: tasks.filter((t) => t.stage_id === s.id && !t.milestone_id),
  }));
  return { overall: r.overall, doneStages: r.doneStages, stages: routeStages, history, goals: goals.map((g) => ({ id: g.id, title: g.title })), today: todayStr() };
}

async function createStage(u, sid, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const { data, error } = await sb.from('tutor_route_stages').insert({
    ...body, weight: body.weight || 1, priority: body.priority || 'Обычный', student_id: targetSid, position: 0,
  }).select().single();
  if (error) throw new Error(error.message);
  const rt = await getOne('tutor_learning_routes', { student_id: targetSid });
  if (rt) await sb.from('tutor_route_stages').update({ route_id: rt.id }).eq('id', data.id);
  await insertRow('tutor_activity_logs', { student_id: targetSid, actor_id: u.id, kind: 'route', text: `Добавлен этап «${body.title}»`, created_at: new Date().toISOString() });
  return { id: data.id };
}

async function updateStage(u, id, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const s = await getOne('tutor_route_stages', { id });
  if (!s) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role !== 'admin') {
    const link = await getOne('tutor_students', { tutor_id: u.id, student_id: s.student_id });
    if (!link) throw new Error('Нет доступа', { cause: { status: 403 } });
  }
  const { error } = await sb.from('tutor_route_stages').update(body).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteStage(u, id) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const s = await getOne('tutor_route_stages', { id });
  if (!s) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role !== 'admin') {
    const link = await getOne('tutor_students', { tutor_id: u.id, student_id: s.student_id });
    if (!link) throw new Error('Нет доступа', { cause: { status: 403 } });
  }
  await deleteRow('tutor_route_stages', id);
  return { ok: true };
}

async function moveStage(u, id, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const s = await getOne('tutor_route_stages', { id });
  if (!s) throw new Error('Не найдено', { cause: { status: 404 } });
  const dir = body.dir === 1 ? 1 : body.dir === -1 ? -1 : 0;
  if (!dir) throw new Error('Неверное направление');
  const all = await sel('tutor_route_stages', sidFilter({ student_id: s.student_id }), { order: 'position,id' });
  const ids = all.map((r) => r.id);
  const i = ids.indexOf(s.id), j = i + dir;
  if (j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [k, id2] of ids.entries()) await sb.from('tutor_route_stages').update({ position: k }).eq('id', id2);
  return { ok: true };
}

async function createMilestone(u, stageId, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const s = await getOne('tutor_route_stages', { id: stageId });
  if (!s) throw new Error('Этап не найден', { cause: { status: 404 } });
  const allMs = await sel('tutor_milestones', { stage_id: stageId }, { order: 'position,id' });
  const { data, error } = await sb.from('tutor_milestones').insert({
    ...body, done: body.done || false, done_at: body.done ? new Date().toISOString() : null, stage_id: stageId, student_id: s.student_id, position: allMs.length,
  }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function updateMilestone(u, id, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const m = await getOne('tutor_milestones', { id });
  if (!m) throw new Error('Не найдено', { cause: { status: 404 } });
  const data = { ...body };
  if (body.done !== undefined) data.done_at = body.done ? new Date().toISOString() : null;
  const { error } = await sb.from('tutor_milestones').update(data).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteMilestone(u, id) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const m = await getOne('tutor_milestones', { id });
  if (!m) throw new Error('Не найдено', { cause: { status: 404 } });
  await deleteRow('tutor_milestones', id);
  return { ok: true };
}

async function getGoals(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const [stages, goals, tasks] = await Promise.all([
    sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_educational_goals', sidFilter({ student_id: targetSid }), { order: 'id' }),
    sel('tutor_tasks', sidFilter({ student_id: targetSid }), { order: 'due_date,id' }),
  ]);
  const gProg = goalProgress(goals, stages, tasks);
  return { goals: gProg.map((g) => ({ ...g, stageList: stages.filter((s) => s.goal_id === g.id) })), stages };
}

async function createGoal(u, sid, body) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const crit = Array.isArray(body.criteria) ? JSON.stringify(body.criteria.map((c) => ({ text: String(c.text || '').trim().slice(0, 200), done: !!c.done })).filter((c) => c.text)) : '[]';
  const { data, error } = await sb.from('tutor_educational_goals').insert({
    ...body, student_id: targetSid, set_date: body.set_date || todayStr(), priority: body.priority || 'Обычный', status: body.status || 'Активна',
    criteria: crit, created_by: u.id, created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  await insertRow('tutor_activity_logs', { student_id: targetSid, actor_id: u.id, kind: 'goal', text: `Добавлена цель «${body.title}»`, created_at: new Date().toISOString() });
  return { id: data.id };
}

async function updateGoal(u, id, body) {
  const g = await getOne('tutor_educational_goals', { id });
  if (!g) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role === 'student' && g.student_id !== u.id) throw new Error('Нет доступа', { cause: { status: 403 } });
  const data = { ...body };
  if (body.criteria !== undefined) data.criteria = JSON.stringify(body.criteria);
  if (u.role !== 'tutor' && u.role !== 'admin') {
    for (const k of Object.keys(data)) if (k !== 'criteria') delete data[k];
  }
  const { error } = await sb.from('tutor_educational_goals').update(data).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteGoal(u, id) {
  const g = await getOne('tutor_educational_goals', { id });
  if (!g) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role === 'student' && g.created_by !== u.id) throw new Error('Цели от тьютора удаляет тьютор', { cause: { status: 403 } });
  await deleteRow('tutor_educational_goals', id);
  return { ok: true };
}

async function getTasks(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const [tasks, stages, ms, goals, profile] = await Promise.all([
    sel('tutor_tasks', sidFilter({ student_id: targetSid }), { order: 'due_date,id' }),
    sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_educational_goals', sidFilter({ student_id: targetSid }), { order: 'id' }),
    getOne('profiles', { id: targetSid }),
  ]);
  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
  const enriched = await Promise.all(tasks.map(async (t) => {
    const s = stageMap[t.stage_id];
    const m = ms.find((x) => x.id === t.milestone_id);
    const g = goals.find((x) => x.id === (t.goal_id ?? s?.goal_id));
    const comments = await sel('tutor_task_comments', { task_id: t.id });
    return { ...t, stage_title: s ? s.title : null, goal_title: g ? g.title : null, milestone_title: m ? m.title : null, comments: comments.length };
  }));
  return { tasks: enriched, directions: JSON.parse(profile?.directions || '[]'), stages, milestones: ms, goals, today: todayStr() };
}

async function createTask(u, sid, body) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const staff = u.role === 'tutor' || u.role === 'admin';
  let d;
  if (staff) { d = { ...body }; delete d.tutor_feedback; }
  else {
    d = { ...body };
    for (const k of ['tutor_feedback', 'instructions', 'resource_id']) delete d[k];
  }
  const source = staff ? 'tutor' : 'personal';
  const st = d.status || 'Не начато';
  const { data, error } = await sb.from('tutor_tasks').insert({
    ...d, student_id: targetSid, priority: d.priority || 'Обычный', status: st, type: d.type || 'Самостоятельная работа', source,
    completed_at: st === 'Выполнено' ? new Date().toISOString() : null, created_by: u.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function getTaskComments(u, taskId) {
  const t = await getOne('tutor_tasks', { id: taskId });
  if (!t) throw new Error('Не найдено', { cause: { status: 404 } });
  const rows = await sel('tutor_task_comments', { task_id }, { order: 'id' });
  return Promise.all(rows.map(async (c) => {
    const prof = await getOne('profiles', { id: c.author_id });
    return { ...c, author: prof ? prof.full_name : '' };
  }));
}

async function createTaskComment(u, taskId, body) {
  const t = await getOne('tutor_tasks', { id: taskId });
  if (!t) throw new Error('Не найдено', { cause: { status: 404 } });
  const { data, error } = await sb.from('tutor_task_comments').insert({
    task_id, student_id: t.student_id, author_id: u.id, body: body.body, created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function updateTask(u, id, body) {
  const t = await getOne('tutor_tasks', { id });
  if (!t) throw new Error('Не найдено', { cause: { status: 404 } });
  const staff = u.role === 'tutor' || u.role === 'admin';
  const personal = t.source === 'personal';
  let d = { ...body };
  if (!staff && !personal) {
    const allowed = {};
    for (const k of ['status', 'minutes_spent', 'link']) if (d[k] !== undefined) allowed[k] = d[k];
    d = allowed;
    if (d.status === 'Выполнено') d.status = 'На проверке';
  }
  if (!staff && personal) { delete d.tutor_feedback; delete d.instructions; delete d.resource_id; }
  if (d.status && d.status !== t.status) {
    if (d.status === 'Выполнено') d.completed_at = new Date().toISOString();
    else if (t.status === 'Выполнено') d.completed_at = null;
  }
  d.updated_at = new Date().toISOString();
  const { error } = await sb.from('tutor_tasks').update(d).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true, status: d.status || t.status };
}

async function deleteTask(u, id) {
  const t = await getOne('tutor_tasks', { id });
  if (!t) throw new Error('Не найдено', { cause: { status: 404 } });
  if (!(u.role === 'tutor' || u.role === 'admin') && t.source !== 'personal') throw new Error('Задачи тьютора удаляет тьютор', { cause: { status: 403 } });
  await deleteRow('tutor_tasks', id);
  return { ok: true };
}

async function createFeedback(u, sid, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  await insertRow('tutor_activity_logs', { student_id: targetSid, actor_id: u.id, kind: 'tutor_comment', text: body.text, created_at: new Date().toISOString() });
  return { ok: true };
}

async function getFeedback(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const rows = await sel('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'tutor_comment' }), { order: 'created_at,id', limit: 50 });
  return Promise.all(rows.map(async (a) => {
    const prof = a.actor_id ? await getOne('profiles', { id: a.actor_id }) : null;
    return { id: a.id, text: a.text, created_at: a.created_at, actor: prof ? prof.full_name : '' };
  }));
}

async function updateStudentProfile(u, sid, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const d = { ...body };
  const k = Object.keys(d);
  if (k.length) {
    const { error } = await sb.from('profiles').update(d).eq('id', targetSid);
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

async function getEvents(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  return sel('tutor_events', sidFilter({ student_id: targetSid }), { order: 'starts_at' });
}

async function createEvent(u, sid, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const { data, error } = await sb.from('tutor_events').insert({ ...body, kind: body.kind || 'session', student_id: targetSid, created_by: u.id }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function deleteEvent(u, id) {
  const e = await getOne('tutor_events', { id });
  if (!e) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  await deleteRow('tutor_events', id);
  return { ok: true };
}

async function getResources(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const [items, stages, categories] = await Promise.all([
    sel('tutor_resources', sidFilter({ owner_student_id: targetSid }), { order: 'favorite,id' }),
    sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }),
    sel('tutor_resource_categories', {}, { order: 'position' }),
  ]);
  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s.title]));
  const enriched = items.map((r) => ({ ...r, stage_title: r.stage_id ? stageMap[r.stage_id] : null }));
  return { items: enriched, categories: categories.map((c) => c.name), stages: stages.map((s) => ({ id: s.id, title: s.title })) };
}

async function createResource(u, sid, body) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const staff = u.role === 'tutor' || u.role === 'admin';
  const d = { ...body };
  if (!staff) delete d.tutor_note;
  const { data, error } = await sb.from('tutor_resources').insert({
    ...d, status: d.status || 'К изучению', favorite: d.favorite || false, owner_student_id: targetSid,
    tutor_id: staff ? u.id : null, added_by_self: staff ? false : true, created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function updateResource(u, id, body) {
  const r = await getOne('tutor_resources', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  let d = { ...body };
  if (u.role !== 'tutor' && u.role !== 'admin') {
    if (r.added_by_self) delete d.tutor_note;
    else d = Object.fromEntries(Object.entries(d).filter(([k]) => ['status', 'favorite'].includes(k)));
  }
  const { error } = await sb.from('tutor_resources').update(d).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteResource(u, id) {
  const r = await getOne('tutor_resources', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  if (!(u.role === 'tutor' || u.role === 'admin') && !r.added_by_self) throw new Error('Материалы тьютора удаляет тьютор', { cause: { status: 403 } });
  await deleteRow('tutor_resources', id);
  return { ok: true };
}

async function getSharedResources(u) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  return sel('tutor_resources', { owner_student_id: null, tutor_id: u.id }, { order: 'id' });
}

async function createSharedResource(u, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const d = { ...body }; delete d.stage_id; delete d.favorite; delete d.status;
  const { data, error } = await sb.from('tutor_resources').insert({ ...d, owner_student_id: null, tutor_id: u.id, created_at: new Date().toISOString() }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function deleteSharedResource(u, id) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const r = await getOne('tutor_resources', { id, owner_student_id: null, tutor_id: u.id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  await deleteRow('tutor_resources', id);
  return { ok: true };
}

async function assignResource(u, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const r = await getOne('tutor_resources', { id: Number(body.resource_id), owner_student_id: null, tutor_id: u.id });
  if (!r) throw new Error('Материал не найден', { cause: { status: 404 } });
  const ids = Array.isArray(body.student_ids) ? body.student_ids.map(Number).filter(Boolean).slice(0, 100) : [];
  if (!ids.length) throw new Error('Выберите учеников');
  let n = 0;
  for (const sid of ids) {
    await sb.from('tutor_resources').insert({ owner_student_id: sid, tutor_id: u.id, title: r.title, description: r.description, category: r.category, url: r.url, tutor_note: r.tutor_note, status: 'К изучению', added_by_self: false, created_at: new Date().toISOString() });
    await insertRow('tutor_activity_logs', { student_id: sid, actor_id: u.id, kind: 'resource', text: `Добавлен материал «${r.title}»`, created_at: new Date().toISOString() });
    n++;
  }
  return { assigned: n };
}

async function getReflections(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  let rows = await sel('tutor_reflections', sidFilter({ student_id: targetSid }), { order: 'created_at,id' });
  if (u.role !== 'student') rows = rows.filter((r) => !r.is_private);
  const questions = await sel('tutor_reflection_questions', sidFilter({ student_id: targetSid }), { order: 'id' });
  return { items: rows.map((r) => ({ ...r, answers: JSON.parse(r.answers || '{}') })), questions };
}

async function createReflection(u, body) {
  if (u.role !== 'student') throw new Error('Записи ведёт ученик', { cause: { status: 403 } });
  const a = body.answers;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Нет ответов');
  const clean = {}; let n = 0;
  const entries = Object.entries(a).slice(0, 20);
  for (const [k, v] of entries) { const t = String(v || '').trim().slice(0, 3000); if (t) { clean[String(k).slice(0, 300)] = t; n++; } }
  if (!n) throw new Error('Заполните хотя бы один ответ');
  const { data, error } = await sb.from('tutor_reflections').insert({
    student_id: u.id, answers: JSON.stringify(clean), is_private: body.is_private ? true : false, created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  await insertRow('tutor_activity_logs', { student_id: u.id, actor_id: u.id, kind: 'reflection', text: body.is_private ? 'Добавлена личная запись рефлексии' : 'Добавлена запись рефлексии', created_at: new Date().toISOString() });
  return { id: data.id };
}

async function updateReflection(u, id, body) {
  const r = await getOne('tutor_reflections', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role !== 'student') throw new Error('Нет доступа', { cause: { status: 403 } });
  const { error } = await sb.from('tutor_reflections').update({ is_private: body.is_private ? true : false }).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteReflection(u, id) {
  const r = await getOne('tutor_reflections', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  if (u.role !== 'student') throw new Error('Нет доступа', { cause: { status: 403 } });
  await deleteRow('tutor_reflections', id);
  return { ok: true };
}

async function createReflectionQuestion(u, sid, body) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const { data, error } = await sb.from('tutor_reflection_questions').insert({ student_id: targetSid, text: body.text, created_by: u.id, created_at: new Date().toISOString() }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function deleteReflectionQuestion(u, id) {
  const r = await getOne('tutor_reflection_questions', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  await deleteRow('tutor_reflection_questions', id);
  return { ok: true };
}

async function getRecords(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  return sel('tutor_progress_records', sidFilter({ student_id: targetSid }), { order: 'recorded_at,id' });
}

async function createRecord(u, sid, body) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const { data, error } = await sb.from('tutor_progress_records').insert({ ...body, student_id: targetSid }).select().single();
  if (error) throw new Error(error.message);
  await insertRow('tutor_activity_logs', { student_id: targetSid, actor_id: u.id, kind: 'record', text: `Зафиксировано: ${body.title}${body.value ? ' — ' + body.value : ''}`, created_at: new Date().toISOString() });
  return { id: data.id };
}

async function deleteRecord(u, id) {
  const r = await getOne('tutor_progress_records', { id });
  if (!r) throw new Error('Не найдено', { cause: { status: 404 } });
  await deleteRow('tutor_progress_records', id);
  return { ok: true };
}

async function getAnalytics(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const T = todayStr();
  const tasks = await sel('tutor_tasks', sidFilter({ student_id: targetSid }));
  const done = tasks.filter((t) => t.status === 'Выполнено' && t.completed_at);
  const dday = (t) => String(t.completed_at).slice(0, 10);
  const monday = (ds) => { const d = new Date(ds + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
  const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wk0 = monday(T);
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const from = addDays(wk0, -7 * i), to = addDays(from, 6);
    weeks.push({
      from, done: done.filter((t) => dday(t) >= from && dday(t) <= to).length,
      planned: tasks.filter((t) => t.due_date && t.due_date >= from && t.due_date <= to).length,
      progress: computeRoute(stagesForRoute(targetSid), [], tasks, i === 0 ? T : to).overall,
    });
  }
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    months.push({ key, done: done.filter((t) => dday(t).startsWith(key)).length });
  }
  const p = await getOne('profiles', { id: targetSid });
  const dirNames = [...new Set([...JSON.parse(p?.directions || '[]'), ...tasks.map((t) => t.direction).filter(Boolean)])];
  const directions = [];
  for (const name of dirNames) {
    const ts = tasks.filter((t) => t.direction === name);
    let tot = 0, dn = 0;
    for (const t of ts) { const w = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 }[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; }
    directions.push({ name, total: ts.length, done: ts.filter((t) => t.status === 'Выполнено').length, pct: tot ? Math.round((dn / tot) * 100) : 0, minutes: ts.reduce((a, t) => a + t.minutes_spent, 0) });
  }
  const r = computeRoute(await sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }), await sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position,id' }), tasks);
  const plan = r.stages.map((s) => ({
    title: s.title, start: s.start_date, planned_end: s.end_date, actual_end: s.actual_end, pct: s.pct, status: s.status,
    delta: s.actual_end && s.end_date ? Math.round((Date.parse(s.actual_end) - Date.parse(s.end_date)) / 864e5) : null,
  }));
  const lateDone = done.filter((t) => t.due_date);
  const onTime = lateDone.filter((t) => dday(t) <= t.due_date).length;
  const goals = goalProgress(await sel('tutor_educational_goals', sidFilter({ student_id: targetSid }), { order: 'id' }), await sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }), tasks);
  const records = await sel('tutor_progress_records', sidFilter({ student_id: targetSid }), { order: 'recorded_at,id' });
  return {
    overall: r.overall, doneStages: r.doneStages, totalStages: r.totalStages, tasksDone: done.length, tasksTotal: tasks.length,
    minutes: tasks.reduce((a, t) => a + t.minutes_spent, 0), onTimePct: lateDone.length ? Math.round((onTime / lateDone.length) * 100) : null,
    weeks, months, directions, plan, goals, records, today: T,
  };
}

async function stagesForRoute(sid) {
  return sel('tutor_route_stages', sidFilter({ student_id: sid }), { order: 'position' });
}

async function getReport(u, sid, qs) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const from = qs.get('from'); const to = qs.get('to');
  if (!from || !to) throw new Error('Не указан период');
  const [p, tasks, r0, r1, records, goalsLogs, commentsLogs, routeLogs] = await Promise.all([
    getOne('profiles', { id: targetSid }),
    sel('tutor_tasks', sidFilter({ student_id: targetSid })),
    computeRoute(await sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }), await sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position,id' }), tasks, addDaysForReport(from, -1)),
    computeRoute(await sel('tutor_route_stages', sidFilter({ student_id: targetSid }), { order: 'position' }), await sel('tutor_milestones', sidFilter({ student_id: targetSid }), { order: 'position,id' }), tasks, addDaysForReport(to, 0)),
    sel('tutor_progress_records', sidFilter({ student_id: targetSid }), { order: 'recorded_at' }),
    sel('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'goal' }), { order: 'created_at' }),
    sel('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'tutor_comment' }), { order: 'created_at' }),
    sel('tutor_activity_logs', sidFilter({ student_id: targetSid, kind: 'route' }), { order: 'created_at' }),
  ]);
  const inRange = (s) => s && String(s).slice(0, 10) >= from && String(s).slice(0, 10) <= to;
  const doneTasks = tasks.filter((t) => t.status === 'Выполнено').filter((t) => inRange(t.completed_at));
  const stagesCompleted = r1.stages.filter((s) => s.status === 'completed' && inRange(s.actual_end)).map((s) => ({ title: s.title, date: s.actual_end }));
  const goalsAchieved = goalsLogs.filter((x) => inRange(x.created_at) && /Цель достигнута/.test(x.text));
  const comments = commentsLogs.filter((x) => inRange(x.created_at));
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
}

function addDaysForReport(ds, n) { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function getHistory(u, sid) {
  const targetSid = u.role === 'student' ? u.id : sid || u.id;
  const rows = await sel('tutor_activity_logs', sidFilter({ student_id: targetSid }), { order: 'created_at,id', limit: 200 });
  return Promise.all(rows.map(async (a) => {
    const prof = a.actor_id ? await getOne('profiles', { id: a.actor_id }) : null;
    return { id: a.id, kind: a.kind, text: a.text, created_at: a.created_at, actor: prof ? prof.full_name : '' };
  }));
}

async function getNotifications(u) {
  const { data: session } = await sb.auth.getSession();
  const userId = session.session.user.id;
  const T = todayStr(), soon = todayStr(2);
  const tasks = await sel('tutor_tasks', { student_id: userId });
  for (const t of tasks) {
    if (t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date >= T && t.due_date <= soon) {
      const ref = `dl-${t.id}-${t.due_date}`;
      const existing = await getOne('notifications', { user_id: userId, ref });
      if (!existing) await insertRow('notifications', { user_id: userId, kind: 'deadline', title: 'Приближается дедлайн', body: `«${t.title}» · ${t.due_date}`, link: '#/tasks', ref, is_read: false, created_at: new Date().toISOString() });
    }
  }
  const items = await sel('notifications', { user_id: userId }, { order: 'created_at,id', limit: 60 });
  const unreadRows = await sel('notifications', { user_id: userId, is_read: false });
  return { items, unread: unreadRows.length };
}

async function markNotificationsRead(u, body) {
  const { data: session } = await sb.auth.getSession();
  const userId = session.session.user.id;
  if (body.id) await sb.from('notifications').update({ is_read: true }).eq('id', body.id);
  else {
    const rows = await sel('notifications', { user_id: userId, is_read: false });
    for (const n of rows) await sb.from('notifications').update({ is_read: true }).eq('id', n.id);
  }
  return { ok: true };
}

async function getTools(u) {
  return sel('tutor_tools', {}, { order: 'position,id' });
}

async function createTool(u, body) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  const { data, error } = await sb.from('tutor_tools').insert({ ...body, status: body.status || 'Доступно' }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

async function updateTool(u, id, body) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  const { error } = await sb.from('tutor_tools').update(body).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function deleteTool(u, id) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  await deleteRow('tutor_tools', id);
  return { ok: true };
}

async function getTutorStudents(u) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  let rows;
  if (u.role === 'admin') {
    rows = await sel('tutor_user_roles', { role: 'student', active: true });
  } else {
    const links = await sel('tutor_students', { tutor_id: u.id });
    rows = links.map((l) => ({ user_id: l.student_id }));
  }
  const T = todayStr();
  const out = [];
  for (const row of rows) {
    const id = row.user_id;
    const p = await getOne('profiles', { id });
    const stages = await sel('tutor_route_stages', sidFilter({ student_id: id }), { order: 'position' });
    const milestones = await sel('tutor_milestones', sidFilter({ student_id: id }), { order: 'position,id' });
    const tasks = await sel('tutor_tasks', sidFilter({ student_id: id }));
    const r = computeRoute(stages, milestones, tasks);
    const activeTasks = tasks.filter((t) => !['Выполнено', 'Отложено'].includes(t.status)).length;
    const review = tasks.filter((t) => t.status === 'На проверке').length;
    const overdue = tasks.filter((t) => t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date < T).length;
    const nextDeadlineRow = tasks.filter((t) => t.status !== 'Выполнено' && t.status !== 'Отложено' && t.due_date && t.due_date >= T).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'))[0];
    out.push({
      id, email: p?.email || '', name: p?.full_name, photo_url: p?.photo_url, main_goal: p?.main_goal, status: p?.status,
      stage: r.current?.title || (r.totalStages ? 'Все этапы завершены' : 'Маршрут не создан'), progress: r.overall,
      active, review, overdue, nextDeadline: nextDeadlineRow ? nextDeadlineRow.due_date : null,
      lastActivity: null,
    });
  }
  return out;
}

async function unlinkStudent(u, sid) {
  if (u.role !== 'tutor' && u.role !== 'admin') throw new Error('Недостаточно прав', { cause: { status: 403 } });
  if (u.role === 'admin') throw new Error('Используйте раздел администратора', { cause: { status: 400 } });
  await deleteWhere('tutor_students', { tutor_id: u.id, student_id: sid });
  return { ok: true };
}

async function getAdminUsers(u) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  const users = await sel('tutor_user_roles', {}, { order: 'id' });
  const links = await sel('tutor_students');
  const out = [];
  for (const ur of users) {
    const id = ur.user_id;
    const p = await getOne('profiles', { id });
    out.push({
      id, email: p?.email || '', role: ur.role, active: ur.active !== false,
      created_at: ur.created_at, name: p?.full_name,
      tutors: links.filter((l) => l.student_id === id).map((l) => l.tutor_id),
      students: links.filter((l) => l.tutor_id === id).map((l) => l.student_id),
    });
  }
  return { users: out };
}

async function updateAdminUser(u, id, body) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  const roleRow = await getOne('tutor_user_roles', { user_id: id });
  if (!roleRow) throw new Error('Не найдено', { cause: { status: 404 } });
  if (id === u.id && (body.role && body.role !== 'admin' || body.active === false || body.active === 0)) throw new Error('Нельзя понизить или отключить себя');
  if (body.role) {
    if (!['student', 'tutor', 'admin'].includes(body.role)) throw new Error('Неверная роль');
    await sb.from('tutor_user_roles').update({ role: body.role }).eq('user_id', id);
    if (body.role === 'student') {
      const hasRoute = await getOne('tutor_learning_routes', { student_id: id });
      if (!hasRoute) await sb.from('tutor_learning_routes').insert({ student_id: id, created_at: new Date().toISOString() });
    }
  }
  if (body.active !== undefined) {
    await sb.from('tutor_user_roles').update({ active: body.active ? true : false }).eq('user_id', id);
  }
  if (body.password) {
    const { error } = await sb.auth.admin.updateUserById(id, { password: body.password });
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

async function adminLink(u, body) {
  if (u.role !== 'admin') throw new Error('Только для администратора', { cause: { status: 403 } });
  const tutorId = String(body.tutor_id);
  const studentId = String(body.student_id);
  const t = await getOne('tutor_user_roles', { user_id: tutorId });
  const s = await getOne('tutor_user_roles', { user_id: studentId });
  if (!t || (t.role !== 'tutor' && t.role !== 'admin')) throw new Error('Неверные пользователи');
  if (!s || s.role !== 'student') throw new Error('Неверные пользователи');
  if (body.unlink) await deleteWhere('tutor_students', { tutor_id: tutorId, student_id: studentId });
  else {
    const existing = await getOne('tutor_students', { tutor_id: tutorId, student_id: studentId });
    if (!existing) await insertRow('tutor_students', { tutor_id: tutorId, student_id: studentId, created_at: new Date().toISOString() });
  }
  return { ok: true };
}

/* ───── даты ───── */
const MONTHS = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const pd = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');
export const fmtD = (s) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const fmtDY = (s) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtT = (s) => (s && s.length >= 16 ? s.slice(11, 16) : '');
export const longToday = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export function ago(iso) {
  if (!iso) return 'нет активности';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'только что';
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  const d = Math.round(diff / 86400);
  if (d < 31) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return fmtDY(iso);
}
export const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
export const dayDiff = (a, b) => Math.round((pd(a) - pd(b)) / 864e5);
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/* ───── иконки ───── */
const IC = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  route: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.2 6H13a3.5 3.5 0 010 7h-2a3.5 3.5 0 000 5h4.8"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>',
  chart: '<path d="M4 20h16M7 17v-5M12 17V7M17 17v-8"/>',
  book: '<path d="M5 4h13v16H7a2 2 0 01-2-2zM5 18a2 2 0 012-2h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  bell: '<path d="M6 16v-5a6 6 0 1112 0v5l1.5 2h-15zM10 21h4"/>',
  tool: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 15c2.5.5 3.5 2.5 3.5 5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  book2: '<path d="M4 19V6a2 2 0 012-2h12v14H6a2 2 0 00-2 2zM8 8h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
};
export const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.tool}</svg>`;
export const iconNames = ['target', 'tool', 'chart', 'book', 'route', 'file'];

export const avatar = (p, cls = '') => p?.photo_url
  ? `<span class="avatar ${cls}"><img src="${esc(p.photo_url)}" alt="" referrerpolicy="no-referrer"></span>`
  : `<span class="avatar ${cls}">${esc(initials(p?.full_name || p?.name))}</span>`;

/* ───── теги ───── */
export const STATUS_CLS = { 'Не начато': '', 'В процессе': 'accent', 'На проверке': 'warn', 'Выполнено': 'ok', 'Отложено': '' };
export const statusTag = (s) => `<span class="tag ${STATUS_CLS[s] || ''}">${esc(s)}</span>`;
export const prioTag = (p) => (p === 'Критический' ? `<span class="tag danger">${esc(p)}</span>` : p === 'Высокий' ? `<span class="tag warn">${esc(p)}</span>` : p === 'Низкий' ? `<span class="tag">${esc(p)}</span>` : '');
export const PRIORITIES = ['Низкий', 'Обычный', 'Высокий', 'Критический'];
export const TASK_STATUSES = ['Не начато', 'В процессе', 'На проверке', 'Выполнено', 'Отложено'];
export const TASK_TYPES = ['Изучение материала', 'Практическое задание', 'Тестирование', 'Исследование', 'Подготовка проекта', 'Самостоятельная работа', 'Рефлексия', 'Консультация'];
export const GOAL_CATS = ['Академические', 'Профессиональные', 'Языковые', 'Личностное развитие', 'Исследовательские', 'Дополнительное образование'];

/* ───── прогресс ───── */
export const bar = (pct, cls = '') => `<div class="bar ${cls}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i data-w="${pct}"></i></div>`;
export function ring(pct, size = 150, stroke = 9) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="ring" style="--s:${size}px"><svg width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#1f2430" stroke-width="${stroke}"/>
    <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#5b8def" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - pct / 100)}" style="filter:drop-shadow(0 0 6px rgba(91,141,239,.55))"/></svg>
    <div class="num"><b>${pct}%</b><span class="xs muted">маршрут</span></div></div>`;
}

/* ───── графики (SVG) ───── */
export function barChart(items, { w = 560, h = 190, plan = false } = {}) {
  const pad = { l: 26, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...items.map((i) => Math.max(i.value, i.plan || 0)));
  const nice = Math.max(2, Math.ceil(max / 2) * 2);
  const iw = (w - pad.l - pad.r) / items.length, ih = h - pad.t - pad.b;
  const y = (v) => pad.t + ih - (v / nice) * ih;
  let g = '';
  for (let i = 0; i <= 2; i++) { const v = (nice / 2) * i; g += `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
  const bw = Math.min(26, iw * (plan ? 0.34 : 0.55));
  items.forEach((it, k) => {
    const cx = pad.l + iw * k + iw / 2;
    if (plan) {
      g += `<rect class="bar-rect plan" x="${cx - bw - 1}" y="${y(it.plan || 0)}" width="${bw}" height="${ih - (y(it.plan || 0) - pad.t)}" rx="2" style="animation-delay:${k * 40}ms"><title>Запланировано: ${it.plan || 0}</title></rect>`;
      g += `<rect class="bar-rect" x="${cx + 1}" y="${y(it.value)}" width="${bw}" height="${ih - (y(it.value) - pad.t)}" rx="2" style="animation-delay:${k * 40 + 60}ms"><title>Выполнено: ${it.value}</title></rect>`;
    } else g += `<rect class="bar-rect" x="${cx - bw / 2}" y="${y(it.value)}" width="${bw}" height="${ih - (y(it.value) - pad.t)}" rx="3" style="animation-delay:${k * 50}ms"><title>${esc(it.label)}: ${it.value}</title></rect>`;
    if (items.length <= 12 || k % 2 === 0) g += `<text x="${cx}" y="${h - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Столбчатая диаграмма">${g}</svg>`;
}
export function lineChart(items, { w = 560, h = 190, max = 100, unit = '%' } = {}) {
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = (w - pad.l - pad.r) / Math.max(1, items.length - 1), ih = h - pad.t - pad.b;
  const y = (v) => pad.t + ih - (v / max) * ih, x = (k) => pad.l + iw * k;
  let g = '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8def" stop-opacity=".35"/><stop offset="1" stop-color="#5b8def" stop-opacity="0"/></linearGradient></defs>';
  [0, max / 2, max].forEach((v) => { g += `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}${unit}</text>`; });
  const pts = items.map((it, k) => `${x(k).toFixed(1)},${y(it.value).toFixed(1)}`);
  const len = Math.ceil(items.reduce((a, _, k) => (k ? a + Math.hypot(iw, y(items[k].value) - y(items[k - 1].value)) : 0), 0)) + 20;
  g += `<polygon class="area" points="${x(0)},${y(0)} ${pts.join(' ')} ${x(items.length - 1)},${y(0)}"/>`;
  g += `<polyline class="line" style="--len:${len}" points="${pts.join(' ')}"/>`;
  items.forEach((it, k) => {
    g += `<circle cx="${x(k)}" cy="${y(it.value)}" r="3" fill="#08090b" stroke="#5b8def" stroke-width="1.8"><title>${esc(it.label)}: ${it.value}${unit}</title></circle>`;
    if (k % 2 === 0 || items.length < 8) g += `<text x="${x(k)}" y="${h - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Линейный график">${g}</svg>`;
}

/* ───── уведомления, модальные окна ───── */
export function toast(msg, isErr = false) {
  const el = document.createElement('div'); el.className = 'toast' + (isErr ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), isErr ? 5200 : 3400);
}

export function modal({ title, body, wide = false, onMount }) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="x" type="button" aria-label="Закрыть">×</button></div><div class="modal-body">${body}</div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('.x', ov).onclick = close; document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  const first = $('input:not([type=checkbox]),textarea,select', ov); first && !matchMedia('(max-width:640px)').matches && first.focus();
  onMount && onMount(ov, close);
  return { close, el: ov };
}

export function fieldHtml(f) {
  const v = f.value ?? '';
  const id = 'f_' + f.name;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 5000}">${esc(v)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.name}" ${f.required ? 'required' : ''}>${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else if (f.type === 'checkbox') return `<div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span style="color:var(--color-text-primary);font-weight:500">${esc(f.label)}</span></label></div>`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null && f.type === 'number' ? `max="${f.max}"` : ''} maxlength="${f.type === 'number' ? 10 : f.max || 300}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<span class="xs muted">${esc(f.hint)}</span>` : ''}</div>`;
}
export function readForm(form, fields) {
  const o = {};
  for (const f of fields) {
    const el = form.elements[f.name]; if (!el) continue;
    o[f.name] = f.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
export function formModal({ title, fields, submit = 'Сохранить', onSubmit, wide = false, footer = '' }) {
  const rows = []; let i = 0;
  while (i < fields.length) { if (fields[i].half && fields[i + 1]?.half) { rows.push(`<div class="field-row">${fieldHtml(fields[i])}${fieldHtml(fields[i + 1])}</div>`); i += 2; } else rows.push(fieldHtml(fields[i++])); }
  return modal({
    title, wide, body: `<form novalidate>${rows.join('')}<p class="err" hidden></p><div class="row sb wrap" style="margin-top:6px"><div>${footer}</div><button class="btn primary" type="submit">${esc(submit)}</button></div></form>`,
    onMount(ov, close) {
      const form = $('form', ov), err = $('.err', ov);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        const btn = $('button[type=submit]', form); btn.disabled = true;
        try { await onSubmit(readForm(form, fields), close); } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
      });
    },
  });
}
export function confirmBox(text, okLabel = 'Удалить') {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title: 'Подтвердите действие', body: `<p>${esc(text)}</p><div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn" data-n>Отмена</button><button class="btn danger" data-y>${esc(okLabel)}</button></div>`,
      onMount(ov, close) { $('[data-n]', ov).onclick = () => { done = true; close(); res(false); }; $('[data-y]', ov).onclick = () => { done = true; close(); res(true); }; } });
    new MutationObserver((_, ob) => { if (!document.body.contains(m.el)) { ob.disconnect(); if (!done) res(false); } }).observe(document.body, { childList: true });
  });
}

export const empty = (text, ic = 'file') => `<div class="empty">${icon(ic, 34)}<div>${esc(text)}</div></div>`;
export const nl2 = (s) => esc(s).replace(/\n/g, '<br>');
export const linkTag = (u) => (u ? `<a class="small" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('link', 14)} Открыть ресурс</a>` : '');

let io;
export function postRender(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.bar>i[data-w]', root).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    $$('circle.fg[data-off]', root).forEach((c) => { c.style.strokeDashoffset = c.dataset.off; });
  }));
  if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.06 });
  $$('.reveal:not(.in)', root).forEach((el, i) => { el.style.transitionDelay = Math.min(i * 50, 250) + 'ms'; io.observe(el); });
}

export const nowHour = () => Number(new Date().toLocaleString('ru-RU', { hour: '2-digit', hour12: false, timeZone: 'Europe/Moscow' }).slice(0, 2)) % 24;
