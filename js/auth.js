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

/* Envía el correo de recuperación. La URL de vuelta apunta a la propia app
   con el marcador #recuperar, que el arranque detecta. */
/* Supabase dispara PASSWORD_RECOVERY cuando el usuario vuelve del enlace
   del correo. Es más fiable que leer la URL a mano. */
export function alRecuperarPassword(callback) {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') callback();
  });
}

export async function pedirRecuperacion(email) {
  const destino = location.origin + location.pathname + '#recuperar';
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: destino,
  });
  if (error) throw new Error(traducirRecuperacion(error.message));
}

export async function cambiarPassword(nueva) {
  const { error } = await sb.auth.updateUser({ password: nueva });
  if (error) throw new Error(error.message);
}

function traducirRecuperacion(msg) {
  if (/rate limit|too many/i.test(msg))
    return 'Se han pedido demasiados correos. Espera unos minutos.';
  if (/not authorized|not allowed/i.test(msg))
    return 'El servicio de correo todavía no está configurado. Avisa a tu responsable.';
  return msg;
}

function traducirRegistro(msg) {
  if (/already registered|already been registered/i.test(msg))
    return 'Ya existe una cuenta con ese email. Inicia sesión.';
  if (/password/i.test(msg) && /6|short|length/i.test(msg))
    return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}
