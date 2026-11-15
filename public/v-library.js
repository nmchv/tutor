import { $, S, api, esc, isStaff, icon, iconNames, toast, formModal, modal, confirmBox, empty, nl2, linkTag, fmtDY } from './lib.js';

/* ───── библиотека ученика ───── */
const LF = { cat: '', st: '' };
let LIB = null;
const STAT = ['К изучению', 'Изучается', 'Изучено'];
const stCls = { 'К изучению': '', 'Изучается': 'accent', 'Изучено': 'ok' };

function card(r) {
  const staff = isStaff(), mine = !!r.added_by_self;
  return `<article class="panel res hover reveal"><div class="row sb" style="align-items:flex-start;gap:10px"><div style="min-width:0"><div class="meta" style="margin:0 0 7px"><span class="tag accent">${esc(r.category)}</span>${mine ? '<span class="tag">Моя ссылка</span>' : ''}${r.stage_title ? `<span class="tag">${esc(r.stage_title)}</span>` : ''}</div><h3>${esc(r.title)}</h3></div>
    <button class="icon-btn" style="${r.favorite ? 'color:var(--color-accent)' : ''}" data-act="res-fav" data-id="${r.id}" data-v="${r.favorite ? 0 : 1}" aria-label="В избранное" aria-pressed="${!!r.favorite}"><svg width="19" height="19" viewBox="0 0 24 24" fill="${r.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></button></div>
    ${r.description ? `<p class="small muted">${nl2(r.description)}</p>` : ''}
    ${r.tutor_note ? `<div class="note"><b class="xs" style="text-transform:uppercase;letter-spacing:.08em">Рекомендация тьютора</b><br>${nl2(r.tutor_note)}</div>` : ''}
    <div class="row sb wrap" style="margin-top:auto;gap:8px"><select data-chg="res-status" data-id="${r.id}" style="width:auto;padding:6px 10px;font-size:.84rem" aria-label="Статус изучения">${STAT.map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <div class="row" style="gap:6px">${r.url ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 14)} Открыть</a>` : ''}${staff || mine ? `<button class="icon-btn" style="width:32px;height:32px" data-act="res-edit" data-id="${r.id}" aria-label="Изменить">${icon('edit', 15)}</button><button class="icon-btn" style="width:32px;height:32px" data-act="res-del" data-id="${r.id}" aria-label="Удалить">${icon('trash', 15)}</button>` : ''}</div></div></article>`;
}
function items() {
  return LIB.items.filter((r) => (!LF.cat || r.category === LF.cat) && (!LF.st || (LF.st === 'fav' ? r.favorite : r.status === LF.st)));
}
function inner() {
  const l = items();
  return `<div class="toolbar"><div class="chips">${[['', 'Все'], ['fav', 'В избранном'], ...STAT.map((s) => [s, s])].map(([v, t]) => `<button class="chip ${LF.st === v ? 'on' : ''}" data-act="lib-st" data-v="${v}">${t}</button>`).join('')}</div>
    <select data-chg="lib-cat" style="width:auto;margin-left:auto" aria-label="Категория"><option value="">Все категории</option>${LIB.categories.map((c) => `<option ${LF.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    ${l.length ? `<div class="grid g3">${l.map(card).join('')}</div>` : `<section class="panel">${empty('Материалов по выбранным условиям нет', 'book')}</section>`}`;
}
function paint() { const r = $('#lib-root'); if (r) r.innerHTML = inner(); }

export async function libraryView() {
  LIB = await api('/api/resources');
  const staff = isStaff();
  return `<div class="page-head"><div><div class="eyebrow">Образовательные материалы</div><h1>Библиотека</h1><p class="muted">Материалы, рекомендованные тьютором, и ваши собственные ссылки.</p></div>
    <div class="actions">${staff ? `<button class="btn" data-act="lib-assign">${icon('book', 16)} Из общей библиотеки</button>` : ''}<button class="btn primary" data-act="res-add">${icon('plus', 16)} ${staff ? 'Добавить материал' : 'Добавить ссылку'}</button></div></div><div id="lib-root">${inner()}</div>`;
}

function resFields(r = {}) {
  const staff = isStaff();
  return [
    { name: 'title', label: 'Название', required: true, value: r.title },
    { name: 'category', label: 'Категория', type: 'select', options: LIB.categories, value: r.category || LIB.categories[0], half: true },
    { name: 'url', label: 'Ссылка', type: 'url', value: r.url || '', placeholder: 'https://', max: 500, half: true },
    { name: 'description', label: 'Описание', type: 'textarea', value: r.description },
    ...(staff ? [{ name: 'tutor_note', label: 'Рекомендация тьютора', type: 'textarea', value: r.tutor_note },
      { name: 'stage_id', label: 'Связанный этап маршрута', type: 'select', options: [['', '— без привязки —'], ...LIB.stages.map((s) => [s.id, s.title])], value: r.stage_id || '' }] : []),
  ];
}
const prep = (v) => { if ('stage_id' in v) v.stage_id = v.stage_id ? Number(v.stage_id) : null; return v; };

export const acts = {
  'lib-st': (el) => { LF.st = el.dataset.v; paint(); },
  'lib-cat': (el) => { LF.cat = el.value; paint(); },
  'res-status': async (el) => { await api('/api/resources/' + el.dataset.id, { method: 'PATCH', body: { status: el.value } }); const r = LIB.items.find((x) => x.id === +el.dataset.id); r.status = el.value; toast('Статус обновлён'); },
  'res-fav': async (el) => { await api('/api/resources/' + el.dataset.id, { method: 'PATCH', body: { favorite: el.dataset.v === '1' } }); S.refresh(); },
  'res-add': () => formModal({ title: isStaff() ? 'Новый материал' : 'Своя ссылка', fields: resFields(), submit: 'Добавить', wide: true,
    async onSubmit(v, close) { await api('/api/resources', { method: 'POST', body: prep(v) }); close(); toast('Добавлено'); S.refresh(); } }),
  'res-edit': (el) => { const r = LIB.items.find((x) => x.id === +el.dataset.id);
    formModal({ title: 'Изменить материал', fields: resFields(r), wide: true, async onSubmit(v, close) { await api('/api/resources/' + r.id, { method: 'PATCH', body: prep(v) }); close(); toast('Сохранено'); S.refresh(); } }); },
  'res-del': async (el) => { if (await confirmBox('Удалить материал из библиотеки?')) { try { await api('/api/resources/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); } catch (e) { toast(e.message, true); } } },
  'lib-assign': async () => {
    const shared = await api('/api/library/shared');
    if (!shared.length) return toast('Общая библиотека пуста — добавьте материалы в разделе «Общая библиотека»', true);
    modal({ title: 'Назначить из общей библиотеки', body: `<div>${shared.map((r) => `<div class="row sb" style="padding:10px 0;border-bottom:1px solid var(--color-border)"><div><b class="small">${esc(r.title)}</b><div class="xs muted">${esc(r.category)}</div></div><button class="btn sm" data-id="${r.id}">Назначить</button></div>`).join('')}</div>`,
      onMount(ov, close) { ov.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => { await api('/api/library/assign', { method: 'POST', body: { resource_id: +b.dataset.id, student_ids: [S.sid] } }); close(); toast('Материал назначен ученику'); S.refresh(); })); } });
  },
};

/* ───── общая библиотека тьютора ───── */
let SH = [], CATS = [];
export async function sharedView() {
  SH = await api('/api/library/shared');
  CATS = ['Статьи', 'Книги', 'Видеоматериалы', 'Онлайн-курсы', 'Тесты', 'Практические задания', 'Внешние образовательные ресурсы', 'Документы'];
  return `<div class="page-head"><div><div class="eyebrow">Для тьютора</div><h1>Общая библиотека</h1><p class="muted">Материалы, которые можно назначать разным ученикам.</p></div><div class="actions"><button class="btn primary" data-act="sh-add">${icon('plus', 16)} Добавить материал</button></div></div>
    ${SH.length ? `<div class="grid g3">${SH.map((r) => `<article class="panel res hover reveal"><span class="tag accent" style="align-self:flex-start">${esc(r.category)}</span><h3>${esc(r.title)}</h3>${r.description ? `<p class="small muted">${esc(r.description)}</p>` : ''}${r.tutor_note ? `<div class="note">${nl2(r.tutor_note)}</div>` : ''}
      <div class="row sb" style="margin-top:auto"><button class="btn sm" data-act="sh-assign" data-id="${r.id}">${icon('users', 14)} Назначить</button><div class="row" style="gap:4px">${linkTag(r.url)}<button class="icon-btn" style="width:32px;height:32px" data-act="sh-del" data-id="${r.id}" aria-label="Удалить">${icon('trash', 15)}</button></div></div></article>`).join('')}</div>` : `<section class="panel">${empty('Общая библиотека пуста', 'book')}</section>`}`;
}
Object.assign(acts, {
  'sh-add': () => formModal({ title: 'Материал в общую библиотеку', wide: true, submit: 'Добавить',
    fields: [{ name: 'title', label: 'Название', required: true }, { name: 'category', label: 'Категория', type: 'select', options: CATS, value: CATS[0], half: true }, { name: 'url', label: 'Ссылка', type: 'url', placeholder: 'https://', half: true },
      { name: 'description', label: 'Описание', type: 'textarea' }, { name: 'tutor_note', label: 'Рекомендация', type: 'textarea' }],
    async onSubmit(v, close) { await api('/api/library/shared', { method: 'POST', body: v }); close(); toast('Добавлено'); S.refresh(); } }),
  'sh-del': async (el) => { if (await confirmBox('Удалить материал из общей библиотеки? У учеников уже назначенные копии сохранятся.')) { await api('/api/library/shared/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); } },
  'sh-assign': async (el) => {
    const studs = await api('/api/tutor/students');
    if (!studs.length) return toast('У вас пока нет учеников', true);
    modal({ title: 'Назначить ученикам', body: `<form>${studs.map((s) => `<label class="row" style="padding:8px 0;cursor:pointer"><input type="checkbox" value="${s.id}"> <span>${esc(s.name)}</span></label>`).join('')}<div style="margin-top:14px"><button class="btn primary" type="submit">Назначить</button></div></form>`,
      onMount(ov, close) { $('form', ov).onsubmit = async (e) => { e.preventDefault(); const ids = [...ov.querySelectorAll('input:checked')].map((i) => +i.value); if (!ids.length) return toast('Выберите учеников', true);
        const r = await api('/api/library/assign', { method: 'POST', body: { resource_id: +el.dataset.id, student_ids: ids } }); close(); toast(`Назначено: ${r.assigned}`); }; } });
  },
});

/* ───── инструменты NMCHV ───── */
let TOOLS = [];
export async function toolsView() {
  TOOLS = await api('/api/tools');
  const admin = S.me.role === 'admin';
  return `<div class="page-head"><div><div class="eyebrow">Экосистема NMCHV</div><h1>Инструменты</h1><p class="muted">Проекты и тренажёры, доступные из личного кабинета.</p></div>${admin ? `<div class="actions"><button class="btn primary" data-act="tool-add">${icon('plus', 16)} Добавить инструмент</button></div>` : ''}</div>
    ${TOOLS.length ? `<div class="grid g3">${TOOLS.map((t) => `<article class="panel res hover reveal"><div class="row" style="gap:14px"><div class="tool-ico">${icon(t.icon, 22)}</div><div><div class="meta" style="margin:0 0 4px"><span class="tag accent">${esc(t.category)}</span><span class="tag ${t.status === 'Доступно' ? 'ok' : ''}">${esc(t.status)}</span></div><h3>${esc(t.title)}</h3></div></div>
      <p class="small muted">${esc(t.description)}</p><div class="row sb" style="margin-top:auto">${t.url && t.status === 'Доступно' ? `<a class="btn primary sm" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Перейти ${icon('link', 14)}</a>` : '<span class="small muted">Скоро</span>'}
      ${admin ? `<div class="row" style="gap:2px"><button class="icon-btn" data-act="tool-edit" data-id="${t.id}" aria-label="Изменить">${icon('edit', 16)}</button><button class="icon-btn" data-act="tool-del" data-id="${t.id}" aria-label="Удалить">${icon('trash', 16)}</button></div>` : ''}</div></article>`).join('')}</div>` : `<section class="panel">${empty('Инструментов пока нет', 'tool')}</section>`}
    <p class="small muted" style="margin-top:22px">В перспективе результаты внешних сервисов (например, тестирования в Геотренажёре) смогут автоматически попадать в раздел «Прогресс».</p>`;
}
const toolFields = (t = {}) => [
  { name: 'title', label: 'Название', required: true, value: t.title },
  { name: 'description', label: 'Описание', type: 'textarea', value: t.description, max: 600 },
  { name: 'url', label: 'Ссылка', type: 'url', value: t.url || '', placeholder: 'https://', max: 500 },
  { name: 'category', label: 'Категория', value: t.category || 'Инструменты', half: true, max: 60 },
  { name: 'status', label: 'Статус доступности', type: 'select', options: ['Доступно', 'Скоро', 'Недоступно'], value: t.status || 'Доступно', half: true },
  { name: 'icon', label: 'Иконка', type: 'select', options: iconNames, value: t.icon || 'tool', half: true },
  { name: 'position', label: 'Порядок', type: 'number', value: t.position ?? 0, min: 0, half: true },
];
const tp = (v) => { v.position = Number(v.position) || 0; return v; };
Object.assign(acts, {
  'tool-add': () => formModal({ title: 'Новый инструмент', fields: toolFields(), wide: true, submit: 'Добавить', async onSubmit(v, close) { await api('/api/tools', { method: 'POST', body: tp(v) }); close(); S.refresh(); } }),
  'tool-edit': (el) => { const t = TOOLS.find((x) => x.id === +el.dataset.id); formModal({ title: 'Инструмент', fields: toolFields(t), wide: true, async onSubmit(v, close) { await api('/api/tools/' + t.id, { method: 'PATCH', body: tp(v) }); close(); S.refresh(); } }); },
  'tool-del': async (el) => { if (await confirmBox('Удалить инструмент?')) { await api('/api/tools/' + el.dataset.id, { method: 'DELETE' }); S.refresh(); } },
});
