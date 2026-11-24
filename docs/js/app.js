import { $, $$, S, api, esc, icon, avatar, toast, ago, postRender, empty, isStaff } from './lib.js';
import * as Home from './v-home.js';
import * as Route from './v-route.js';
import * as Goals from './v-goals.js';
import * as Tasks from './v-tasks.js';
import * as Prog from './v-progress.js';
import * as Lib from './v-library.js';
import * as People from './v-people.js';

const ACTS = { ...Home.acts, ...Route.acts, ...Goals.acts, ...Tasks.acts, ...Prog.acts, ...Lib.acts, ...People.acts };
const app = $('#app');
let busy = 0;

/* ───── маршрутизация ───── */
const STUDENT_VIEWS = {
  home: [Home.view, Home.mount], route: [Route.view, Route.mount], goals: [Goals.view], tasks: [Tasks.view],
  progress: [Prog.view, Prog.mount], library: [Lib.libraryView], reflection: [Prog.reflectionView, Prog.reflectionMount],
  tools: [Lib.toolsView], report: [null],
};
function parse() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (parts[0] === 'student' && parts[1]) return { sid: Number(parts[1]) || null, view: parts[2] || 'home', params };
  return { sid: null, view: parts[0] || '', params };
}

const NAV = [['home', 'Главная', 'home'], ['route', 'Маршрут', 'route'], ['goals', 'Цели', 'goal'], ['tasks', 'Задачи', 'tasks'], ['progress', 'Прогресс', 'chart'], ['library', 'Библиотека', 'book']];
const hrefFor = (v) => (S.sid ? `#/student/${S.sid}/${v}` : `#/${v}`);

function shell() {
  const me = S.me, p = (me && S.profile) || { full_name: '', email: '' }, staff = me && isStaff();
  const cur = parse();
  const nav = staff && !S.sid
    ? [['students', 'Ученики', 'users'], ['shared-library', 'Библиотека', 'book'], ['tools', 'Инструменты', 'tool'], ...(me && me.role === 'admin' ? [['admin', 'Пользователи', 'shield']] : [])]
    : NAV;
  const link = (v, t) => `<a href="${staff && !S.sid ? '#/' + v : hrefFor(v)}" class="${cur.view === v ? 'on' : ''}">${t}</a>`;
  const mob = (staff && !S.sid ? nav : nav.slice(0, 4)).map(([v, t, ic]) => `<a href="${staff && !S.sid ? '#/' + v : hrefFor(v)}" class="${cur.view === v ? 'on' : ''}">${icon(ic, 21)}<span>${t}</span></a>`).join('');
  const more = !(staff && !S.sid) ? `<button data-act="menu-more">${icon('more', 21)}<span>Ещё</span></button>` : `<button data-act="menu-prof">${icon('user', 21)}<span>Профиль</span></button>`;
  return `<header class="topbar"><a class="brand" href="${staff ? '#/students' : '#/home'}">NMCHV<small>Student</small></a>
    <nav class="nav" aria-label="Основная навигация">${nav.map(([v, t]) => link(v, t)).join('')}</nav>
    <div class="top-right">
      <div class="menu-wrap"><button class="icon-btn" id="bell" data-act="bell" aria-label="Уведомления">${icon('bell', 20)}<span class="badge" id="bell-n" hidden></span></button><div class="dropdown notif-panel" id="notif-panel"></div></div>
      <div class="menu-wrap"><button class="icon-btn" data-act="prof-menu" aria-label="Меню профиля" style="width:auto;border-radius:99px;padding:2px">${avatar(p)}</button>
        <div class="dropdown" id="prof-menu"><div class="who"><b>${esc(p.full_name)}</b><div class="xs muted">${esc(me?.email || '')}</div></div><hr>
          <a href="#/profile">${icon('user', 17)} Профиль</a>
          ${!staff ? `<a href="#/reflection">${icon('msg', 17)} Рефлексия</a>` : ''}<a href="#/tools">${icon('tool', 17)} Инструменты NMCHV</a>
          ${staff ? `<a href="#/students">${icon('users', 17)} Ученики</a><a href="#/shared-library">${icon('book', 17)} Общая библиотека</a>` : ''}${me && me.role === 'admin' ? `<a href="#/admin">${icon('shield', 17)} Пользователи</a>` : ''}<hr>
          <button data-act="logout">${icon('logout', 17)} Выйти</button></div></div></div></header>
    <div id="page-wrap"></div><nav class="bottomnav" aria-label="Мобильная навигация">${mob}${more}</nav>`;
}
function ctxBar(stu) {
  if (!S.sid) return '';
  const tabs = [['home', 'Обзор'], ['route', 'Маршрут'], ['goals', 'Цели'], ['tasks', 'Задачи'], ['progress', 'Прогресс'], ['library', 'Библиотека'], ['reflection', 'Рефлексия']];
  const cur = parse().view;
  return `<div class="ctx-bar no-print"><a href="#/students" class="small">← Ученики</a><div class="row" style="gap:10px">${avatar(stu, 'md')}<div><b>${esc(stu.full_name)}</b><div class="xs muted">Кабинет ученика</div></div></div><div class="ctx-tabs">${tabs.map(([v, t]) => `<a href="#/student/${S.sid}/${v}" class="${cur === v ? 'on' : ''}">${t}</a>`).join('')}</div></div>`;
}

let shellFor = null;
async function render(keepScroll = false) {
  console.log('render() called, hash:', location.hash);
  const my = ++busy;
  const r = parse();
  console.log('parse result:', r);
  S.sid = r.sid;
  if (!S.me) { console.log('no S.me, renderAuth'); return renderAuth(); }
  if (!S.profile && !isStaff()) { console.log('no S.profile, waiting'); return; }
  const staff = isStaff();
  console.log('staff:', staff, 'S.sid:', S.sid, 'r.sid:', r.sid, 'view:', r.view);
  let view = r.view;
  if (staff && !S.sid && ['', 'home', 'route', 'goals', 'tasks', 'progress', 'reflection', 'report'].includes(view)) { console.log('redirect to students'); location.replace('#/students'); return; }
  if (!staff && !r.sid && view !== 'home') { console.log('redirect to home'); location.replace('#/home'); return; }
  if (!staff && (view === '' || view === 'students')) view = 'home';
  if (!staff && !r.sid) S.sid = S.me.id;
  console.log('after redirects, view:', view, 'S.sid:', S.sid);

  const key = S.me.id + ':' + (staff && !S.sid ? 'n' : 's');
  if (shellFor !== key || !$('#page-wrap')) { app.innerHTML = shell(); shellFor = key; }
  else { $$('.nav a, .bottomnav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href').endsWith('/' + view))); }

  const sy = keepScroll ? scrollY : 0;
  let html = '', mount = null;
  try {
    let stuCtx = '';
    if (S.sid) { const d = await api('/api/dashboard'); stuCtx = ctxBar(d.profile); S.stuProfile = d.profile; }
    if (view === 'students') { html = await People.tutorView(); }
    else if (view === 'shared-library') { html = await Lib.sharedView(); }
    else if (view === 'admin') { if (S.me.role !== 'admin') throw new Error('Раздел только для администратора'); html = await People.adminView(); }
    else if (view === 'profile') { html = await People.profileView(); mount = People.profileMount; }
    else if (view === 'report') { html = await Prog.reportView(r.params); }
    else if (STUDENT_VIEWS[view]) { const [fn, m] = STUDENT_VIEWS[view]; html = await fn(); mount = m; }
    else html = `<section class="panel">${empty('Страница не найдена', 'file')}</section>`;
    if (my !== busy) return;
    $('#page-wrap').innerHTML = `<main>${stuCtx}${html}</main>`;
    mount && mount();
    postRender($('#page-wrap'));
    window.scrollTo(0, sy);
    document.title = 'NMCHV Student';
    loadBell();
  } catch (e) {
    if (e.status === 401) { S.me = null; return renderAuth(); }
    $('#page-wrap').innerHTML = `<main><section class="panel">${empty(e.message || 'Ошибка загрузки', 'file')}<div style="text-align:center"><a class="btn" href="#/">На главную</a></div></section></main>`;
  }
}
S.refresh = (full) => { if (full) shellFor = null; return render(true); };

/* ───── уведомления ───── */
let NOTES = [];
async function loadBell() {
  try {
    const d = await api('/api/notifications?student=0'.replace('?student=0', ''));
    NOTES = d.items; const n = $('#bell-n');
    if (n) { n.hidden = !d.unread; n.textContent = d.unread > 9 ? '9+' : d.unread; }
  } catch {}
}
function bellHtml() {
  return `<div class="row sb" style="padding:12px 14px;border-bottom:1px solid var(--color-border)"><b>Уведомления</b><button class="link-btn" data-act="notif-all">Прочитать все</button></div>
  ${NOTES.length ? NOTES.slice(0, 25).map((n) => `<a class="notif-item ${n.is_read ? '' : 'unread'}" href="${esc(n.link || '#/home')}" data-act="notif-read" data-id="${n.id}"><div class="small" style="font-weight:600">${esc(n.title)}</div>${n.body ? `<div class="xs muted">${esc(n.body)}</div>` : ''}<div class="xs muted" style="margin-top:2px">${ago(n.created_at)}</div></a>`).join('') : '<div class="empty small">Уведомлений нет</div>'}
  <div style="padding:10px 14px"><a class="small" href="#/profile">Настроить частоту</a></div>`;
}
function closeMenus() { $$('.dropdown.open').forEach((d) => d.classList.remove('open')); }

/* ───── делегирование событий ───── */
document.addEventListener('click', async (e) => {
  const open = e.target.closest('.menu-wrap');
  $$('.dropdown.open').forEach((d) => { if (!open || !open.contains(d)) d.classList.remove('open'); });
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'bell') { const p = $('#notif-panel'); await loadBell(); p.innerHTML = bellHtml(); p.classList.toggle('open'); return; }
  if (act === 'prof-menu') { $('#prof-menu').classList.toggle('open'); return; }
  if (act === 'menu-prof' || act === 'menu-more') { $('#prof-menu').classList.add('open'); e.stopPropagation(); return; }
  if (act === 'notif-all') { await api('/api/notifications/read', { method: 'POST', body: {} }); await loadBell(); $('#notif-panel').innerHTML = bellHtml(); return; }
  if (act === 'notif-read') { api('/api/notifications/read', { method: 'POST', body: { id: +el.dataset.id } }).then(loadBell); closeMenus(); return; }
  if (el.tagName === 'SELECT' || el.matches('[data-chg]')) return;
  const fn = ACTS[act]; if (!fn) return;
  if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('#')) return;
  try { await fn(el, e); } catch (x) { toast(x.message || 'Ошибка', true); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-chg]'); if (!el) return;
  const fn = ACTS[el.dataset.chg]; if (!fn) return;
  try { await fn(el, e); } catch (x) { toast(x.message || 'Ошибка', true); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click();
});

/* ───── вход и регистрация ───── */
async function renderAuth() {
  shellFor = null;
  let pub = { demo: false, accounts: [] };
  try { pub = await api('/api/public'); } catch {}
  let mode = 'login';
  const art = `<svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true"><defs><linearGradient id="ag" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5b8def" stop-opacity="0"/><stop offset="1" stop-color="#5b8def" stop-opacity=".9"/></linearGradient><radialGradient id="an"><stop offset="0" stop-color="#5b8def" stop-opacity=".45"/><stop offset="1" stop-color="#5b8def" stop-opacity="0"/></radialGradient></defs>
    <g stroke="#171b23"><path d="M100 0v800M220 0v800M340 0v800M460 0v800M580 0v800M0 160h600M0 320h600M0 480h600M0 640h600"/></g>
    <path d="M-20 720 C120 720 140 600 250 590 S380 450 430 400 S520 250 640 200" stroke="url(#ag)" stroke-width="2"/>
    <circle cx="250" cy="590" r="6" fill="#5b8def"/><circle cx="430" cy="400" r="6" fill="#5b8def"/><circle cx="545" cy="262" r="26" fill="url(#an)"/><circle cx="545" cy="262" r="7" fill="#0d1424" stroke="#a5c4ff" stroke-width="2"/></svg>`;
  const draw = () => {
    app.innerHTML = `<div class="auth"><div class="auth-art">${art}<div class="brand" style="font-size:1.1rem">NMCHV<small>Student</small></div>
      <div><div class="eyebrow">Образовательный маршрут</div><h1>Где я сейчас, куда иду и что делать дальше</h1><p class="muted" style="max-width:440px">Личное пространство для долгосрочного образовательного развития вместе с тьютором: цели, этапы, задачи и прогресс в одной картине.</p></div><div class="xs muted">Экосистема NMCHV</div></div>
      <div class="auth-form"><div class="auth-box"><h2 style="font-size:1.5rem;margin-bottom:6px">${mode === 'login' ? 'Вход в кабинет' : 'Регистрация'}</h2><p class="muted small" style="margin-bottom:22px">${mode === 'login' ? 'Введите email и пароль.' : 'Создайте личный кабинет ученика.'}</p>
      <form id="auth-form">${mode === 'reg' ? '<div class="field"><label>Имя и фамилия</label><input name="full_name" required maxlength="100" autocomplete="name"></div>' : ''}
        <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username"></div>
        <div class="field"><label>Пароль${mode === 'reg' ? ' (от 8 символов)' : ''}</label><input name="password" type="password" required minlength="${mode === 'reg' ? 8 : 1}" autocomplete="${mode === 'reg' ? 'new-password' : 'current-password'}"></div>
        <p class="err" hidden></p><button class="btn primary block" type="submit">${mode === 'login' ? 'Войти' : 'Создать кабинет'}</button></form>
      <p class="small muted" style="margin-top:16px">${mode === 'login' ? 'Нет аккаунта? <button class="link-btn" id="sw">Зарегистрироваться</button>' : 'Уже есть аккаунт? <button class="link-btn" id="sw">Войти</button>'}</p>
      <p class="small muted" style="margin-top:12px;text-align:center"><button class="btn block" style="background:transparent;border:1px solid var(--color-border);color:var(--color-text-primary)" onclick="location.href='https://www.login.nmchv.ru/login?redirect='+encodeURIComponent(location.origin+'/auth/callback?redirect='+encodeURIComponent(location.pathname+location.search+location.hash))">Войти через login.nmchv.ru</button></p>
      ${pub.demo && mode === 'login' ? `<div class="demo-box"><div class="eyebrow" style="margin-bottom:6px">Демонстрационный режим</div>${pub.accounts.map((a) => `<button type="button" data-e="${esc(a.email)}" data-p="${esc(a.password)}"><span>${{ student: 'Ученик', tutor: 'Тьютор', admin: 'Администратор' }[a.role]}</span><span class="muted">${esc(a.email)}</span></button>`).join('')}</div>` : ''}</div></div></div>`;
    $('#sw').onclick = () => { mode = mode === 'login' ? 'reg' : 'login'; draw(); };
    $$('.demo-box button').forEach((b) => (b.onclick = () => { const f = $('#auth-form'); f.email.value = b.dataset.e; f.password.value = b.dataset.p; f.requestSubmit(); }));
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, err = $('.err', f); err.hidden = true;
      const body = { email: f.email.value, password: f.password.value }; if (f.full_name) body.full_name = f.full_name.value;
      try { const result = await api('/api/auth/' + (mode === 'login' ? 'login' : 'register'), { method: 'POST', body }); S.me = { id: result.id, email: result.email, role: result.role }; S.profile = result.profile; location.hash = S.me.role === 'student' ? '#/home' : '#/students'; shellFor = null; render(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
    };
  };
  draw();
}

(async function init() {
  console.log('init() running');
  window.addEventListener('hashchange', () => { closeMenus(); render(); });
  try { 
    const session = await api('/api/me');
    S.me = session.user;
    S.profile = session.profile;
    console.log('S.me set:', S.me);
  } catch (e) { console.error('init error:', e); S.me = null; }
  render();
})();
