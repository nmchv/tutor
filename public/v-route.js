import { $, $$, S, api, esc, isStaff, icon, toast, formModal, confirmBox, ring, bar, empty, fmtD, fmtDY, ago, dayDiff, statusTag, prioTag, PRIORITIES, postRender } from './lib.js';
import { openTask, openTaskForm } from './v-tasks.js';

let ROUTE = null, OPEN = null;
const ST = { completed: ['Завершён', 'ok'], current: ['Текущий', 'accent'], overdue: ['Просрочен', 'warn'], future: ['Впереди', ''] };

function msHtml(m, staff) {
  const clickable = staff && !m.hasTasks;
  return `<div class="ms ${m.done ? 'done' : ''}"><button class="ms-dot check" style="${clickable ? '' : 'cursor:default'}" ${clickable ? `data-act="ms-toggle" data-id="${m.id}" data-v="${m.done ? 0 : 1}" title="Отметить достигнутой"` : 'tabindex="-1" aria-hidden="true"'}>${icon('check', 10)}</button>
    <div style="flex:1;min-width:0"><div class="row sb wrap" style="gap:6px"><b class="small" style="font-weight:600">${esc(m.title)}</b>
      <span class="row" style="gap:8px">${m.due_date ? `<span class="due ${!m.done && m.due_date < ROUTE.today ? 'late' : ''}">${fmtD(m.due_date)}</span>` : ''}${m.hasTasks ? `<span class="xs muted">${m.taskDone}/${m.taskCount}</span>` : ''}
      ${staff ? `<button class="icon-btn" style="width:28px;height:28px" data-act="ms-edit" data-id="${m.id}" aria-label="Изменить">${icon('edit', 14)}</button><button class="icon-btn" style="width:28px;height:28px" data-act="task-add-ms" data-stage="${m.stage_id}" data-id="${m.id}" aria-label="Добавить задачу" title="Добавить задачу">${icon('plus', 14)}</button><button class="icon-btn" style="width:28px;height:28px" data-act="ms-del" data-id="${m.id}" aria-label="Удалить">${icon('trash', 14)}</button>` : ''}</span></div>
      ${m.tasks.length ? `<div class="ms-tasks">${m.tasks.map((t) => `<div class="ms-task" data-act="task-open" data-id="${t.id}"><span class="dot" style="color:${t.status === 'Выполнено' ? 'var(--color-accent)' : t.status === 'На проверке' ? 'var(--warn)' : '#4a5364'}"></span>${esc(t.title)}</div>`).join('')}</div>` : ''}</div></div>`;
}

function stageHtml(s, i, staff, last) {
  const [lbl, cls] = ST[s.status];
  const open = OPEN.has(s.id);
  const dates = s.status === 'completed' && s.actual_end
    ? `${fmtD(s.start_date)} — ${fmtDY(s.actual_end)} <span class="xs">(план: ${fmtD(s.end_date)})</span>` : `${fmtD(s.start_date)} — ${fmtDY(s.end_date)}`;
  const late = s.status === 'overdue' ? `<span class="tag warn">просрочен на ${dayDiff(ROUTE.today, s.end_date)} дн.</span>` : '';
  return `<div class="stage ${s.status} ${open ? 'open' : ''} reveal" data-stage="${s.id}">
    <div class="node">${s.status === 'completed' ? icon('check', 16) : i + 1}</div>
    <div class="stage-card"><div class="stage-head" data-act="stage-toggle" data-id="${s.id}" tabindex="0" role="button" aria-expanded="${open}">
      <div style="flex:1;min-width:0"><div class="meta" style="margin:0 0 8px"><span class="tag ${cls}">${lbl}</span>${late}${s.goal_title ? `<span class="tag">${esc(s.goal_title.length > 36 ? s.goal_title.slice(0, 36) + '…' : s.goal_title)}</span>` : ''}${prioTag(s.priority)}</div>
        <h3>${esc(s.title)}</h3><div class="small muted" style="margin-top:3px">${dates}</div>
        <div class="row" style="gap:12px;margin-top:12px"><div style="flex:1;max-width:340px">${bar(s.pct, s.status === 'overdue' ? 'warn' : '')}</div><b class="small">${s.pct}%</b><span class="xs muted">${s.tasksDone}/${s.tasksTotal} задач</span></div></div>
      <span class="chev muted">${icon('chev', 20)}</span></div>
      <div class="stage-body">
        ${s.description ? `<p class="small muted" style="margin:14px 0 6px">${esc(s.description)}</p>` : ''}
        ${staff ? `<div class="row wrap" style="margin:12px 0 4px"><button class="btn sm" data-act="stage-edit" data-id="${s.id}">${icon('edit', 14)} Изменить</button><button class="btn sm" data-act="ms-add" data-id="${s.id}">${icon('plus', 14)} Контрольная точка</button><button class="btn sm" data-act="task-add-stage" data-id="${s.id}">${icon('plus', 14)} Задача</button>
          <button class="icon-btn" data-act="stage-up" data-id="${s.id}" ${i === 0 ? 'disabled style="opacity:.3"' : ''} aria-label="Выше">${icon('up', 18)}</button><button class="icon-btn" data-act="stage-down" data-id="${s.id}" ${last ? 'disabled style="opacity:.3"' : ''} aria-label="Ниже">${icon('down', 18)}</button><button class="icon-btn" data-act="stage-del" data-id="${s.id}" aria-label="Удалить этап">${icon('trash', 18)}</button></div>` : ''}
        <div class="eyebrow" style="margin:16px 0 4px">Контрольные точки</div>
        ${s.milestones.length ? s.milestones.map((m) => msHtml(m, staff)).join('') : '<p class="small muted">Контрольных точек пока нет.</p>'}
        ${s.looseTasks.length ? `<div class="eyebrow" style="margin:16px 0 6px">Задачи этапа</div><div class="ms-tasks">${s.looseTasks.map((t) => `<div class="ms-task" data-act="task-open" data-id="${t.id}"><span class="dot" style="color:${t.status === 'Выполнено' ? 'var(--color-accent)' : '#4a5364'}"></span>${esc(t.title)}</div>`).join('')}</div>` : ''}
      </div></div></div>`;
}

export async function view() {
  ROUTE = await api('/api/route');
  const staff = isStaff();
  if (!OPEN || OPEN.sid !== S.sid) { OPEN = new Set(); OPEN.sid = S.sid; const c = ROUTE.stages.find((s) => s.status !== 'completed'); if (c) OPEN.add(c.id); }
  const n = ROUTE.stages.length;
  return `<div class="page-head"><div><div class="eyebrow">Долгосрочное планирование</div><h1>Образовательный маршрут</h1><p class="muted">Цель → этапы → контрольные точки → задачи. Здесь видно, где вы находитесь и куда движетесь.</p></div>
    ${staff ? `<div class="actions"><button class="btn primary" data-act="stage-add">${icon('plus', 16)} Добавить этап</button></div>` : ''}</div>
    <section class="panel reveal" style="margin-bottom:22px"><div class="row wrap" style="gap:26px">${ring(ROUTE.overall, 112, 8)}
      <div style="flex:1;min-width:220px"><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${ROUTE.doneStages}<span class="muted" style="font-size:1rem">/${n}</span></b><span class="small muted">этапов завершено</span></div>
      <div class="stat"><b>${ROUTE.stages.filter((s) => s.status === 'current').length}</b><span class="small muted">в работе</span></div>
      <div class="stat"><b>${ROUTE.stages.filter((s) => s.status === 'overdue').length}</b><span class="small muted">просрочено</span></div></div>
      <div class="legend" style="margin-top:14px"><span><i style="background:var(--color-accent)"></i>Завершено</span><span><i style="background:#0d1424;box-shadow:var(--glow)"></i>Текущий этап</span><span><i style="background:#3a4252"></i>Впереди</span><span><i style="background:var(--warn)"></i>Просрочено</span></div></div></div></section>
    ${n ? `<div class="tl" id="tl"><div class="tl-line"><i id="tl-fill"></i></div>${ROUTE.stages.map((s, i) => stageHtml(s, i, staff, i === n - 1)).join('')}</div>`
      : `<section class="panel">${empty(staff ? 'Маршрут пока пуст. Добавьте первый этап.' : 'Тьютор ещё не составил маршрут.', 'route')}</section>`}
    <section class="panel reveal" style="margin-top:26px"><div class="panel-title"><h2>История изменений маршрута</h2></div>
      ${ROUTE.history.length ? `<div class="feed">${ROUTE.history.map((h) => `<div class="feed-item"><div class="small">${esc(h.text)}</div><div class="xs muted">${esc(h.actor || '')} · ${ago(h.created_at)}</div></div>`).join('')}</div>` : '<p class="small muted">Изменений пока не было.</p>'}</section>`;
}

function fillLine() {
  const fill = $('#tl-fill'); if (!fill) return;
  const els = $$('.stage', $('#tl')); let idx = -1;
  els.forEach((e, i) => { if (!e.classList.contains('future')) idx = i; });
  if (idx < 0) { fill.style.height = '0'; return; }
  fill.style.height = els[idx].offsetTop + 36 + 'px';
}
export function mount() { setTimeout(fillLine, 60); window.addEventListener('resize', fillLine, { once: true }); }

const stageFields = (s = {}) => [
  { name: 'title', label: 'Название этапа', required: true, value: s.title },
  { name: 'description', label: 'Описание', type: 'textarea', value: s.description },
  { name: 'start_date', label: 'Начало', type: 'date', value: s.start_date || '', half: true },
  { name: 'end_date', label: 'Окончание', type: 'date', value: s.end_date || '', half: true },
  { name: 'weight', label: 'Вес этапа в общем прогрессе', type: 'select', options: [1, 2, 3, 4, 5].map((n) => [n, `${n}`]), value: s.weight || 1, half: true },
  { name: 'priority', label: 'Приоритет', type: 'select', options: PRIORITIES, value: s.priority || 'Обычный', half: true },
  { name: 'goal_id', label: 'Цель', type: 'select', options: [['', '— без цели —'], ...ROUTE.goals.map((g) => [g.id, g.title])], value: s.goal_id || '' },
];
const findMs = (id) => { for (const s of ROUTE.stages) { const m = s.milestones.find((x) => x.id === id); if (m) return m; } };
const done = (msg) => (close) => { close && close(); toast(msg); S.refresh(); };

export const acts = {
  'stage-toggle': (el) => {
    const id = +el.dataset.id, card = el.closest('.stage');
    card.classList.toggle('open'); const o = card.classList.contains('open');
    o ? OPEN.add(id) : OPEN.delete(id); el.setAttribute('aria-expanded', o);
    setTimeout(fillLine, 20);
  },
  'stage-add': () => formModal({ title: 'Новый этап', fields: stageFields(), submit: 'Добавить', wide: true,
    async onSubmit(v, close) { v.goal_id = v.goal_id ? Number(v.goal_id) : null; v.weight = Number(v.weight); await api('/api/stages', { method: 'POST', body: v }); done('Этап добавлен')(close); } }),
  'stage-edit': (el) => { const s = ROUTE.stages.find((x) => x.id === +el.dataset.id);
    formModal({ title: 'Изменить этап', fields: stageFields(s), wide: true,
      async onSubmit(v, close) { v.goal_id = v.goal_id ? Number(v.goal_id) : null; v.weight = Number(v.weight); await api('/api/stages/' + s.id, { method: 'PATCH', body: v }); done('Этап обновлён')(close); } }); },
  'stage-del': async (el) => { const s = ROUTE.stages.find((x) => x.id === +el.dataset.id);
    if (await confirmBox(`Удалить этап «${s.title}»? Контрольные точки будут удалены, задачи сохранятся без привязки.`)) { await api('/api/stages/' + s.id, { method: 'DELETE' }); done('Этап удалён')(); } },
  'stage-up': async (el) => { await api(`/api/stages/${el.dataset.id}/move`, { method: 'POST', body: { dir: -1 } }); S.refresh(); },
  'stage-down': async (el) => { await api(`/api/stages/${el.dataset.id}/move`, { method: 'POST', body: { dir: 1 } }); S.refresh(); },
  'ms-add': (el) => formModal({ title: 'Новая контрольная точка', submit: 'Добавить',
    fields: [{ name: 'title', label: 'Результат, которого нужно достичь', required: true }, { name: 'due_date', label: 'Срок', type: 'date' }],
    async onSubmit(v, close) { await api(`/api/stages/${el.dataset.id}/milestones`, { method: 'POST', body: v }); done('Контрольная точка добавлена')(close); } }),
  'ms-edit': (el) => { const m = findMs(+el.dataset.id);
    formModal({ title: 'Контрольная точка', fields: [{ name: 'title', label: 'Название', required: true, value: m.title }, { name: 'due_date', label: 'Срок', type: 'date', value: m.due_date || '' }],
      async onSubmit(v, close) { await api('/api/milestones/' + m.id, { method: 'PATCH', body: v }); done('Сохранено')(close); } }); },
  'ms-del': async (el) => { if (await confirmBox('Удалить контрольную точку?')) { await api('/api/milestones/' + el.dataset.id, { method: 'DELETE' }); done('Удалено')(); } },
  'ms-toggle': async (el) => { await api('/api/milestones/' + el.dataset.id, { method: 'PATCH', body: { done: el.dataset.v === '1' } }); S.refresh(); },
  'task-add-stage': (el) => openTaskForm({ defaults: { stage_id: +el.dataset.id } }),
  'task-add-ms': (el) => openTaskForm({ defaults: { stage_id: +el.dataset.stage, milestone_id: +el.dataset.id } }),
};
