// Códigos de invitación de empleados. v9
import { sb } from '../supabase.js?v=18';

export async function generarCodigo(workerId, dias = 30) {
  const { data, error } = await sb.rpc('create_invite', {
    p_worker: workerId, p_dias: dias,
  });
  if (error) throw new Error('No se pudo generar el código: ' + error.message);
  return data;
}

export async function codigoVivo(workerId) {
  const { data, error } = await sb.rpc('get_invite', { p_worker: workerId });
  if (error) return null;
  return (data && data.length) ? data[0] : null;
}

export async function canjearCodigo(codigo) {
  const { data, error } = await sb.rpc('redeem_invite', { p_code: codigo });
  if (error) throw new Error(traducir(error.message));
  return data;   // business_id
}

export async function desvincular(workerId) {
  const { error } = await sb.rpc('unlink_worker', { p_worker: workerId });
  if (error) throw new Error('No se pudo desvincular: ' + error.message);
}

function traducir(msg) {
  if (/no válido/i.test(msg)) return 'Ese código no existe. Revísalo con tu responsable.';
  if (/ya se ha usado/i.test(msg)) return 'Ese código ya se ha usado. Pide uno nuevo.';
  if (/caducado/i.test(msg)) return 'Ese código ha caducado. Pide uno nuevo.';
  return msg;
}
