import { S, api, esc, isStaff, href, icon, toast, formModal, confirmBox, bar, empty, nl2, fmtDY, dayDiff, plural, prioTag, PRIORITIES, GOAL_CATS } from './lib.js';

let GOALS = [];
const today = () => new Date().toLocaleDateString('sv-SE');

function goalHtml(g) {
  const staff = isStaff();
  const mine = g.created_by === S.me.id;
  const canEdit = staff || mine;
  const left = g.target_date ? dayDiff(g.target_date, today()) : null;
  const st = g.status === 'Достигнута' ? 'ok' : g.status === 'Активна' ? 'accent' : '';
  return `<section class="panel goal reveal ${g.status !== 'Активна' ? '' : ''}">
    <div class="row sb" style="align-items:flex-start;gap:14px"><div style="min-width:0"><div class="meta" style="margin:0 0 8px"><span class="tag accent">${esc(g.category)}</span>${prioTag(g.priority)}<span class="tag ${st}">${esc(g.status)}</span></div><h2>${esc(g.title)}</h2></div>
      ${canEdit ? `<div class="row" style="gap:2px;flex:none"><button class="icon-btn" data-act="goal-edit" data-id="${g.id}" aria-label="Изменить">${icon('edit', 17)}</button><button class="icon-btn" data-act="goal-del" data-id="${g.id}" aria-label="Удалить">${icon('trash', 17)}</button></div>` : ''}</div>
    ${g.description ? `<p class="muted small">${nl2(g.description)}</p>` : ''}
    <div><div class="row sb small" style="margin-bottom:7px"><span class="muted">Прогресс · ${g.tasksDone}/${g.tasksTotal} ${plural(g.tasksTotal, 'задача', 'задачи', 'задач')}</span><b>${g.pct}%</b></div>${bar(g.pct)}</div>
    <div class="row wrap small muted" style="gap:6px 20px"><span>Поставлена: ${fmtDY(g.set_date)}</span><span>План: ${fmtDY(g.target_date)}${left != null && g.status === 'Активна' ? ` · <span style="color:${left < 0 ? '#efb27a' : 'inherit'}">${left < 0 ? 'просрочено на ' + -left : 'осталось ' + left} дн.</span>` : ''}</span></div>
    ${g.criteria.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Измеримые критерии достижения</div>${g.criteria.map((c, i) => `<div class="crit"><button class="check ${c.done ? 'on' : ''}" data-act="crit-toggle" data-id="${g.id}" data-i="${i}" aria-label="Отметить критерий">${icon('check', 11)}</button><span class="${c.done ? 'muted' : ''}">${esc(c.text)}</span></div>`).join('')}</div>` : ''}
    <div>${g.stageList.length ? `<div class="eyebrow" style="margin-bottom:6px">Связанные этапы маршрута</div><div class="chips">${g.stageList.map((s) => `<a class="tag" href="${href('route')}">${esc(s.title)}</a>`).join('')}</div>` : '<span class="xs muted">Нет связанных этапов — привяжите цель к этапу маршрута, и прогресс будет считаться по задачам.</span>'}</div>
    ${g.tutor_comment ? `<div class="note"><b class="small">Комментарий тьютора</b><br>${nl2(g.tutor_comment)}</div>` : ''}
    ${staff ? `<div><button class="link-btn" data-act="goal-comment" data-id="${g.id}">${g.tutor_comment ? 'Изменить комментарий' : 'Добавить комментарий'}</button></div>` : ''}
  </section>`;
}

export async function view() {
  const d = await api('/api/goals'); GOALS = d.goals;
  const act = GOALS.filter((g) => g.status === 'Активна'), rest = GOALS.filter((g) => g.status !== 'Активна');
  return `<div class="page-head"><div><div class="eyebrow">Долгосрочные цели</div><h1>Мои цели</h1><p class="muted">Каждая цель связана с этапами маршрута и конкретными задачами.</p></div>
    <div class="actions"><button class="btn primary" data-act="goal-add">${icon('plus', 16)} Новая цель</button></div></div>
    ${act.length ? `<div class="grid g2">${act.map(goalHtml).join('')}</div>` : `<section class="panel">${empty('Активных целей пока нет', 'goal')}</section>`}
    ${rest.length ? `<h2 style="margin:34px 0 14px">Достигнутые и приостановленные</h2><div class="grid g2">${rest.map(goalHtml).join('')}</div>` : ''}`;
}

function fields(g = null) {
  return [
    { name: 'title', label: 'Название цели', required: true, value: g?.title },
    { name: 'description', label: 'Подробное описание', type: 'textarea', value: g?.description },
    { name: 'category', label: 'Категория', type: 'select', options: GOAL_CATS, value: g?.category || GOAL_CATS[0], half: true },
    { name: 'priority', label: 'Приоритет', type: 'select', options: PRIORITIES, value: g?.priority || 'Обычный', half: true },
    { name: 'target_date', label: 'Планируемая дата достижения', type: 'date', value: g?.target_date || '', half: true },
    ...(g ? [{ name: 'status', label: 'Статус', type: 'select', options: ['Активна', 'Достигнута', 'На паузе', 'Отменена'], value: g.status, half: true }] : [{ name: 'set_date', label: 'Дата постановки', type: 'date', value: today(), half: true }]),
    { name: 'criteria', label: 'Измеримые критерии (по одному на строку)', type: 'textarea', value: g ? g.criteria.map((c) => c.text).join('\n') : '', placeholder: 'Например: IELTS Academic не ниже 7.0', max: 2500 },
  ];
}
function parseCriteria(text, old = []) {
  return String(text).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20).map((t) => ({ text: t, done: !!old.find((o) => o.text === t && o.done) }));
}

export const acts = {
  'goal-add': () => formModal({ title: 'Новая цель', fields: fields(), submit: 'Создать', wide: true,
    async onSubmit(v, close) { v.criteria = parseCriteria(v.criteria); await api('/api/goals', { method: 'POST', body: v }); close(); toast('Цель добавлена'); S.refresh(); } }),
  'goal-edit': (el) => { const g = GOALS.find((x) => x.id === +el.dataset.id);
    formModal({ title: 'Изменить цель', fields: fields(g), wide: true,
      async onSubmit(v, close) { v.criteria = parseCriteria(v.criteria, g.criteria); await api('/api/goals/' + g.id, { method: 'PATCH', body: v }); close(); toast('Цель обновлена'); S.refresh(); } }); },
  'goal-del': async (el) => { const g = GOALS.find((x) => x.id === +el.dataset.id);
    if (await confirmBox(`Удалить цель «${g.title}»?`)) { try { await api('/api/goals/' + g.id, { method: 'DELETE' }); toast('Цель удалена'); S.refresh(); } catch (e) { toast(e.message, true); } } },
  'crit-toggle': async (el) => { const g = GOALS.find((x) => x.id === +el.dataset.id); const c = g.criteria.map((x, i) => (i === +el.dataset.i ? { ...x, done: !x.done } : x));
    await api('/api/goals/' + g.id, { method: 'PATCH', body: { criteria: c } }); S.refresh(); },
  'goal-comment': (el) => { const g = GOALS.find((x) => x.id === +el.dataset.id);
    formModal({ title: 'Комментарий к цели', fields: [{ name: 'tutor_comment', label: 'Комментарий тьютора', type: 'textarea', value: g.tutor_comment, max: 1500 }],
      async onSubmit(v, close) { await api('/api/goals/' + g.id, { method: 'PATCH', body: v }); close(); toast('Сохранено'); S.refresh(); } }); },
};
