// Sesión y contexto. v7
import { sb } from './supabase.js';

export const ctx = { user: null, business: null, role: null, workerId: null };

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(), password,
  });
  if (error) throw new Error(traducirError(error.message));
  return data.session;
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signOut() {
  try { await sb.auth.signOut(); } catch (_) {}
  try {
    const k = Object.keys(localStorage).find(
      (x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
    if (k) localStorage.removeItem(k);
  } catch (_) {}
}

function traducirError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Falta confirmar el email.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}

/* Registro de empleado. Con la confirmación de email desactivada,
   signUp ya devuelve sesión iniciada. */
export async function signUp(email, password, nombre) {
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: nombre } },
  });
  if (error) throw new Error(traducirRegistro(error.message));
  if (!data.session) {
    // Si algún día se activa la confirmación por email, avisamos con claridad
    throw new Error('Cuenta creada. Confirma tu email y vuelve a entrar.');
  }
  return data.session;
}

function traducirRegistro(msg) {
  if (/already registered|already been registered/i.test(msg))
    return 'Ya existe una cuenta con ese email. Inicia sesión.';
  if (/password/i.test(msg) && /6|short|length/i.test(msg))
    return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}
