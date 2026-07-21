// Sesión, rol y negocio activo. Nada de interfaz aquí.
import { sb } from './supabase.js';

// Contexto de la sesión actual. Lo rellena loadContext().
export const ctx = {
  user: null,        // usuario de Supabase Auth
  business: null,    // {id, name, config}
  role: null,        // 'manager' | 'employee'
  workerId: null,    // ficha de trabajador enlazada (null si es gestor puro)
};

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(traducirError(error.message));
  return data.user;
}

export async function signOut() {
  await sb.auth.signOut();
  ctx.user = null;
  ctx.business = null;
  ctx.role = null;
  ctx.workerId = null;
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/* Carga negocio y rol del usuario logueado.
   Devuelve false si la sesión es válida pero no pertenece a ningún negocio. */
export async function loadContext() {
  const session = await getSession();
  if (!session) return false;
  ctx.user = session.user;

  const { data, error } = await sb
    .from('memberships')
    .select('role, businesses ( id, name, config )')
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return false;

  ctx.role = data[0].role;
  ctx.business = data[0].businesses;

  // Si es empleado, buscamos su ficha para "mis turnos" y sus solicitudes.
  if (ctx.role === 'employee') {
    const { data: w } = await sb
      .from('workers')
      .select('id')
      .eq('business_id', ctx.business.id)
      .eq('profile_id', ctx.user.id)
      .maybeSingle();
    ctx.workerId = w ? w.id : null;
  }
  return true;
}

// Reacciona a login/logout abiertos en otra pestaña o a la caducidad del token.
export function onAuthChange(cb) {
  sb.auth.onAuthStateChange((event) => cb(event));
}

function traducirError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Falta confirmar el email.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}
