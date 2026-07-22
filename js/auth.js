// Sesión, rol y negocio activo. Nada de interfaz aquí.
// v4 — llamadas de auth protegidas con timeout: si la librería se cuelga
// (bug conocido de supabase-js en algunos navegadores), seguimos sin ella.
import { sb } from './supabase.js?v=4';

export const ctx = {
  user: null,
  business: null,
  role: null,
  workerId: null,
};

const TIMEOUT_MS = 2500;

function conTimeout(promesa, etiqueta) {
  return Promise.race([
    promesa,
    new Promise((resolve) =>
      setTimeout(() => resolve({ __timeout: true, etiqueta }), TIMEOUT_MS)
    ),
  ]);
}

/* Login. Devuelve la sesión directamente de la respuesta,
   sin depender de getSession() después. */
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(traducirError(error.message));
  return data.session; // trae access_token y user
}

export async function signOut() {
  try {
    await conTimeout(sb.auth.signOut(), 'signOut');
  } catch (_) { /* da igual: borramos local y recargamos */ }
  try {
    const k = claveSesionLocal();
    if (k) localStorage.removeItem(k);
  } catch (_) {}
  ctx.user = null; ctx.business = null; ctx.role = null; ctx.workerId = null;
}

/* Sesión actual. Primero por la librería (con timeout);
   si se cuelga, leemos directamente lo que guardó en localStorage. */
export async function getSession() {
  const res = await conTimeout(sb.auth.getSession(), 'getSession');
  if (!res.__timeout) {
    console.log('[auth] getSession respondió normal');
    return res.data.session;
  }
  console.warn('[auth] getSession se colgó → leyendo sesión de localStorage');
  return sesionDesdeLocalStorage();
}

function claveSesionLocal() {
  try {
    return Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
    ) || null;
  } catch (_) { return null; }
}

function sesionDesdeLocalStorage() {
  try {
    const k = claveSesionLocal();
    if (!k) return null;
    const s = JSON.parse(localStorage.getItem(k));
    if (!s || !s.access_token || !s.user) return null;
    // Si el token está caducado, no sirve: mejor volver al login.
    if (s.expires_at && s.expires_at * 1000 < Date.now()) return null;
    return s;
  } catch (_) { return null; }
}

export function onAuthChange(cb) {
  sb.auth.onAuthStateChange((event) => cb(event));
}

function traducirError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Falta confirmar el email.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}
