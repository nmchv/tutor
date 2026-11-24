import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ───── Supabase клиент для статического сайта ─────
   Укажите свои URL и anon-ключ проекта Supabase.
   Получить их можно в Supabase Dashboard → Project Settings → API.
*/
const SUPABASE_URL = 'https://ВАШ-ПРОЕКТ.supabase.co';
const SUPABASE_ANON_KEY = 'ВАШ_ANON_КЛЮЧ';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export { SUPABASE_URL, SUPABASE_ANON_KEY };
