import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL и SUPABASE_ANON_KEY должны быть заданы в переменных окружения');
}

/**
 * Создаёт клиент Supabase от имени пользователя.
 * accessToken — JWT из подтверждённой сессии Supabase Auth.
 * Все запросы выполняются с правами этого пользователя (RLS применяется).
 */
export function createSupabaseClient(accessToken) {
  const options = {};
  if (accessToken) {
    options.headers = { Authorization: `Bearer ${accessToken}` };
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
}

/**
 * Возвращает пользователя из подтверждённой сессии Supabase Auth (JWT).
 * Возвращает null, если сессия недействительна или истекла.
 */
export async function getUserFromToken(accessToken) {
  const sb = createSupabaseClient(accessToken);
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return null;
  return user;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
