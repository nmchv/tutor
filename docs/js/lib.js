/* Общие утилиты: Store API, форматирование, иконки, модальные окна, графики */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const S = { me: null, sid: null, refresh: () => {} };
export const isStaff = () => S.me && S.me.role !== 'student';
export const href = (view) => (S.sid ? `#/student/${S.sid}/${view}` : `#/${view}`);

export async function api(path, { method = 'GET', body } = {}) {
  const [endpoint, query] = path.split('?');
  const params = new URLSearchParams(query || '');
  
  try {
    switch (endpoint) {
      case '/api/public':
        return await Store.getPublicInfo();
      
      case '/api/auth/login':
        return await Store.login(body.email, body.password);
      
      case '/api/auth/register':
        return await Store.register({ email: body.email, password: body.password, full_name: body.full_name });
      
      case '/api/auth/logout':
        await Store.logout();
        return { ok: true };
      
      case '/api/me':
        if (method === 'PATCH') {
          return await Store.updateProfile(body);
        }
        return await Store.me();
      
      case '/api/me/password':
        return await Store.changePassword(body.current, body.next);
      
      case '/api/dashboard':
        return await Store.dashboard(S.sid);
      
      case '/api/route':
        return await Store.getRoute(S.sid);
      
      case '/api/stages':
        return await Store.createStage(S.sid, body);
      
      case '/api/goals':
        return await Store.getGoals(S.sid);
      
      case '/api/tasks':
        return await Store.getTasks(S.sid);
      
      case '/api/feedback':
        if (method === 'POST') return await Store.addFeedback(S.sid, body);
        return await Store.getFeedback(S.sid);
      
      case '/api/events':
        if (method === 'POST') return await Store.createEvent(S.sid, body);
        return await Store.getEvents(S.sid);
      
      case '/api/resources':
        if (method === 'POST') return await Store.createResource(S.sid, body);
        return await Store.getResources(S.sid);
      
      case '/api/library/shared':
        if (method === 'POST') return await Store.createSharedResource(body);
        return await Store.getSharedLibrary();
      
      case '/api/library/assign':
        return await Store.assignResource(body.resource_id, body.student_ids);
      
      case '/api/reflections':
        if (method === 'POST') return await Store.createReflection(body);
        return await Store.getReflections(S.sid);
      
      case '/api/reflection-questions':
        if (method === 'POST') return await Store.createReflectionQuestion(S.sid, body);
        // handled by delete below
      
      case '/api/records':
        if (method === 'POST') return await Store.createRecord(S.sid, body);
        return await Store.getRecords(S.sid);
      
      case '/api/analytics':
        return await Store.getAnalytics(S.sid);
      
      case '/api/report':
        return await Store.getReport(S.sid, params.get('from'), params.get('to'));
      
      case '/api/history':
        return await Store.getHistory(S.sid);
      
      case '/api/notifications':
        if (method === 'POST' && path.includes('read')) return await Store.markNotificationsRead(body.id);
        return await Store.getNotifications();
      
      case '/api/tools':
        if (method === 'POST') return await Store.createTool(body);
        return await Store.getTools();
      
      case '/api/tutor/students':
        return await Store.getTutorStudents();
      
      case '/api/admin/users':
        return await Store.getAdminUsers();
      
      default:
        // Handle dynamic routes with regex-like patterns
        if (endpoint.match(/^\/api\/stages\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateStage(id, body);
          if (method === 'DELETE') return await Store.deleteStage(id);
        }
        if (endpoint.match(/^\/api\/stages\/\d+\/move$/)) {
          return await Store.moveStage(+endpoint.split('/')[3], body.dir);
        }
        if (endpoint.match(/^\/api\/stages\/\d+\/milestones$/)) {
          return await Store.createMilestone(+endpoint.split('/')[3], body);
        }
        if (endpoint.match(/^\/api\/milestones\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateMilestone(id, body);
          if (method === 'DELETE') return await Store.deleteMilestone(id);
        }
        if (endpoint.match(/^\/api\/goals\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateGoal(id, body);
          if (method === 'DELETE') return await Store.deleteGoal(id);
        }
        if (endpoint.match(/^\/api\/tasks\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateTask(id, body);
          if (method === 'DELETE') return await Store.deleteTask(id);
        }
        if (endpoint.match(/^\/api\/tasks\/\d+\/comments$/)) {
          if (method === 'POST') return await Store.addTaskComment(+endpoint.split('/')[3], body);
          return await Store.getTaskComments(+endpoint.split('/')[3]);
        }
        if (endpoint.match(/^\/api\/events\/\d+$/)) {
          return await Store.deleteEvent(+endpoint.split('/').pop());
        }
        if (endpoint.match(/^\/api\/resources\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateResource(id, body);
          if (method === 'DELETE') return await Store.deleteResource(id);
        }
        if (endpoint.match(/^\/api\/library\/shared\/\d+$/)) {
          if (method === 'DELETE') return await Store.deleteSharedResource(+endpoint.split('/').pop());
        }
        if (endpoint.match(/^\/api\/reflections\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateReflection(id, body);
          if (method === 'DELETE') return await Store.deleteReflection(id);
        }
        if (endpoint.match(/^\/api\/reflection-questions\/\d+$/)) {
          return await Store.deleteReflectionQuestion(+endpoint.split('/').pop());
        }
        if (endpoint.match(/^\/api\/records\/\d+$/)) {
          return await Store.deleteRecord(+endpoint.split('/').pop());
        }
        if (endpoint.match(/^\/api\/tools\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateTool(id, body);
          if (method === 'DELETE') return await Store.deleteTool(id);
        }
        if (endpoint.match(/^\/api\/admin\/users\/\d+$/)) {
          const id = +endpoint.split('/').pop();
          if (method === 'PATCH') return await Store.updateAdminUser(id, body);
        }
        if (endpoint === '/api/admin/link') {
          return await Store.linkTutorStudent(body.tutor_id, body.student_id, body.unlink);
        }
        if (endpoint === '/api/tutor/students' && method === 'POST') {
          return await Store.createStudent(body);
        }
        if (endpoint === '/api/admin/users' && method === 'POST') {
          return await Store.updateAdminUser(0, body); // create user
        }
        if (endpoint === '/api/student-profile' && method === 'PATCH') {
          return await Store.updateStudentProfile(S.sid, body);
        }
        throw new Error('Unknown endpoint: ' + path);
    }
  } catch (e) {
    const err = new Error(e.message || 'Ошибка запроса');
    err.status = e.status || 500;
    throw err;
  }
}

/* ───── даты ───── */
const MONTHS = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const pd = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');
export const fmtD = (s) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const fmtDY = (s) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtT = (s) => (s && s.length >= 16 ? s.slice(11, 16) : '');
export const longToday = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export function ago(iso) {
  if (!iso) return 'нет активности';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'только что';
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  const d = Math.round(diff / 86400);
  if (d < 31) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return fmtDY(iso);
}
export const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
export const dayDiff = (a, b) => Math.round((pd(a) - pd(b)) / 864e5);
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/* ───── иконки ───── */
const IC = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  route: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.2 6H13a3.5 3.5 0 010 7h-2a3.5 3.5 0 000 5h4.8"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>',
  chart: '<path d="M4 20h16M7 17v-5M12 17V7M17 17v-8"/>',
  book: '<path d="M5 4h13v16H7a2 2 0 01-2-2zM5 18a2 2 0 012-2h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  bell: '<path d="M6 16v-5a6 6 0 1112 0v5l1.5 2h-15zM10 21h4"/>',
  tool: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 15c2.5.5 3.5 2.5 3.5 5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  book2: '<path d="M4 19V6a2 2 0 012-2h12v14H6a2 2 0 00-2 2zM8 8h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
};
export const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.tool}</svg>`;
export const iconNames = ['target', 'tool', 'chart', 'book', 'route', 'file'];

export const avatar = (p, cls = '') => p?.photo_url
  ? `<span class="avatar ${cls}"><img src="${esc(p.photo_url)}" alt="" referrerpolicy="no-referrer"></span>`
  : `<span class="avatar ${cls}">${esc(initials(p?.full_name || p?.name))}</span>`;

/* ───── теги ───── */
export const STATUS_CLS = { 'Не начато': '', 'В процессе': 'accent', 'На проверке': 'warn', 'Выполнено': 'ok', 'Отложено': '' };
export const statusTag = (s) => `<span class="tag ${STATUS_CLS[s] || ''}">${esc(s)}</span>`;
export const prioTag = (p) => (p === 'Критический' ? `<span class="tag danger">${esc(p)}</span>` : p === 'Высокий' ? `<span class="tag warn">${esc(p)}</span>` : p === 'Низкий' ? `<span class="tag">${esc(p)}</span>` : '');
export const PRIORITIES = ['Низкий', 'Обычный', 'Высокий', 'Критический'];
export const TASK_STATUSES = ['Не начато', 'В процессе', 'На проверке', 'Выполнено', 'Отложено'];
export const TASK_TYPES = ['Изучение материала', 'Практическое задание', 'Тестирование', 'Исследование', 'Подготовка проекта', 'Самостоятельная работа', 'Рефлексия', 'Консультация'];
export const GOAL_CATS = ['Академические', 'Профессиональные', 'Языковые', 'Личностное развитие', 'Исследовательские', 'Дополнительное образование'];

/* ───── прогресс ───── */
export const bar = (pct, cls = '') => `<div class="bar ${cls}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i data-w="${pct}"></i></div>`;
export function ring(pct, size = 150, stroke = 9) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="ring" style="--s:${size}px"><svg width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#1f2430" stroke-width="${stroke}"/>
    <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#5b8def" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - pct / 100)}" style="filter:drop-shadow(0 0 6px rgba(91,141,239,.55))"/></svg>
    <div class="num"><b>${pct}%</b><span class="xs muted">маршрут</span></div></div>`;
}

/* ───── графики (SVG) ───── */
export function barChart(items, { w = 560, h = 190, plan = false } = {}) {
  const pad = { l: 26, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...items.map((i) => Math.max(i.value, i.plan || 0)));
  const nice = Math.max(2, Math.ceil(max / 2) * 2);
  const iw = (w - pad.l - pad.r) / items.length, ih = h - pad.t - pad.b;
  const y = (v) => pad.t + ih - (v / nice) * ih;
  let g = '';
  for (let i = 0; i <= 2; i++) { const v = (nice / 2) * i; g += `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
  const bw = Math.min(26, iw * (plan ? 0.34 : 0.55));
  items.forEach((it, k) => {
    const cx = pad.l + iw * k + iw / 2;
    if (plan) {
      g += `<rect class="bar-rect plan" x="${cx - bw - 1}" y="${y(it.plan || 0)}" width="${bw}" height="${ih - (y(it.plan || 0) - pad.t)}" rx="2" style="animation-delay:${k * 40}ms"><title>Запланировано: ${it.plan || 0}</title></rect>`;
      g += `<rect class="bar-rect" x="${cx + 1}" y="${y(it.value)}" width="${bw}" height="${ih - (y(it.value) - pad.t)}" rx="2" style="animation-delay:${k * 40 + 60}ms"><title>Выполнено: ${it.value}</title></rect>`;
    } else g += `<rect class="bar-rect" x="${cx - bw / 2}" y="${y(it.value)}" width="${bw}" height="${ih - (y(it.value) - pad.t)}" rx="3" style="animation-delay:${k * 50}ms"><title>${esc(it.label)}: ${it.value}</title></rect>`;
    if (items.length <= 12 || k % 2 === 0) g += `<text x="${cx}" y="${h - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Столбчатая диаграмма">${g}</svg>`;
}
export function lineChart(items, { w = 560, h = 190, max = 100, unit = '%' } = {}) {
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = (w - pad.l - pad.r) / Math.max(1, items.length - 1), ih = h - pad.t - pad.b;
  const y = (v) => pad.t + ih - (v / max) * ih, x = (k) => pad.l + iw * k;
  let g = '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8def" stop-opacity=".35"/><stop offset="1" stop-color="#5b8def" stop-opacity="0"/></linearGradient></defs>';
  [0, max / 2, max].forEach((v) => { g += `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}${unit}</text>`; });
  const pts = items.map((it, k) => `${x(k).toFixed(1)},${y(it.value).toFixed(1)}`);
  const len = Math.ceil(items.reduce((a, _, k) => (k ? a + Math.hypot(iw, y(items[k].value) - y(items[k - 1].value)) : 0), 0)) + 20;
  g += `<polygon class="area" points="${x(0)},${y(0)} ${pts.join(' ')} ${x(items.length - 1)},${y(0)}"/>`;
  g += `<polyline class="line" style="--len:${len}" points="${pts.join(' ')}"/>`;
  items.forEach((it, k) => {
    g += `<circle cx="${x(k)}" cy="${y(it.value)}" r="3" fill="#08090b" stroke="#5b8def" stroke-width="1.8"><title>${esc(it.label)}: ${it.value}${unit}</title></circle>`;
    if (k % 2 === 0 || items.length < 8) g += `<text x="${x(k)}" y="${h - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Линейный график">${g}</svg>`;
}

/* ───── уведомления, модальные окна ───── */
export function toast(msg, isErr = false) {
  const el = document.createElement('div'); el.className = 'toast' + (isErr ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), isErr ? 5200 : 3400);
}

export function modal({ title, body, wide = false, onMount }) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="x" type="button" aria-label="Закрыть">×</button></div><div class="modal-body">${body}</div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('.x', ov).onclick = close; document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  const first = $('input:not([type=checkbox]),textarea,select', ov); first && !matchMedia('(max-width:640px)').matches && first.focus();
  onMount && onMount(ov, close);
  return { close, el: ov };
}

export function fieldHtml(f) {
  const v = f.value ?? '';
  const id = 'f_' + f.name;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 5000}">${esc(v)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.name}" ${f.required ? 'required' : ''}>${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else if (f.type === 'checkbox') return `<div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span style="color:var(--color-text-primary);font-weight:500">${esc(f.label)}</span></label></div>`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null && f.type === 'number' ? `max="${f.max}"` : ''} maxlength="${f.type === 'number' ? 10 : f.max || 300}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<span class="xs muted">${esc(f.hint)}</span>` : ''}</div>`;
}
export function readForm(form, fields) {
  const o = {};
  for (const f of fields) {
    const el = form.elements[f.name]; if (!el) continue;
    o[f.name] = f.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
export function formModal({ title, fields, submit = 'Сохранить', onSubmit, wide = false, footer = '' }) {
  const rows = []; let i = 0;
  while (i < fields.length) { if (fields[i].half && fields[i + 1]?.half) { rows.push(`<div class="field-row">${fieldHtml(fields[i])}${fieldHtml(fields[i + 1])}</div>`); i += 2; } else rows.push(fieldHtml(fields[i++])); }
  return modal({
    title, wide, body: `<form novalidate>${rows.join('')}<p class="err" hidden></p><div class="row sb wrap" style="margin-top:6px"><div>${footer}</div><button class="btn primary" type="submit">${esc(submit)}</button></div></form>`,
    onMount(ov, close) {
      const form = $('form', ov), err = $('.err', ov);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        const btn = $('button[type=submit]', form); btn.disabled = true;
        try { await onSubmit(readForm(form, fields), close); } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
      });
    },
  });
}
export function confirmBox(text, okLabel = 'Удалить') {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title: 'Подтвердите действие', body: `<p>${esc(text)}</p><div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn" data-n>Отмена</button><button class="btn danger" data-y>${esc(okLabel)}</button></div>`,
      onMount(ov, close) { $('[data-n]', ov).onclick = () => { done = true; close(); res(false); }; $('[data-y]', ov).onclick = () => { done = true; close(); res(true); }; } });
    new MutationObserver((_, ob) => { if (!document.body.contains(m.el)) { ob.disconnect(); if (!done) res(false); } }).observe(document.body, { childList: true });
  });
}

export const empty = (text, ic = 'file') => `<div class="empty">${icon(ic, 34)}<div>${esc(text)}</div></div>`;
export const nl2 = (s) => esc(s).replace(/\n/g, '<br>');
export const linkTag = (u) => (u ? `<a class="small" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('link', 14)} Открыть ресурс</a>` : '');

/* после отрисовки: заполнение прогресс-баров, колец, появление блоков */
let io;
export function postRender(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.bar>i[data-w]', root).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    $$('circle.fg[data-off]', root).forEach((c) => { c.style.strokeDashoffset = c.dataset.off; });
  }));
  if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.06 });
  $$('.reveal:not(.in)', root).forEach((el, i) => { el.style.transitionDelay = Math.min(i * 50, 250) + 'ms'; io.observe(el); });
}

export const nowHour = () => Number(new Date().toLocaleString('ru-RU', { hour: '2-digit', hour12: false, timeZone: 'Europe/Moscow' }).slice(0, 2)) % 24;