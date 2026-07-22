// Cliente de Supabase. Único punto donde viven las claves.
// Ambas son públicas por diseño: la seguridad real la pone RLS en la base de datos.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://vheebrkmgptruprxiaxu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-rBNkb2CA-xaUSpN7HBNzg_jTTLWG3Q';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // El candado por defecto (navigator.locks) tiene un bug conocido que deja
    // colgadas las llamadas de auth en algunos arranques. Lo sustituimos por
    // uno que ejecuta directamente. Coste: si abres la app en varias pestañas
    // a la vez, en teoría podrían pisarse al renovar el token; en la práctica
    // la renovación es idempotente y no da problemas.
    lock: async (_name, _timeout, fn) => await fn(),
  },
});
