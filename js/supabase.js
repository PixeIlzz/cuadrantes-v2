// Cliente de Supabase. Único punto donde viven las claves. v8
//
// supabase-js NO se importa: se carga con una etiqueta <script> desde
// js/vendor/ y deja el global window.supabase. Es a propósito — su versión
// ESM son 6 KB de fachada que se traen seis subpaquetes más del CDN, así que
// no se puede alojar. El paquete UMD sí viene entero. Ver js/vendor/README.md.
//
// Las etiquetas <script> clásicas se ejecutan durante el análisis del HTML y
// los módulos quedan diferidos al final, así que aquí el global ya existe.
const { createClient } = window.supabase;

const SUPABASE_URL = 'https://vheebrkmgptruprxiaxu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-rBNkb2CA-xaUSpN7HBNzg_jTTLWG3Q';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    lock: async (_name, _timeout, fn) => await fn(),
  },
});
