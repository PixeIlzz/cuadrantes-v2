// Cliente de Supabase. Único punto donde viven las claves. v5
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://vheebrkmgptruprxiaxu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-rBNkb2CA-xaUSpN7HBNzg_jTTLWG3Q';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Candado no bloqueante: evita el deadlock conocido de navigator.locks
    lock: async (_name, _timeout, fn) => await fn(),
  },
});
