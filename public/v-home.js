import { $, S, api, esc, isStaff, href, icon, toast, formModal, ring, bar, empty, nl2, fmtD, fmtT, fmtDY, ago, longToday, plural, nowHour } from './lib.js';
import { taskRow, openTaskForm } from './v-tasks.js';

const KIND = { session: ['Занятие', 'accent'], checkpoint: ['Контрольная точка', ''], deadline: ['Дедлайн', 'warn'], event: ['Событие', ''] };

const heroArt = `<svg class="hero-art" viewBox="0 0 520 300" fill="none" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
<defs><linearGradient id="hg" x1="0" x2="1"><stop offset="0" stop-color="#5b8def" stop-opacity="0"/><stop offset="1" stop-color="#5b8def" stop-opacity=".85"/></linearGradient>
<radialGradient id="hn"><stop offset="0" stop-color="#5b8def" stop-opacity=".5"/><stop offset="1" stop-color="#5b8def" stop-opacity="0"/></radialGradient></defs>
<g stroke="#1b2029" stroke-width="1"><path d="M60 0v300M160 0v300M260 0v300M360 0v300M460 0v300"/><path d="M0 60h520M0 140h520M0 220h520"/></g>
<path d="M0 262 C90 262 110 200 190 196 S300 140 340 118 S430 70 520 44" stroke="url(#hg)" stroke-width="1.8"/>
<path d="M0 282 C100 282 130 228 210 224 S320 170 372 150 S464 108 520 92" stroke="#2a303c" stroke-width="1"/>
<circle cx="190" cy="196" r="5" fill="#5b8def"/><circle cx="340" cy="118" r="5" fill="#5b8def"/>
<circle cx="440" cy="76" r="22" fill="url(#hn)"/><circle cx="440" cy="76" r="6" fill="#0d1424" stroke="#a5c4ff" stroke-width="2"/>
<circle cx="500" cy="48" r="4" fill="none" stroke="#3a4252" stroke-width="1.5"/></svg>`;

export async function view() {
  const d = await api('/api/dashboard');
  const p = d.profile, staff = isStaff();
  const h = nowHour();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const first = (p.full_name || '').split(' ')[0];
  const mg = d.mainGoal;
  const hero = `<section class="hero reveal">${heroArt}
    <div class="eyebrow">${esc(longToday())}</div>
    <h1>${staff ? esc(p.full_name) : `${hello}, ${esc(first)}`}</h1>
    ${staff ? '<div class="muted">Кабинет ученика</div>' : ''}
    ${p.motivation ? `<div class="quote">${esc(p.motivation)}</div>` : ''}
    <div class="hero-meta">
      <div><div class="eyebrow">${staff ? 'Образовательная цель' : 'Твоя образовательная цель'}</div><strong>${esc(p.main_goal || 'Цель пока не задана')}</strong></div>
      <div><div class="eyebrow">Текущий этап</div><strong>${d.current ? `${esc(d.current.title)} <span class="muted" style="font-weight:500">· ${d.current.pct}%</span>` : d.totalStages ? 'Все этапы завершены' : 'Маршрут ещё не составлен'}</strong></div>
    </div></section>`;

  const progress = `<section class="panel reveal"><div class="panel-title"><h2>Общий прогресс</h2><a href="${href('progress')}" class="small">Аналитика →</a></div>
    <div class="row wrap" style="gap:28px;align-items:center">${ring(d.overall, 150)}
      <div style="flex:1;min-width:240px" class="stack"><div class="stats" style="grid-template-columns:repeat(2,1fr);gap:16px">
        <div class="stat"><b>${d.doneStages}<span class="muted" style="font-size:1rem"> / ${d.totalStages}</span></b><span class="small muted">завершено этапов</span></div>
        <div class="stat"><b>${d.tasksDone}<span class="muted" style="font-size:1rem"> / ${d.tasksTotal}</span></b><span class="small muted">выполнено задач</span></div>
        <div class="stat"><b>${d.activeGoals}</b><span class="small muted">${plural(d.activeGoals, 'активная цель', 'активные цели', 'активных целей')}</span></div>
        <div class="stat"><b>${d.days}</b><span class="small muted">${plural(d.days, 'день', 'дня', 'дней')} с начала работы</span></div></div>
        ${mg ? `<div><div class="row sb small" style="margin-bottom:6px"><span class="muted">Главная цель: <span style="color:var(--color-text-primary)">${esc(mg.title)}</span></span><b>${mg.pct}%</b></div>${bar(mg.pct)}</div>` : ''}
      </div></div>
    <p class="xs muted" style="margin-top:14px">Процент считается по весу выполненных задач (с учётом приоритета) и этапов маршрута, а не задаётся вручную.</p></section>`;

  const tasks = `<section class="panel reveal"><div class="panel-title"><h2>Ближайшие задачи</h2><a href="${href('tasks')}" class="small">Все задачи →</a></div>
    ${d.overdue ? `<p class="small" style="color:#efb27a;margin:-6px 0 8px">Просрочено задач: ${d.overdue}</p>` : ''}
    ${d.tasks.length ? d.tasks.map((t) => taskRow(t, d.today, { stage: false })).join('') : empty('Активных задач нет', 'tasks')}</section>`;

  const lastC = d.comment;
  const commentPanel = `<section class="panel reveal"><div class="panel-title"><h2>Комментарий тьютора</h2></div>
    ${lastC ? `<div class="comment-box"><p>${nl2(lastC.text)}</p><div class="xs muted" style="margin-top:10px">${esc(lastC.actor || 'Тьютор')} · ${ago(lastC.created_at)}</div></div>` : '<p class="muted small">Комментариев пока нет.</p>'}
    ${staff ? `<form id="fb-form" style="margin-top:14px"><div class="field"><label>Новый комментарий ученику</label><textarea name="text" maxlength="2000" required placeholder="Что получилось, над чем поработать дальше"></textarea></div><button class="btn primary sm" type="submit">Отправить</button></form>` : ''}</section>`;

  const evs = `<section class="panel reveal"><div class="panel-title"><h2>Ближайшие события</h2>${staff ? `<button class="link-btn" data-act="ev-add">+ событие</button>` : ''}</div>
    ${d.upcoming.length ? d.upcoming.map((e) => { const [lbl, cls] = KIND[e.kind] || KIND.event; const dt = new Date(e.at.slice(0, 10) + 'T00:00:00');
      return `<div class="ev"><div class="ev-date"><b>${dt.getDate()}</b><span>${dt.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</span></div><div><div style="font-weight:600;line-height:1.35">${esc(e.title)}</div><div class="meta" style="margin-top:4px"><span class="tag ${cls}">${lbl}</span>${e.at.length > 10 ? `<span class="due">${fmtT(e.at)}</span>` : ''}${e.note ? `<span class="due">${esc(e.note)}</span>` : ''}</div></div></div>`; }).join('') : empty('Событий в ближайшее время нет', 'calendar')}</section>`;

  const act = `<section class="panel reveal"><div class="panel-title"><h2>Последняя активность</h2></div>
    ${d.activity.length ? `<div class="feed">${d.activity.map((a) => `<div class="feed-item"><div class="small">${esc(a.text.length > 140 ? a.text.slice(0, 140) + '…' : a.text)}</div><div class="xs muted">${ago(a.created_at)}</div></div>`).join('')}</div>` : empty('Пока нет активности')}</section>`;

  const tutorTools = staff ? `<section class="panel reveal"><div class="panel-title"><h2>Управление</h2></div><div class="row wrap">
    <button class="btn sm" data-act="task-add">${icon('plus', 14)} Задача</button><button class="btn sm" data-act="ev-add">${icon('calendar', 14)} Событие</button>
    <button class="btn sm" data-act="sp-edit">${icon('edit', 14)} Цель и мотивация</button></div></section>` : '';

  return `${hero}<div class="grid g-main" style="margin-top:18px"><div class="stack">${progress}${tasks}</div><div class="stack">${commentPanel}${evs}${tutorTools}${act}</div></div>`;
}

export function mount() {
  const f = $('#fb-form');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/feedback', { method: 'POST', body: { text: f.text.value } }); toast('Комментарий отправлен'); S.refresh(); } catch (x) { toast(x.message, true); }
  };
}

export const acts = {
  'ev-add': () => formModal({
    title: 'Новое событие', submit: 'Добавить',
    fields: [
      { name: 'title', label: 'Название', required: true, value: '' },
      { name: 'kind', label: 'Тип', type: 'select', options: [['session', 'Занятие с тьютором'], ['checkpoint', 'Контрольная точка'], ['deadline', 'Дедлайн'], ['event', 'Событие']], value: 'session', half: true },
      { name: 'starts_at', label: 'Дата и время', type: 'datetime-local', required: true, half: true },
      { name: 'note', label: 'Заметка', value: '' },
    ],
    async onSubmit(v, close) { await api('/api/events', { method: 'POST', body: v }); close(); toast('Событие добавлено'); S.refresh(); },
  }),
  'sp-edit': async () => {
    const d = await api('/api/dashboard'); const p = d.profile;
    formModal({
      title: 'Цель и мотивация ученика', fields: [
        { name: 'main_goal', label: 'Основная образовательная цель', value: p.main_goal, max: 300 },
        { name: 'motivation', label: 'Персональная фраза на главной', value: p.motivation, max: 300 },
        { name: 'status', label: 'Статус ученика', value: p.status, max: 80 },
      ],
      async onSubmit(v, close) { await api('/api/student-profile', { method: 'PATCH', body: v }); close(); toast('Сохранено'); S.refresh(); },
    });
  },
};
