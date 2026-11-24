import { $, S, api, esc, isStaff, href, icon, toast, formModal, modal, confirmBox, bar, empty, avatar, fmtD, fmtDY, ago, plural } from './lib.js';

/* ───── профиль ───── */
const ROLE = { student: 'Ученик', tutor: 'Тьютор', admin: 'Администратор' };
const FREQ = [['all', 'Все уведомления'], ['important', 'Только важные: задачи, дедлайны, комментарии'], ['minimal', 'Минимум: комментарии и проверка задач']];
const HK = { milestone: 'Этап', goal: 'Цель', tutor_comment: 'Комментарий тьютора', record: 'Результат', route: 'Маршрут', task_done: 'Задача' };

export async function profileView() {
  const me = await api('/api/me'); S.me = me;
  const p = me.profile, student = me.role === 'student';
  const hist = student ? (await api('/api/history')).filter((h) => ['milestone', 'goal', 'tutor_comment', 'record'].includes(h.kind)).slice(0, 14) : [];
  const dirs = (p.directions || []).join(', ');
  return `<div class="page-head"><div><div class="eyebrow">Личные данные</div><h1>Профиль</h1></div></div>
  <div class="grid g-main"><div class="stack">
    <section class="panel reveal"><div class="row" style="gap:18px;margin-bottom:22px">${avatar(p, 'lg')}<div><h2>${esc(p.full_name)}</h2><div class="muted small">${esc(me.email)}</div><div class="meta"><span class="tag accent">${ROLE[me.role]}</span>${student ? `<span class="tag">${esc(p.status)}</span>` : ''}</div></div></div>
      <form id="prof-form"><div class="field-row"><div class="field"><label>Имя и фамилия</label><input name="full_name" value="${esc(p.full_name)}" required maxlength="100"></div><div class="field"><label>Ссылка на фотографию</label><input name="photo_url" type="url" value="${esc(p.photo_url || '')}" placeholder="https://" maxlength="500"></div></div>
      <div class="field"><label>Краткая информация</label><textarea name="bio" maxlength="800">${esc(p.bio)}</textarea></div>
      ${student ? `<div class="field"><label>Основная образовательная цель</label><input name="main_goal" value="${esc(p.main_goal)}" maxlength="300"></div>
      <div class="field"><label>Направления развития</label><input name="directions" value="${esc(dirs)}" placeholder="Через запятую" maxlength="400"><span class="xs muted">Направления используются в задачах и аналитике.</span></div>
      <div class="field-row"><div class="field"><label>Текущий статус</label><input name="status" value="${esc(p.status)}" maxlength="80"></div><div class="field"><label>Дата начала обучения</label><input value="${p.start_date ? fmtDY(p.start_date) : '—'}" disabled></div></div>` : ''}
      <div class="field"><label>Частота уведомлений</label><select name="notify_freq">${FREQ.map(([v, t]) => `<option value="${v}" ${p.notify_freq === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <p class="err" hidden></p><button class="btn primary" type="submit">Сохранить</button></form></section>
    <section class="panel reveal"><div class="panel-title"><h2>Смена пароля</h2></div><form id="pw-form"><div class="field-row"><div class="field"><label>Текущий пароль</label><input name="current" type="password" autocomplete="current-password" required></div><div class="field"><label>Новый пароль (от 8 символов)</label><input name="next" type="password" autocomplete="new-password" minlength="8" required></div></div><p class="err" hidden></p><button class="btn" type="submit">Изменить пароль</button></form></section></div>
  <div class="stack">${student ? `<section class="panel reveal"><div class="panel-title"><h2>Моя образовательная история</h2></div>${hist.length ? `<div class="feed">${hist.map((h) => `<div class="feed-item"><div class="small">${esc(h.text.length > 130 ? h.text.slice(0, 130) + '…' : h.text)}</div><div class="xs muted">${HK[h.kind] || ''} · ${fmtDY(h.created_at)}</div></div>`).join('')}</div>` : empty('История появится по мере работы')}<a class="small" href="#/progress" style="display:inline-block;margin-top:10px">Вся история →</a></section>` : ''}
    <section class="panel reveal"><div class="panel-title"><h2>Сессия</h2></div><button class="btn block" data-act="logout">${icon('logout', 16)} Выйти из аккаунта</button></section></div></div>`;
}
export function profileMount() {
  const f = $('#prof-form'), pw = $('#pw-form');
  const bind = (form, fn) => form && (form.onsubmit = async (e) => { e.preventDefault(); const err = $('.err', form); err.hidden = true; try { await fn(form); } catch (x) { err.textContent = x.message; err.hidden = false; } });
  bind(f, async (f) => {
    const body = { full_name: f.full_name.value, photo_url: f.photo_url.value, bio: f.bio.value, notify_freq: f.notify_freq.value };
    if (f.main_goal) { body.main_goal = f.main_goal.value; body.status = f.status.value; body.directions = f.directions.value.split(',').map((x) => x.trim()).filter(Boolean); }
    S.me = await api('/api/me', { method: 'PATCH', body }); toast('Профиль сохранён'); S.refresh(true);
  });
  bind(pw, async (f) => { await api('/api/me/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } }); f.reset(); toast('Пароль изменён'); });
}

/* ───── панель тьютора ───── */
let STUDENTS = [];
export async function tutorView() {
  STUDENTS = await api('/api/tutor/students');
  const rev = STUDENTS.reduce((a, s) => a + s.review, 0), od = STUDENTS.reduce((a, s) => a + s.overdue, 0);
  return `<div class="page-head"><div><div class="eyebrow">Панель тьютора</div><h1>Ученики</h1><p class="muted">Образовательные траектории ваших учеников.</p></div><div class="actions"><button class="btn primary" data-act="stu-add">${icon('plus', 16)} Добавить ученика</button></div></div>
  <section class="panel reveal" style="margin-bottom:18px"><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${STUDENTS.length}</b><span class="small muted">${plural(STUDENTS.length, 'ученик', 'ученика', 'учеников')}</span></div><div class="stat"><b style="${rev ? 'color:var(--color-accent-hover)' : ''}">${rev}</b><span class="small muted">задач ждут проверки</span></div><div class="stat"><b style="${od ? 'color:#efb27a' : ''}">${od}</b><span class="small muted">просроченных задач</span></div></div></section>
  <section class="panel reveal" style="padding:8px 18px">${STUDENTS.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Ученик</th><th class="hide-s">Текущий этап</th><th style="min-width:130px">Прогресс</th><th>Задачи</th><th class="hide-s">Ближайший дедлайн</th><th class="hide-s">Активность</th></tr></thead><tbody>
    ${STUDENTS.map((s) => `<tr class="click" data-act="stu-open" data-id="${s.id}" tabindex="0"><td><div class="row" style="gap:12px">${avatar(s, 'md')}<div style="min-width:0"><b>${esc(s.name)}</b><div class="xs muted" style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.main_goal || 'Цель не задана')}</div></div></div></td>
      <td class="hide-s small">${esc(s.stage)}</td><td><div class="row" style="gap:10px"><div style="flex:1">${bar(s.progress)}</div><b class="small">${s.progress}%</b></div></td>
      <td><b>${s.activeTasks}</b> ${s.review ? `<span class="tag warn" title="На проверке">${s.review} на проверке</span>` : ''} ${s.overdue ? `<span class="tag danger" title="Просрочено">${s.overdue} просроч.</span>` : ''}</td>
      <td class="hide-s small">${s.nextDeadline ? fmtD(s.nextDeadline) : '—'}</td><td class="hide-s small muted">${ago(s.lastActivity)}</td></tr>`).join('')}</tbody></table></div>` : empty('Учеников пока нет. Добавьте первого — для него будет создан личный кабинет.', 'users')}</section>`;
}
const genPw = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
export const acts = {
  'stu-open': (el) => { location.hash = `#/student/${el.dataset.id}/home`; },
  'stu-add': () => formModal({ title: 'Новый ученик', submit: 'Создать кабинет', wide: true,
    fields: [{ name: 'full_name', label: 'Имя и фамилия', required: true, half: true }, { name: 'email', label: 'Email (логин)', type: 'email', required: true, half: true, autocomplete: 'off' },
      { name: 'password', label: 'Временный пароль', value: genPw(), required: true, hint: 'Передайте пароль ученику — он сможет изменить его в профиле.', autocomplete: 'off' },
      { name: 'main_goal', label: 'Основная образовательная цель' }, { name: 'directions', label: 'Направления (через запятую)', hint: 'Например: Английский язык, Академическая подготовка' }],
    async onSubmit(v, close) {
      const r = await api('/api/tutor/students', { method: 'POST', body: { ...v, directions: v.directions.split(',').map((x) => x.trim()).filter(Boolean) } });
      close(); toast('Кабинет ученика создан'); location.hash = `#/student/${r.id}/route`;
    } }),
  logout: async () => { await api('/api/auth/logout', { method: 'POST' }); sessionStorage.removeItem('sb-token'); S.accessToken = null; S.me = null; location.hash = ''; location.reload(); },
};

/* ───── администратор ───── */
let USERS = [];
export async function adminView() {
  USERS = (await api('/api/admin/users')).users;
  const name = (id) => USERS.find((u) => u.id === id)?.name || '—';
  return `<div class="page-head"><div><div class="eyebrow">Администрирование</div><h1>Пользователи</h1><p class="muted">Роли, доступ и связи тьюторов с учениками.</p></div><div class="actions"><button class="btn primary" data-act="usr-add">${icon('plus', 16)} Добавить пользователя</button></div></div>
  <section class="panel reveal" style="padding:8px 18px"><div class="scroll-x"><table class="table"><thead><tr><th>Пользователь</th><th>Роль</th><th class="hide-s">Связи</th><th>Доступ</th><th></th></tr></thead><tbody>
  ${USERS.map((u) => `<tr><td><b>${esc(u.name || '—')}</b><div class="xs muted">${esc(u.email)}</div></td>
    <td><select data-chg="usr-role" data-id="${u.id}" style="width:auto;padding:6px 10px" ${u.id === S.me.id ? 'disabled' : ''}>${Object.entries(ROLE).map(([v, t]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td class="hide-s small">${u.role === 'student' ? (u.tutors.length ? u.tutors.map((t) => esc(name(t))).join(', ') : '<span class="muted">без тьютора</span>') : u.students.length ? `${u.students.length} ${plural(u.students.length, 'ученик', 'ученика', 'учеников')}` : '—'}${u.role === 'student' ? ` <button class="link-btn" data-act="usr-link" data-id="${u.id}">изменить</button>` : ''}</td>
    <td><span class="tag ${u.active ? 'ok' : 'danger'}">${u.active ? 'Активен' : 'Отключён'}</span></td>
    <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-act="usr-pw" data-id="${u.id}">Пароль</button> ${u.id !== S.me.id ? `<button class="btn sm ${u.active ? 'danger' : ''}" data-act="usr-toggle" data-id="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Отключить' : 'Включить'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
}
Object.assign(acts, {
  'usr-role': async (el) => { try { await api('/api/admin/users/' + el.dataset.id, { method: 'PATCH', body: { role: el.value } }); toast('Роль изменена'); S.refresh(); } catch (e) { toast(e.message, true); S.refresh(); } },
  'usr-toggle': async (el) => { await api('/api/admin/users/' + el.dataset.id, { method: 'PATCH', body: { active: el.dataset.v === '1' } }); S.refresh(); },
  'usr-pw': (el) => formModal({ title: 'Новый пароль', submit: 'Установить', fields: [{ name: 'password', label: 'Пароль (от 8 символов)', value: genPw(), required: true, autocomplete: 'off' }],
    async onSubmit(v, close) { await api('/api/admin/users/' + el.dataset.id, { method: 'PATCH', body: v }); close(); toast('Пароль изменён, сессии пользователя завершены'); } }),
  'usr-add': () => formModal({ title: 'Новый пользователь', submit: 'Создать', fields: [
    { name: 'full_name', label: 'Имя и фамилия', required: true, half: true }, { name: 'email', label: 'Email', type: 'email', required: true, half: true, autocomplete: 'off' },
    { name: 'role', label: 'Роль', type: 'select', options: Object.entries(ROLE), value: 'student', half: true }, { name: 'password', label: 'Пароль', value: genPw(), required: true, half: true, autocomplete: 'off' }],
    async onSubmit(v, close) { await api('/api/admin/users', { method: 'POST', body: v }); close(); toast('Пользователь создан'); S.refresh(); } }),
  'usr-link': (el) => {
    const sid = el.dataset.id;
    const s = USERS.find((u) => u.id === sid), tutors = USERS.filter((u) => u.role === 'tutor' || u.role === 'admin');
    modal({ title: `Тьюторы: ${s.name}`, body: `<div>${tutors.map((t) => `<label class="row" style="padding:8px 0;cursor:pointer"><input type="checkbox" value="${t.id}" ${s.tutors.includes(t.id) ? 'checked' : ''}> <span>${esc(t.name)} <span class="xs muted">${ROLE[t.role]}</span></span></label>`).join('') || '<p class="muted">Нет тьюторов</p>'}</div><div style="margin-top:14px"><button class="btn primary" id="lk-save">Сохранить</button></div>`,
      onMount(ov, close) { $('#lk-save', ov).onclick = async () => { const on = new Set([...ov.querySelectorAll('input:checked')].map((i) => +i.value));
        for (const t of tutors) { const had = s.tutors.includes(t.id), now = on.has(t.id); if (had !== now) await api('/api/admin/link', { method: 'POST', body: { tutor_id: t.id, student_id: s.id, unlink: !now } }); }
        close(); toast('Связи обновлены'); S.refresh(); }; } });
  },
});
