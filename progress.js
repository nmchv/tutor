import { select, todayStr } from './lib/db.js';

export const WEIGHT = { 'Низкий': 1, 'Обычный': 2, 'Высокий': 3, 'Критический': 4 };
const day = (s) => (s ? String(s).slice(0, 10) : null);

export async function computeRoute(sb, sid, asOf = null) {
  const T = todayStr();
  const stages = await select(sb, 'tutor_route_stages', { student_id: sid }, { order: 'position', count: false });
  const ms = await select(sb, 'tutor_milestones', { student_id: sid }, { order: 'position,id' });
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid });
  const isDone = (t) => t.status === 'Выполнено' && t.completed_at && (!asOf || day(t.completed_at) <= asOf);

  let sumW = 0, sumP = 0, doneStages = 0;
  const out = [];
  for (const s of stages) {
    const st = tasks.filter((t) => t.stage_id === s.id);
    const sm = [];
    for (const m of ms.filter((m) => m.stage_id === s.id)) {
      const mt = st.filter((t) => t.milestone_id === m.id);
      const manual = asOf ? m.done && day(m.done_at) <= asOf : !!m.done;
      const done = mt.length ? mt.every(isDone) : manual;
      sm.push({ ...m, done: done ? 1 : 0, taskCount: mt.length, taskDone: mt.filter(isDone).length, hasTasks: mt.length > 0 });
    }
    let total = 0, doneW = 0;
    for (const t of st) { const w = WEIGHT[t.priority] || 2; total += w; if (isDone(t)) doneW += w; }
    for (const m of sm.filter((m) => !m.hasTasks)) { total += 2; if (m.done) doneW += 2; }
    const pct = total ? Math.round((doneW / total) * 100) : 0;
    let status = 'future';
    if (total && pct >= 100) status = 'completed';
    else if (s.end_date && s.end_date < T) status = 'overdue';
    else if (!s.start_date || s.start_date <= T) status = 'current';
    if (status === 'completed') doneStages++;
    const doneDates = st.filter(isDone).map((t) => day(t.completed_at)).sort();
    sumW += s.weight || 1;
    sumP += (s.weight || 1) * pct;
    out.push({
      ...s, pct, status, milestones: sm,
      tasksTotal: st.length, tasksDone: st.filter(isDone).length,
      actual_end: status === 'completed' ? (doneDates[doneDates.length - 1] || null) : null,
    });
  }
  const overall = sumW ? Math.round(sumP / sumW) : 0;
  const current = out.find((s) => s.status !== 'completed') || null;
  const isDoneAll = tasks.filter(isDone).length;
  return { stages: out, overall, doneStages, totalStages: out.length, current, tasksDone: isDoneAll, tasksTotal: tasks.length };
}

export async function goalProgress(sb, sid) {
  const goals = await select(sb, 'tutor_educational_goals', { student_id: sid }, { order: 'id' });
  const stages = await select(sb, 'tutor_route_stages', { student_id: sid });
  const tasks = await select(sb, 'tutor_tasks', { student_id: sid });
  const stageGoal = Object.fromEntries(stages.map((s) => [s.id, s.goal_id]));
  return goals.map((g) => {
    let criteria = [];
    try { criteria = JSON.parse(g.criteria || '[]'); } catch {}
    const mine = tasks.filter((t) => (t.goal_id ?? stageGoal[t.stage_id]) === g.id);
    let tot = 0, dn = 0;
    for (const t of mine) { const w = WEIGHT[t.priority] || 2; tot += w; if (t.status === 'Выполнено') dn += w; }
    const critPct = criteria.length ? Math.round((criteria.filter((c) => c.done).length / criteria.length) * 100) : null;
    let pct = tot ? Math.round((dn / tot) * 100) : (critPct ?? 0);
    if (g.status === 'Достигнута') pct = 100;
    return {
      ...g, criteria, pct, critPct,
      tasksTotal: mine.length, tasksDone: mine.filter((t) => t.status === 'Выполнено').length,
      stages: stages.filter((s) => s.goal_id === g.id).map((s) => s.id),
    };
  });
}
