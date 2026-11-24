import { createSupabaseClient } from './supabase.js';

export const TZ = process.env.APP_TZ || 'Europe/Moscow';

export const nowIso = () => new Date().toISOString();
export const todayStr = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
};

/**
 * Создаёт клиент Supabase от имени пользователя (JWT).
 * Все запросы через этот клиент выполняются с правами пользователя (RLS).
 */
export function client(accessToken) {
  return createSupabaseClient(accessToken);
}

/* ───────── обёртки над Supabase ───────── */

class DbError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function check(error, status = 500) {
  if (error) throw new DbError(error.message || 'Ошибка базы данных', status);
  return null;
}

/**
 * SELECT с фильтрами, сортировкой и лимитом.
 * filters: { col: val, col2: null (IS NULL), col3: ['a','b'] (IN) }
 * opts: { order, asc, limit, single }
 */
export async function select(sb, table, filters = {}, opts = {}) {
  let q = sb.from(table).select(opts.columns || '*', { count: opts.count ? 'exact' : 'estimated' });
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) q = q.is(key, null);
    else if (Array.isArray(value)) q = q.in(key, value);
    else q = q.eq(key, value);
  }
  if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.single) q = q.single();
  const { data, error, count } = await q;
  check(error);
  return opts.count ? { rows: data || [], count } : (opts.single ? (data || null) : (data || []));
}

/**
 * Получить одну строку по фильтрам.
 */
export async function get(sb, table, filters) {
  return select(sb, table, filters, { single: true });
}

/**
 * Вставить строку, вернуть вставленную.
 */
export async function insert(sb, table, data) {
  const { data: inserted, error } = await sb.from(table).insert(data).select().single();
  check(error);
  return inserted;
}

/**
 * Обновить строку по id, вернуть обновлённую.
 */
export async function update(sb, table, id, data) {
  const { data: updated, error } = await sb.from(table).update(data).eq('id', id).select().single();
  check(error);
  return updated;
}

/**
 * Удалить строку по id.
 */
export async function remove(sb, table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  check(error);
  return { ok: true };
}

/**
 * Удалить по фильтру.
 */
export async function removeWhere(sb, table, filters) {
  let q = sb.from(table).delete();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) q = q.is(key, null);
    else q = q.eq(key, value);
  }
  const { error } = await q;
  check(error);
  return { ok: true };
}

/** Экспортируем для совместимости со старым кодом (имя createSupabaseClient) */
export { createSupabaseClient } from './supabase.js';
