import { q, todayStr } from './db.js';

export const WEIGHT = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 };
const day = (s) => (s ? s.slice(0, 10) : null);

/**
 * Расчёт маршрута и прогресса по реальным данным.
 * Прогресс этапа = вес выполненных задач / вес всех задач этапа (вес задачи зависит от приоритета).
 * Контрольные точки без задач считаются как элементы веса 2.
 * Общий прогресс = среднее прогрессов этапов с учётом веса этапа.
 * asOf (YYYY-MM-DD) — расчёт «на дату» по фактическим датам завершения.
 */
export function computeRoute(sid, asOf = null) {
  const T = todayStr();
  const stages = q.all('SELECT * FROM route_stages WHERE student_id=? ORDER BY position,id', sid);
  const ms = q.all('SELECT * FROM milestones WHERE student_id=? ORDER BY position,id', sid);
  const tasks = q.all(
    'SELECT id,stage_id,milestone_id,goal_id,priority,status,due_date,completed_at,direction,minutes_spent FROM tasks WHERE student_id=?',
    sid
  );
  const isDone = (t) => t.status === 'Выполнено' && t.completed_at && (!asOf || day(t.completed_at) <= asOf);

  let sumW = 0, sumP = 0, doneStages = 0;
  const out = stages.map((s) => {
    const st = tasks.filter((t) => t.stage_id === s.id);
    const sm = ms.filter((m) => m.stage_id === s.id).map((m) => {
      const mt = st.filter((t) => t.milestone_id === m.id);
      const manual = asOf ? m.done && day(m.done_at) <= asOf : !!m.done;
      const done = mt.length ? mt.every(isDone) : manual;
      return { ...m, done: done ? 1 : 0, taskCount: mt.length, taskDone: mt.filter(isDone).length, hasTasks: mt.length > 0 };
    });
    let total = 0, doneW = 0;
    st.forEach((t) => { const w = WEIGHT[t.priority] || 2; total += w; if (isDone(t)) doneW += w; });
    sm.filter((m) => !m.hasTasks).forEach((m) => { total += 2; if (m.done) doneW += 2; });
    const pct = total ? Math.round((doneW / total) * 100) : 0;
    let status = 'future';
    if (total && pct >= 100) status = 'completed';
    else if (s.end_date && s.end_date < T) status = 'overdue';
    else if (!s.start_date || s.start_date <= T) status = 'current';
    if (status === 'completed') doneStages++;
    const doneDates = st.filter(isDone).map((t) => day(t.completed_at)).sort();
    sumW += s.weight || 1;
    sumP += (s.weight || 1) * pct;
    return {
      ...s, pct, status, milestones: sm,
      tasksTotal: st.length, tasksDone: st.filter(isDone).length,
      actual_end: status === 'completed' ? doneDates[doneDates.length - 1] || null : null,
    };
  });
  const overall = sumW ? Math.round(sumP / sumW) : 0;
  const current = out.find((s) => s.status !== 'completed') || null;
  const isDoneAll = tasks.filter(isDone).length;
  return { stages: out, overall, doneStages, totalStages: out.length, current, tasksDone: isDoneAll, tasksTotal: tasks.length };
}

export function goalProgress(sid) {
  const goals = q.all('SELECT * FROM educational_goals WHERE student_id=? ORDER BY id', sid);
  const stages = q.all('SELECT id,goal_id FROM route_stages WHERE student_id=?', sid);
  const tasks = q.all('SELECT stage_id,goal_id,priority,status FROM tasks WHERE student_id=?', sid);
  const stageGoal = Object.fromEntries(stages.map((s) => [s.id, s.goal_id]));
  return goals.map((g) => {
    let criteria = [];
    try { criteria = JSON.parse(g.criteria); } catch {}
    const mine = tasks.filter((t) => (t.goal_id ?? stageGoal[t.stage_id]) === g.id);
    let tot = 0, dn = 0;
    mine.forEach((t) => { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; });
    const critPct = criteria.length ? Math.round((criteria.filter((c) => c.done).length / criteria.length) * 100) : null;
    let pct = tot ? Math.round((dn / tot) * 100) : critPct ?? 0;
    if (g.status === 'Достигнута') pct = 100;
    return {
      ...g, criteria, pct, critPct,
      tasksTotal: mine.length, tasksDone: mine.filter((t) => t.status === 'Выполнено').length,
      stages: stages.filter((s) => s.goal_id === g.id).map((s) => s.id),
    };
  });
}
