// Sesión y contexto. v7
import { sb } from './supabase.js?v=8';

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
