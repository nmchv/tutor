import { $, $$, S, api, esc, isStaff, icon, toast, modal, formModal, confirmBox, empty, nl2, linkTag, fmtD, fmtDY, statusTag, prioTag, postRender, PRIORITIES, TASK_STATUSES, TASK_TYPES, dayDiff } from './lib.js';

console.log('v-tasks.js loaded');

export const taskCache = new Map();
let META = null;
export async function loadTasks() {
  const d = await api('/api/tasks');
  taskCache.clear(); d.tasks.forEach((t) => taskCache.set(t.id, t));
  META = d; return d;
}

/* ───── строка задачи (общая для разных разделов) ───── */
export function taskRow(t, today, { stage = false } = {}) {
  const done = t.status === 'Выполнено', rev = t.status === 'На проверке';
  const late = !done && t.due_date && t.due_date < today;
  const locked = !isStaff() && done && t.source !== 'personal';
  const cb = `<button class="check ${done ? 'on' : rev ? 'review' : ''}" data-act="task-toggle" data-id="${t.id}" ${locked ? 'disabled' : ''} aria-label="${done ? 'Вернуть в работу' : 'Отметить выполненной'}" title="${rev && !isStaff() ? 'На проверке у тьютора' : done ? 'Выполнено' : 'Отметить выполненной'}">${rev ? icon('more', 12) : icon('check', 12)}</button>`;
  return `<div class="task ${done ? 'done' : ''}">${cb}<div>
    <div class="task-title" data-act="task-open" data-id="${t.id}" tabindex="0" role="button">${esc(t.title)}</div>
    ${t.description ? `<div class="small muted" style="margin-top:2px">${esc(t.description.length > 110 ? t.description.slice(0, 110) + '…' : t.description)}</div>` : ''}
    <div class="meta">${t.direction ? `<span class="tag">${esc(t.direction)}</span>` : ''}${prioTag(t.priority)}${statusTag(t.status)}${stage && t.stage_title ? `<span class="tag">${esc(t.stage_title)}</span>` : ''}${t.source === 'personal' ? '<span class="tag">Личная</span>' : ''}</div>
  </div><div class="task-side" style="text-align:right;white-space:nowrap"><div class="due ${late ? 'late' : ''}">${t.due_date ? fmtD(t.due_date) : 'без срока'}</div>${late ? `<div class="xs" style="color:#efb27a">просрочено на ${dayDiff(today, t.due_date)} дн.</div>` : ''}</div></div>`;
}

export async function toggleTask(id) {
  const t = taskCache.get(id) || (await loadTasks(), taskCache.get(id));
  if (!t) return;
  let next;
  if (t.status === 'Выполнено') next = 'В процессе';
  else if (t.status === 'На проверке' && !isStaff()) return toast('Задача уже на проверке у тьютора');
  else next = 'Выполнено';
  const r = await api('/api/tasks/' + id, { method: 'PATCH', body: { status: next } });
  toast(r.status === 'На проверке' ? 'Отправлено тьютору на проверку' : r.status === 'Выполнено' ? 'Задача выполнена' : 'Статус обновлён');
  S.refresh();
}

/* ───── форма создания/редактирования ───── */
export async function openTaskForm({ task = null, defaults = {} } = {}) {
  const meta = await loadTasks();
  const staff = isStaff(), personal = task ? task.source === 'personal' : !staff;
  const v = { ...defaults, ...(task || {}) };
  const dirOpts = [['', '— не указано —'], ...[...new Set([...meta.directions, ...(v.direction ? [v.direction] : [])])].map((d) => [d, d])];
  const fields = [
    { name: 'title', label: 'Название', required: true, value: v.title, max: 200 },
    { name: 'description', label: 'Описание', type: 'textarea', value: v.description },
    ...(staff ? [{ name: 'instructions', label: 'Инструкция для ученика', type: 'textarea', value: v.instructions }] : []),
    { name: 'type', label: 'Тип задачи', type: 'select', options: TASK_TYPES, value: v.type || 'Самостоятельная работа', half: true },
    { name: 'direction', label: 'Направление', type: 'select', options: dirOpts, value: v.direction || '', half: true },
    { name: 'priority', label: 'Приоритет', type: 'select', options: PRIORITIES, value: v.priority || 'Обычный', half: true },
    { name: 'due_date', label: 'Срок', type: 'date', value: v.due_date || '', half: true },
    ...(staff || personal ? [
      { name: 'stage_id', label: 'Этап маршрута', type: 'select', options: [['', '— без привязки —'], ...meta.stages.map((s) => [s.id, s.title])], value: v.stage_id || '' },
      { name: 'milestone_id', label: 'Контрольная точка', type: 'select', options: [['', '— без привязки —'], ...meta.milestones.map((m) => [m.id, `${(meta.stages.find((s) => s.id === m.stage_id) || {}).title || ''} → ${m.title}`])], value: v.milestone_id || '' },
      { name: 'goal_id', label: 'Цель', type: 'select', options: [['', '— по этапу —'], ...meta.goals.map((g) => [g.id, g.title])], value: v.goal_id || '' },
    ] : []),
    { name: 'link', label: 'Ссылка на материал', type: 'url', value: v.link || '', placeholder: 'https://', max: 500 },
  ];
  formModal({
    title: task ? 'Редактировать задачу' : staff ? 'Новая задача для ученика' : 'Новая личная задача', fields, wide: true,
    submit: task ? 'Сохранить' : staff ? 'Назначить' : 'Добавить',
    async onSubmit(val, close) {
      ['stage_id', 'milestone_id', 'goal_id'].forEach((k) => { if (k in val) val[k] = val[k] ? Number(val[k]) : null; });
      if (task) await api('/api/tasks/' + task.id, { method: 'PATCH', body: val });
      else await api('/api/tasks', { method: 'POST', body: val });
      close(); toast(task ? 'Задача обновлена' : staff ? 'Задача назначена' : 'Задача добавлена'); S.refresh();
    },
  });
}

/* ───── карточка задачи ───── */
export async function openTask(id) {
  const meta = await loadTasks();
  const t = taskCache.get(id);
  if (!t) return toast('Задача не найдена', true);
  const comments = await api(`/api/tasks/${id}/comments`);
  const staff = isStaff(), personal = t.source === 'personal';
  const canDelete = staff || personal;
  const locked = !staff && !personal && t.status === 'Выполнено';
  const statusOpts = staff || personal ? TASK_STATUSES : TASK_STATUSES.filter((s) => s !== 'Выполнено' || t.status === 'Выполнено');
  const info = [
    t.stage_title && ['Этап', t.stage_title], t.milestone_title && ['Контрольная точка', t.milestone_title], t.goal_title && ['Цель', t.goal_title],
    ['Тип', t.type], t.due_date && ['Срок', fmtDY(t.due_date)], t.completed_at && ['Выполнено', fmtDY(t.completed_at)],
  ].filter(Boolean);
  const body = `
    <div class="meta" style="margin:-6px 0 14px">${t.direction ? `<span class="tag">${esc(t.direction)}</span>` : ''}${prioTag(t.priority)}${statusTag(t.status)}${personal ? '<span class="tag">Личная</span>' : ''}</div>
    ${t.description ? `<p>${nl2(t.description)}</p>` : ''}
    ${t.instructions ? `<div class="note" style="margin-top:12px"><b class="small">Инструкция тьютора</b><br>${nl2(t.instructions)}</div>` : ''}
    ${t.link ? `<p style="margin-top:12px">${linkTag(t.link)}</p>` : ''}
    <div class="grid g2" style="gap:8px 16px;margin:16px 0">${info.map(([a, b]) => `<div><div class="xs muted">${esc(a)}</div><div class="small">${esc(b)}</div></div>`).join('')}</div>
    ${t.tutor_feedback ? `<div class="comment-box" style="margin-bottom:14px"><div class="eyebrow">Обратная связь тьютора</div><p style="margin-top:6px">${nl2(t.tutor_feedback)}</p></div>` : ''}
    <div class="divider"></div>
    ${locked ? '<p class="small muted">Задача принята тьютором и закрыта.</p>' : `
    <div class="field-row"><div class="field"><label>Статус</label><select id="tm-status">${statusOpts.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Затрачено, мин</label><input id="tm-min" type="number" min="0" max="100000" value="${t.minutes_spent || 0}"></div></div>
    ${staff ? `<div class="field"><label>Обратная связь по задаче</label><textarea id="tm-fb" maxlength="1500" placeholder="Что получилось, что доработать">${esc(t.tutor_feedback)}</textarea></div>` : ''}
    <div class="row wrap"><button class="btn primary" id="tm-save">Сохранить</button>
      ${staff && t.status === 'На проверке' ? '<button class="btn" id="tm-accept">Принять</button><button class="btn" id="tm-return">Вернуть на доработку</button>' : ''}
      ${staff || personal ? '<button class="btn ghost" id="tm-edit">' + icon('edit', 15) + ' Изменить</button>' : ''}
      ${canDelete ? '<button class="btn danger ghost" id="tm-del">' + icon('trash', 15) + '</button>' : ''}</div>`}
    <div class="divider"></div>
    <h3 style="margin-bottom:10px">Комментарии <span class="muted">${comments.length || ''}</span></h3>
    <div id="tm-comments">${comments.length ? comments.map((c) => `<div style="padding:8px 0;border-bottom:1px solid var(--color-border)"><div class="xs muted"><b style="color:var(--color-text-primary)">${esc(c.author)}</b> · ${fmtD(c.created_at)}</div><div class="small">${nl2(c.body)}</div></div>`).join('') : '<p class="small muted">Комментариев пока нет.</p>'}</div>
    <form id="tm-cform" class="row" style="margin-top:12px;align-items:flex-start"><textarea name="b" style="min-height:44px;height:44px" maxlength="1500" placeholder="Написать комментарий…" required></textarea><button class="btn" type="submit">Отправить</button></form>`;
  modal({
    title: t.title, body, wide: true,
    onMount(ov, close) {
      const save = async (extra = {}) => {
        const b = { minutes_spent: Number($('#tm-min', ov)?.value || 0), ...extra };
        const st = $('#tm-status', ov)?.value; if (st && !('status' in extra)) b.status = st;
        if (staff) b.tutor_feedback = $('#tm-fb', ov).value;
        try { const r = await api('/api/tasks/' + id, { method: 'PATCH', body: b }); close(); toast(r.status === 'На проверке' && st === 'Выполнено' ? 'Отправлено тьютору на проверку' : 'Сохранено'); S.refresh(); } catch (e) { toast(e.message, true); }
      };
      $('#tm-save', ov) && ($('#tm-save', ov).onclick = () => save());
      $('#tm-accept', ov) && ($('#tm-accept', ov).onclick = () => save({ status: 'Выполнено' }));
      $('#tm-return', ov) && ($('#tm-return', ov).onclick = () => save({ status: 'В процессе' }));
      $('#tm-edit', ov) && ($('#tm-edit', ov).onclick = () => { close(); openTaskForm({ task: t }); });
      $('#tm-del', ov) && ($('#tm-del', ov).onclick = async () => { if (await confirmBox('Удалить задачу «' + t.title + '»?')) { await api('/api/tasks/' + id, { method: 'DELETE' }); close(); toast('Задача удалена'); S.refresh(); } });
      $('#tm-cform', ov).onsubmit = async (e) => {
        e.preventDefault();
        try { await api(`/api/tasks/${id}/comments`, { method: 'POST', body: { body: e.target.b.value } }); close(); openTask(id); } catch (x) { toast(x.message, true); }
      };
    },
  });
}

/* ───── раздел «Задачи» ───── */
const TV = { status: 'active', dir: '', type: '', sort: 'due', mode: 'list', cal: null };
let DATA = null;
const PW = { 'Критический': 4, 'Высокий': 3, 'Обычный': 2, 'Низкий': 1 };
const SO = { 'На проверке': 0, 'В процессе': 1, 'Не начато': 2, 'Отложено': 3, 'Выполнено': 4 };

function filtered() {
  let l = DATA.tasks.filter((t) => (TV.status === 'all' ? true : TV.status === 'active' ? !['Выполнено', 'Отложено'].includes(t.status) : TV.status === 'overdue' ? t.status !== 'Выполнено' && t.due_date && t.due_date < DATA.today : t.status === TV.status)
    && (!TV.dir || t.direction === TV.dir) && (!TV.type || t.type === TV.type));
  const cmp = {
    due: (a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'),
    prio: (a, b) => PW[b.priority] - PW[a.priority] || (a.due_date || '9').localeCompare(b.due_date || '9'),
    status: (a, b) => SO[a.status] - SO[b.status] || (a.due_date || '9').localeCompare(b.due_date || '9'),
  }[TV.sort];
  return l.sort(cmp);
}
function chip(v, label, n) { return `<button class="chip ${TV.status === v ? 'on' : ''}" data-act="tf-status" data-v="${v}">${label}${n != null ? ` <span style="opacity:.7">${n}</span>` : ''}</button>`; }

function calHtml(list) {
  const [y, m] = TV.cal.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = (first.getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  const title = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const by = {}; list.forEach((t) => { if (t.due_date) (by[t.due_date] ||= []).push(t); });
  let cells = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => `<div class="h">${d}</div>`).join('');
  for (let i = 0; i < Math.ceil((start + days) / 7) * 7; i++) {
    const dn = i - start + 1, inM = dn >= 1 && dn <= days;
    const ds = inM ? `${y}-${String(m).padStart(2, '0')}-${String(dn).padStart(2, '0')}` : null;
    const items = ds ? by[ds] || [] : [];
    cells += `<div class="d ${inM ? '' : 'out'} ${ds === DATA.today ? 'today' : ''}"><b>${inM ? dn : ''}</b>${items.slice(0, 3).map((t) => `<button class="it ${t.status === 'Выполнено' ? 'done' : t.due_date < DATA.today ? 'late' : ''}" data-act="task-open" data-id="${t.id}" title="${esc(t.title)}">${esc(t.title)}</button>`).join('')}${items.length > 3 ? `<span class="xs muted">+${items.length - 3} ещё</span>` : ''}</div>`;
  }
  return `<div class="row sb" style="margin-bottom:12px"><button class="icon-btn" data-act="cal-prev" aria-label="Предыдущий месяц">${icon('back', 18)}</button><h3 style="text-transform:capitalize">${title}</h3><button class="icon-btn" data-act="cal-next" aria-label="Следующий месяц" style="transform:scaleX(-1)">${icon('back', 18)}</button></div><div class="cal">${cells}</div>`;
}
function inner() {
  const all = DATA.tasks, list = filtered();
  const cnt = (f) => all.filter(f).length;
  const dirs = [...new Set([...DATA.directions, ...all.map((t) => t.direction).filter(Boolean)])];
  const body = TV.mode === 'cal' ? calHtml(list)
    : list.length ? list.map((t) => taskRow(t, DATA.today, { stage: true })).join('') : empty('Нет задач по выбранным условиям', 'tasks');
  return `<div class="toolbar"><div class="chips">
      ${chip('active', 'Активные', cnt((t) => !['Выполнено', 'Отложено'].includes(t.status)))}${chip('Не начато', 'Не начато', cnt((t) => t.status === 'Не начато'))}${chip('В процессе', 'В процессе', cnt((t) => t.status === 'В процессе'))}${chip('На проверке', 'На проверке', cnt((t) => t.status === 'На проверке'))}${chip('Выполнено', 'Выполнено', cnt((t) => t.status === 'Выполнено'))}${chip('Отложено', 'Отложено', cnt((t) => t.status === 'Отложено'))}${chip('overdue', 'Просроченные', cnt((t) => t.status !== 'Выполнено' && t.due_date && t.due_date < DATA.today))}${chip('all', 'Все', all.length)}</div></div>
    <div class="toolbar">
      <select data-chg="tf-dir" aria-label="Направление"><option value="">Все направления</option>${dirs.map((d) => `<option ${TV.dir === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
      <select data-chg="tf-type" aria-label="Тип"><option value="">Все типы</option>${TASK_TYPES.map((d) => `<option ${TV.type === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <select data-chg="tf-sort" aria-label="Сортировка"><option value="due" ${TV.sort === 'due' ? 'selected' : ''}>По сроку</option><option value="prio" ${TV.sort === 'prio' ? 'selected' : ''}>По приоритету</option><option value="status" ${TV.sort === 'status' ? 'selected' : ''}>По статусу</option></select>
      <div class="seg" style="margin-left:auto"><button class="${TV.mode === 'list' ? 'on' : ''}" data-act="tf-mode" data-v="list">Список</button><button class="${TV.mode === 'cal' ? 'on' : ''}" data-act="tf-mode" data-v="cal">Календарь</button></div></div>
    <div class="panel" style="padding:${TV.mode === 'cal' ? 18 : 8}px 18px">${body}</div>`;
}
function paint() { const r = $('#tasks-root'); if (r) { r.innerHTML = inner(); postRender(r); } }

export async function view() {
  DATA = await loadTasks();
  if (!TV.cal) TV.cal = DATA.today.slice(0, 7);
  const staff = isStaff();
  return `<div class="page-head"><div><div class="eyebrow">Менеджер задач</div><h1>Задачи</h1><p class="muted">Учебные задачи, связанные с этапами маршрута и целями.</p></div>
    <div class="actions"><button class="btn primary" data-act="task-add">${icon('plus', 16)} ${staff ? 'Назначить задачу' : 'Личная задача'}</button></div></div>
    <div id="tasks-root">${inner()}</div>`;
}

export const acts = {
  'task-open': (el) => openTask(+el.dataset.id),
  'task-toggle': (el) => toggleTask(+el.dataset.id),
  'task-add': () => openTaskForm(),
  'tf-status': (el) => { TV.status = el.dataset.v; paint(); },
  'tf-mode': (el) => { TV.mode = el.dataset.v; paint(); },
  'tf-dir': (el) => { TV.dir = el.value; paint(); },
  'tf-type': (el) => { TV.type = el.value; paint(); },
  'tf-sort': (el) => { TV.sort = el.value; paint(); },
  'cal-prev': () => { const [y, m] = TV.cal.split('-').map(Number); const d = new Date(y, m - 2, 1); TV.cal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; paint(); },
  'cal-next': () => { const [y, m] = TV.cal.split('-').map(Number); const d = new Date(y, m, 1); TV.cal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; paint(); },
};
