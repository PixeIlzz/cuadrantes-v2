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

/* Ficha completa de una empresa: cuentas, equipo, kioscos, actividad y el
   historial de soporte. Sin NIF, sin NSS y sin PIN: para diagnosticar no
   hacen falta, y son datos personales de gente que no es cliente tuya. */
export async function detalleNegocio(businessId) {
  const { data, error } = await sb.rpc('admin_negocio_detalle', {
    p_business_id: businessId,
  });
  if (error) throw new Error('Detalle: ' + error.message);
  return data || null;
}

/* Abre una sesión de soporte. Caduca sola y avisa al gestor. */
export async function abrirSoporte(businessId, motivo, minutos = 60) {
  const { error } = await sb.rpc('soporte_abrir', {
    p_business_id: businessId, p_motivo: motivo, p_minutos: minutos,
  });
  if (error) throw new Error(error.message);
}

/* Copia completa de una empresa. Sirve de red antes de borrarla, para
   entregársela a un cliente que se va, y como copia manual mientras no
   haya plan con recuperación a un punto en el tiempo. */
export async function exportarNegocio(businessId) {
  const { data, error } = await sb.rpc('admin_exportar_negocio', {
    p_business_id: businessId,
  });
  if (error) throw new Error('No se pudo exportar: ' + error.message);
  return data;
}

/* ¿Tengo una sesión de soporte viva sobre este negocio? Lo decide el
   servidor: es lo mismo que consulta la RLS para darme acceso. */
export async function soporteActivo(businessId) {
  const { data, error } = await sb.rpc('soporte_activo', { p_business_id: businessId });
  if (error) return false;
  return data === true;
}

export async function cerrarSoporte(businessId) {
  const { error } = await sb.rpc('soporte_cerrar', { p_business_id: businessId });
  if (error) throw new Error(error.message);
}

/* Archivar: el cliente se fue. Conserva datos, sale de la lista operativa. */
export async function archivarNegocio(businessId, archivar) {
  const { error } = await sb.rpc('admin_archivar_negocio', {
    p_business_id: businessId, p_archivar: archivar,
  });
  if (error) throw new Error('No se pudo archivar: ' + error.message);
}

/* Eliminar de verdad. Devuelve {ok, error, fichajes} — los errores vienen
   como dato, no como excepción, para poder pedir la confirmación extra. */
export async function eliminarNegocio(businessId, confirmacion, forzar = false) {
  const { data, error } = await sb.rpc('admin_eliminar_negocio', {
    p_business_id: businessId, p_confirmacion: confirmacion, p_forzar: forzar,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, error: 'Sin respuesta del servidor.' };
}

/* Sesiones de soporte mías que siguen vivas */
export async function misSesionesSoporte() {
  const { data, error } = await sb.rpc('soporte_mis_sesiones');
  if (error) return [];
  return data || [];
}
