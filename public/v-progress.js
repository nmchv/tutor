import { $, S, api, esc, isStaff, href, icon, toast, formModal, confirmBox, bar, empty, nl2, fmtD, fmtDY, ago, plural, barChart, lineChart, TASK_TYPES } from './lib.js';

const today = () => new Date().toLocaleDateString('sv-SE');
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}` : `${m} мин`);
const MONTH = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const REC = { test: 'Тест', project: 'Проект', achievement: 'Достижение', event: 'Событие' };
const HK = { task_done: 'Задача', milestone: 'Этап', goal: 'Цель', tutor_comment: 'Комментарий', route: 'Маршрут', resource: 'Материал', reflection: 'Рефлексия', record: 'Результат', task: 'Задача', start: 'Старт' };

let HIST = [];
export async function view() {
  const [a, hist] = await Promise.all([api('/api/analytics'), api('/api/history')]);
  HIST = hist;
  const weeks = a.weeks.map((w) => ({ label: fmtD(w.from).replace(/\s?(янв\.|февр\.|марта|апр\.|мая|июня|июля|авг\.|сент\.|окт\.|нояб\.|дек\.)/, ''), value: w.done, plan: w.planned }));
  const wlab = a.weeks.map((w) => { const d = new Date(w.from + 'T00:00:00'); return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`; });
  weeks.forEach((w, i) => (w.label = wlab[i]));
  const dyn = a.weeks.map((w, i) => ({ label: wlab[i], value: w.progress }));
  const months = a.months.map((m) => ({ label: MONTH[+m.key.slice(5) - 1], value: m.done }));
  const to = today(); const fromD = new Date(); fromD.setDate(fromD.getDate() - 30); const from = fromD.toLocaleDateString('sv-SE');

  return `<div class="page-head"><div><div class="eyebrow">Аналитика</div><h1>Прогресс</h1><p class="muted">Объективная картина развития: не только количество заданий, но и динамика, цели и сроки.</p></div></div>
  <section class="panel reveal"><div class="stats">
    <div class="stat"><b>${a.overall}%</b><span class="small muted">общий прогресс маршрута</span></div>
    <div class="stat"><b>${a.doneStages}<span class="muted" style="font-size:1rem"> / ${a.totalStages}</span></b><span class="small muted">этапов завершено</span></div>
    <div class="stat"><b>${a.tasksDone}<span class="muted" style="font-size:1rem"> / ${a.tasksTotal}</span></b><span class="small muted">задач выполнено</span></div>
    <div class="stat"><b>${a.minutes ? hm(a.minutes) : '—'}</b><span class="small muted">время на обучение${a.onTimePct != null ? ` · в срок ${a.onTimePct}%` : ''}</span></div></div></section>
  <div class="grid g2" style="margin-top:18px">
    <section class="panel reveal"><div class="panel-title"><h2>Выполнение задач по неделям</h2><span class="xs muted">факт и план</span></div>${barChart(weeks, { plan: true })}
      <div class="legend" style="margin-top:8px"><span><i style="background:#2b3446"></i>запланировано к сроку</span><span><i style="background:var(--color-accent)"></i>выполнено</span></div></section>
    <section class="panel reveal"><div class="panel-title"><h2>Динамика общего прогресса</h2><span class="xs muted">по неделям</span></div>${lineChart(dyn)}</section>
    <section class="panel reveal"><div class="panel-title"><h2>Выполнено по месяцам</h2></div>${barChart(months, { w: 560, h: 170 })}</section>
    <section class="panel reveal"><div class="panel-title"><h2>Прогресс по направлениям</h2></div>
      ${a.directions.length ? a.directions.map((d) => `<div style="margin-bottom:16px"><div class="row sb small" style="margin-bottom:6px"><span>${esc(d.name)} <span class="muted">· ${d.done}/${d.total}${d.minutes ? ' · ' + hm(d.minutes) : ''}</span></span><b>${d.pct}%</b></div>${bar(d.pct)}</div>`).join('') : empty('Направления не заданы')}</section></div>
  <section class="panel reveal" style="margin-top:18px"><div class="panel-title"><h2>Достижение целей</h2><a href="${href('goals')}" class="small">Все цели →</a></div>
    ${a.goals.length ? `<div class="grid g2" style="gap:14px 28px">${a.goals.map((g) => `<div><div class="row sb small" style="margin-bottom:6px"><span>${esc(g.title)}</span><b>${g.pct}%</b></div>${bar(g.pct)}<div class="xs muted" style="margin-top:4px">${esc(g.category)}${g.target_date ? ' · до ' + fmtDY(g.target_date) : ''}</div></div>`).join('')}</div>` : empty('Целей пока нет')}</section>
  <section class="panel reveal" style="margin-top:18px"><div class="panel-title"><h2>Планируемые и фактические сроки этапов</h2></div><div class="scroll-x"><table class="table"><thead><tr><th>Этап</th><th class="hide-s">План</th><th class="hide-s">Факт</th><th>Отклонение</th><th>Готово</th></tr></thead><tbody>
    ${a.plan.map((p) => `<tr><td>${esc(p.title)}</td><td class="hide-s">${fmtD(p.start)} — ${fmtD(p.planned_end)}</td><td class="hide-s">${p.actual_end ? fmtD(p.actual_end) : '—'}</td>
      <td>${p.delta == null ? (p.status === 'overdue' ? '<span class="tag warn">просрочен</span>' : '<span class="muted">—</span>') : p.delta <= 0 ? `<span class="tag ok">${p.delta === 0 ? 'в срок' : `раньше на ${-p.delta} дн.`}</span>` : `<span class="tag warn">позже на ${p.delta} дн.</span>`}</td><td style="min-width:90px">${p.pct}%</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Нет этапов</td></tr>'}</tbody></table></div></section>

  <div class="grid g2" style="margin-top:18px">
    <section class="panel reveal"><div class="panel-title"><h2>Результаты и достижения</h2><button class="link-btn" data-act="rec-add">+ добавить</button></div>
      ${a.records.length ? a.records.map((r) => `<div class="ev" style="align-items:flex-start"><div style="flex:1"><div class="row sb" style="gap:8px"><b class="small" style="font-weight:600">${esc(r.title)}</b>${r.value ? `<span class="tag ok">${esc(r.value)}</span>` : ''}</div>
        <div class="meta" style="margin-top:4px"><span class="tag">${REC[r.kind] || r.kind}</span>${r.direction ? `<span class="due">${esc(r.direction)}</span>` : ''}<span class="due">${fmtDY(r.recorded_at)}</span>${r.source !== 'manual' ? `<span class="tag accent">${esc(r.source)}</span>` : ''}</div>${r.note ? `<div class="small muted" style="margin-top:4px">${esc(r.note)}</div>` : ''}</div>
        <button class="icon-btn" style="width:30px;height:30px" data-act="rec-del" data-id="${r.id}" aria-label="Удалить">${icon('trash', 14)}</button></div>`).join('') : empty('Здесь появятся результаты тестов, проекты и достижения', 'chart')}</section>
    <section class="panel reveal"><div class="panel-title"><h2>Отчёт за период</h2></div>
      <p class="small muted" style="margin-bottom:14px">Сводка по выполненным задачам, завершённым этапам, результатам и комментариям тьютора за выбранные даты. Её можно распечатать или сохранить в PDF.</p>
      <form id="rep-form"><div class="field-row"><div class="field"><label>С</label><input type="date" name="from" value="${from}" required></div><div class="field"><label>По</label><input type="date" name="to" value="${to}" required></div></div>
      <button class="btn primary" type="submit">${icon('file', 16)} Сформировать отчёт</button></form></section></div>

  <section class="panel reveal" style="margin-top:18px"><div class="panel-title"><h2>История развития</h2><span class="xs muted">${hist.length} записей</span></div>
    <div class="toolbar"><div class="chips">${['all', 'task_done', 'milestone', 'goal', 'tutor_comment', 'route', 'record'].map((k, i) => `<button class="chip ${i ? '' : 'on'}" data-act="hist-f" data-v="${k}">${k === 'all' ? 'Всё' : HK[k]}</button>`).join('')}</div></div>
    <div id="hist-list">${histHtml('all')}</div></section>`;
}

function histHtml(kind) {
  const l = HIST.filter((h) => kind === 'all' || h.kind === kind || (kind === 'task_done' && h.kind === 'task_done'));
  if (!l.length) return empty('Записей нет');
  let last = '';
  return `<div class="feed">${l.slice(0, 80).map((h) => { const m = h.created_at.slice(0, 7); const head = m !== last ? `<div class="eyebrow" style="margin:14px 0 4px">${new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</div>` : ''; last = m;
    return `${head}<div class="feed-item"><div class="small">${esc(h.text.length > 220 ? h.text.slice(0, 220) + '…' : h.text)}</div><div class="xs muted">${HK[h.kind] || ''} · ${fmtDY(h.created_at)}${h.actor && h.kind === 'tutor_comment' ? ' · ' + esc(h.actor) : ''}</div></div>`; }).join('')}</div>`;
}

export function mount() {
  const f = $('#rep-form');
  if (f) f.onsubmit = (e) => { e.preventDefault(); location.hash = `${href('report').slice(1)}?from=${f.from.value}&to=${f.to.value}`; };
}

export const acts = {
  'hist-f': (el) => { el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el)); $('#hist-list').innerHTML = histHtml(el.dataset.v); },
  'rec-add': () => formModal({
    title: 'Зафиксировать результат', submit: 'Сохранить',
    fields: [
      { name: 'kind', label: 'Тип', type: 'select', options: [['test', 'Результат теста'], ['project', 'Выполненный проект'], ['achievement', 'Достижение'], ['event', 'Важное событие']], value: 'test', half: true },
      { name: 'recorded_at', label: 'Дата', type: 'date', value: today(), required: true, half: true },
      { name: 'title', label: 'Название', required: true },
      { name: 'value', label: 'Результат (балл, оценка)', max: 60 },
      { name: 'direction', label: 'Направление', max: 80 },
      { name: 'note', label: 'Заметка', type: 'textarea', max: 1000 },
    ],
    async onSubmit(v, close) { await api('/api/records', { method: 'POST', body: v }); close(); toast('Записано'); S.refresh(); },
  }),
  'rec-del': async (el) => { if (await confirmBox('Удалить запись?')) { await api('/api/records/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); } },
};

/* ───── отчёт за период ───── */
export async function reportView(params) {
  const from = params.get('from'), to = params.get('to');
  if (!from || !to) return `<section class="panel">${empty('Выберите период в разделе «Прогресс»', 'file')}</section>`;
  const r = await api(`/api/report?from=${from}&to=${to}`);
  return `<div class="page-head no-print"><div><a href="${href('progress')}" class="small">← К прогрессу</a><h1 style="margin-top:8px">Отчёт за период</h1></div><div class="actions"><button class="btn primary" data-act="print">${icon('print', 16)} Печать / PDF</button></div></div>
  <section class="panel report"><div class="eyebrow">NMCHV Student · отчёт о развитии</div><h1 style="margin:6px 0 4px">${esc(r.student.name)}</h1>
    <div class="muted">${fmtDY(r.from)} — ${fmtDY(r.to)}</div>${r.student.main_goal ? `<div style="margin-top:6px">Цель: ${esc(r.student.main_goal)}</div>` : ''}
    <div class="stats" style="margin-top:20px"><div class="stat"><b>${r.progressStart}% → ${r.progressEnd}%</b><span class="small muted">прогресс маршрута</span></div><div class="stat"><b>${r.tasks.length}</b><span class="small muted">выполнено задач</span></div><div class="stat"><b>${r.stagesCompleted.length}</b><span class="small muted">завершено этапов</span></div><div class="stat"><b>${r.minutes ? hm(r.minutes) : '—'}</b><span class="small muted">время обучения</span></div></div>
    ${r.stagesCompleted.length ? `<h2>Завершённые этапы</h2><ul>${r.stagesCompleted.map((s) => `<li>${esc(s.title)} — ${fmtDY(s.date)}</li>`).join('')}</ul>` : ''}
    ${r.goalsAchieved.length ? `<h2>Достигнутые цели</h2><ul>${r.goalsAchieved.map((g) => `<li>${esc(g.text.replace('Цель достигнута: ', ''))} — ${fmtDY(g.created_at)}</li>`).join('')}</ul>` : ''}
    <h2>Выполненные задачи</h2>${r.tasks.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Дата</th><th>Задача</th><th>Направление</th><th>Время</th></tr></thead><tbody>${r.tasks.sort((a, b) => a.date.localeCompare(b.date)).map((t) => `<tr><td>${fmtD(t.date)}</td><td>${esc(t.title)}${t.stage ? `<div class="xs muted">${esc(t.stage)}</div>` : ''}</td><td>${esc(t.direction)}</td><td>${t.minutes ? hm(t.minutes) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">За период задач не выполнено.</p>'}
    ${r.records.length ? `<h2>Результаты и достижения</h2><ul>${r.records.map((x) => `<li>${fmtDY(x.recorded_at)} — ${esc(x.title)}${x.value ? ': <b>' + esc(x.value) + '</b>' : ''}${x.note ? ' (' + esc(x.note) + ')' : ''}</li>`).join('')}</ul>` : ''}
    ${r.routeChanges.length ? `<h2>Изменения маршрута</h2><ul>${r.routeChanges.map((x) => `<li>${fmtDY(x.created_at)} — ${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${r.comments.length ? `<h2>Комментарии тьютора</h2>${r.comments.map((x) => `<div class="note" style="margin-bottom:8px"><div class="xs muted">${fmtDY(x.created_at)}</div>${nl2(x.text)}</div>`).join('')}` : ''}</section>`;
}
acts.print = () => window.print();

/* ───── рефлексия ───── */
export const BASE_Q = ['Что нового я узнал?', 'Что получилось лучше всего?', 'С какими трудностями столкнулся?', 'Что оказалось наиболее полезным?', 'Какие вопросы остались?', 'Что я хочу изменить в своём подходе к обучению?', 'Насколько я приблизился к своей цели?'];
let REFL = null;
export async function reflectionView() {
  REFL = await api('/api/reflections');
  const staff = isStaff();
  const entries = REFL.items.length ? REFL.items.map((r) => `<article class="panel reveal" style="margin-bottom:14px"><div class="row sb" style="margin-bottom:12px"><div class="row" style="gap:8px"><b>${fmtDY(r.created_at)}</b>${r.is_private ? '<span class="tag">🔒 Личная</span>' : ''}</div>
      ${!staff ? `<div class="row" style="gap:2px"><button class="icon-btn" data-act="refl-priv" data-id="${r.id}" data-v="${r.is_private ? 0 : 1}" title="${r.is_private ? 'Сделать видимой тьютору' : 'Скрыть от тьютора'}">${icon('shield', 17)}</button><button class="icon-btn" data-act="refl-del" data-id="${r.id}" aria-label="Удалить">${icon('trash', 17)}</button></div>` : ''}</div>
      ${Object.entries(r.answers).map(([q, a]) => `<div style="margin-bottom:12px"><div class="eyebrow">${esc(q)}</div><p style="margin-top:3px">${nl2(a)}</p></div>`).join('')}</article>`).join('')
    : `<section class="panel">${empty(staff ? 'Ученик ещё не делился записями рефлексии (личные записи скрыты).' : 'Записей пока нет. Начните с первой — это займёт пять минут.', 'msg')}</section>`;
  const form = !staff ? `<section class="panel reveal" style="margin-bottom:22px"><div class="panel-title"><h2>Новая запись</h2></div><p class="small muted" style="margin:-8px 0 14px">Ответьте на те вопросы, которые сейчас важны. Заполнять все необязательно.</p>
      <form id="refl-form">${[...REFL.questions.map((q) => q.text), ...BASE_Q].map((q, i) => `<div class="field"><label for="rq${i}">${esc(q)}${i < REFL.questions.length ? ' <span class="tag accent">от тьютора</span>' : ''}</label><textarea id="rq${i}" data-q="${esc(q)}" maxlength="3000" style="min-height:64px"></textarea></div>`).join('')}
      <label class="row" style="gap:8px;margin-bottom:14px;cursor:pointer"><input type="checkbox" name="priv"> <span class="small">Личная запись — видна только мне</span></label><button class="btn primary" type="submit">Сохранить запись</button></form></section>` : '';
  const qs = staff ? `<section class="panel reveal" style="margin-bottom:22px"><div class="panel-title"><h2>Вопросы для рефлексии</h2><button class="link-btn" data-act="rq-add">+ вопрос</button></div>
    ${REFL.questions.length ? REFL.questions.map((q) => `<div class="row sb" style="padding:7px 0;border-bottom:1px solid var(--color-border)"><span class="small">${esc(q.text)}</span><button class="icon-btn" style="width:30px;height:30px" data-act="rq-del" data-id="${q.id}" aria-label="Удалить">${icon('trash', 14)}</button></div>`).join('') : '<p class="small muted">Вы можете предложить ученику собственный вопрос — он появится в его форме рефлексии.</p>'}</section>` : '';
  return `<div class="page-head"><div><div class="eyebrow">Осмысление процесса</div><h1>Рефлексия</h1><p class="muted">Образовательный дневник: что получилось, что мешало, что менять.</p></div></div>${qs}${form}${entries}`;
}
export function reflectionMount() {
  const f = $('#refl-form'); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const answers = {}; f.querySelectorAll('textarea[data-q]').forEach((t) => { if (t.value.trim()) answers[t.dataset.q] = t.value; });
    try { await api('/api/reflections', { method: 'POST', body: { answers, is_private: f.priv.checked } }); toast('Запись сохранена'); S.refresh(); } catch (x) { toast(x.message, true); }
  };
}
Object.assign(acts, {
  'refl-priv': async (el) => { await api('/api/reflections/' + el.dataset.id, { method: 'PATCH', body: { is_private: el.dataset.v === '1' } }); S.refresh(); },
  'refl-del': async (el) => { if (await confirmBox('Удалить запись рефлексии?')) { await api('/api/reflections/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); } },
  'rq-add': () => formModal({ title: 'Вопрос для рефлексии', submit: 'Добавить', fields: [{ name: 'text', label: 'Вопрос ученику', required: true, max: 300 }],
    async onSubmit(v, close) { await api('/api/reflection-questions', { method: 'POST', body: v }); close(); toast('Вопрос добавлен'); S.refresh(); } }),
  'rq-del': async (el) => { await api('/api/reflection-questions/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); },
});
