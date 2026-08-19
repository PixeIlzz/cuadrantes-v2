// Datos del panel de plataforma: las empresas y los códigos de alta.
// Todo pasa por RPC con es_admin comprobado en el servidor; aquí no hay
// ninguna consulta directa a tablas, porque `altas` no tiene políticas RLS.
import { sb } from '../supabase.js';

/* ¿Soy administrador de la plataforma? (no de un negocio) */
export async function soyAdmin() {
  const { data, error } = await sb.rpc('soy_admin');
  if (error) return false;
  return data === true;
}

/* Todas las empresas con sus cifras */
export async function listarNegocios() {
  const { data, error } = await sb.rpc('admin_negocios');
  if (error) throw new Error('Empresas: ' + error.message);
  return data || [];
}

/* Suspender (false) o reactivar (true). No borra datos. */
export async function cambiarEstadoNegocio(businessId, activo) {
  const { error } = await sb.rpc('admin_estado_negocio', {
    p_business_id: businessId, p_activo: activo,
  });
  if (error) throw new Error('No se pudo cambiar el estado: ' + error.message);
}

/* Emite un código de alta. Devuelve el código. */
export async function crearCodigoAlta(nota, dias = 90) {
  const { data, error } = await sb.rpc('crear_codigo_alta', {
    p_nota: nota || null, p_dias: dias,
  });
  if (error) throw new Error('No se pudo emitir el código: ' + error.message);
  return data;
}

/* Códigos emitidos, con a quién iban y si se usaron */
export async function listarCodigosAlta() {
  const { data, error } = await sb.rpc('codigos_alta');
  if (error) throw new Error('Códigos: ' + error.message);
  return data || [];
}
