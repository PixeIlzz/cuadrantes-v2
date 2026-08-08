// Acceso a datos del kiosco. Corre con la clave anónima (la tablet no
// inicia sesión). La seguridad la ponen el device_token y el PIN. v1
import { sb } from '../supabase.js';

/* La tablet consulta su token tras el emparejamiento (o null si aún no). */
export async function reclamarToken(nonce) {
  const { data, error } = await sb.rpc('reclamar_token', { p_nonce: nonce });
  if (error) throw new Error(error.message);
  return data; // token o null
}

/* El gestor (logueado) vincula el kiosco a uno de sus negocios. */
export async function vincularKiosco(nonce, businessId, nombre) {
  const { error } = await sb.rpc('vincular_kiosco', {
    p_nonce: nonce, p_business_id: businessId, p_nombre: nombre,
  });
  if (error) throw new Error(error.message);
}

/* Equipo a mostrar en la rejilla del kiosco (por su device_token). */
export async function equipoKiosco(token) {
  const { data, error } = await sb.rpc('kiosco_equipo', { p_device_token: token });
  if (error) throw new Error(error.message);
  return data || [];
}

/* Fichar desde el kiosco. La Edge Function añade la IP real y valida todo.
   Devuelve { ok, tipo, momento } o lanza un código de error corto. */
export async function ficharKiosco(token, workerId, pin) {
  const { data, error } = await sb.functions.invoke('fichar-kiosco', {
    body: { device_token: token, worker_id: workerId, pin },
  });
  if (error) {
    // El cuerpo del error trae { error: 'CODIGO' }
    let code = 'ERROR';
    try { const b = await error.context.json(); code = b.error || code; } catch (_) {}
    throw new Error(code);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* Negocios donde soy gestor (para el selector al vincular). */
export async function negociosGestor() {
  const { data, error } = await sb
    .from('memberships')
    .select('business_id, businesses(name)')
    .eq('role', 'manager');
  if (error) throw new Error(error.message);
  return (data || []).map((m) => ({
    id: m.business_id,
    name: (m.businesses && m.businesses.name) || 'Mi negocio',
  }));
}

/* El empleado (logueado) fija o cambia su PIN. */
export async function ponerMiPin(businessId, pin) {
  const { error } = await sb.rpc('set_mi_pin', { p_business_id: businessId, p_pin: pin });
  if (error) throw new Error(error.message);
}

/* ¿Tengo PIN puesto? (para la UI). */
export async function tengoPin(businessId) {
  const { data, error } = await sb.rpc('tengo_pin', { p_business_id: businessId });
  if (error) throw new Error(error.message);
  return data === true;
}
