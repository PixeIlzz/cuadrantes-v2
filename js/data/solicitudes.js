// Solicitudes de vacaciones y cambios. v12
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* --- Empleado --- */

/* Comprueba en el servidor si el negocio tiene las solicitudes activas.
   Evita el caso de un empleado con la app abierta y la config vieja. */
export async function solicitudesActivas() {
  const { data, error } = await sb
    .from('businesses')
    .select('config')
    .eq('id', ctx.business.id)
    .single();
  if (error) return true;   // ante la duda, no bloqueamos
  return !(data && data.config && data.config.solicitudes_activas === false);
}

export async function crearSolicitud({ tipo, desde, hasta, mensaje }) {
  // Verificación fresca contra el servidor, no contra la config cargada
  const activas = await solicitudesActivas();
  if (!activas) {
    throw new Error('Las solicitudes están desactivadas ahora mismo. '
      + 'Habla con tu responsable si necesitas pedir algo.');
  }
  const { data, error } = await sb
    .from('requests')
    .insert({
      business_id: ctx.business.id,
      worker_id: ctx.workerId,
      type: tipo,
      status: 'pending',
      start_date: desde || null,
      end_date: hasta || null,
      message: mensaje || null,
    })
    .select('id, type, status, start_date, end_date, message, manager_note, created_at, resolved_at')
    .single();
  if (error) throw new Error('No se pudo enviar: ' + error.message);
  return data;
}

export async function misSolicitudes() {
  if (!ctx.workerId) return [];   // sin ficha enlazada no hay solicitudes propias
  const { data, error } = await sb
    .from('requests')
    .select('id, type, status, start_date, end_date, message, manager_note, created_at, resolved_at')
    .eq('worker_id', ctx.workerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Solicitudes: ' + error.message);
  return data || [];
}

/* Una solicitud pendiente se puede retirar (RLS: solo las propias) */
export async function retirarSolicitud(id) {
  const { error } = await sb.from('requests').delete().eq('id', id);
  if (error) throw new Error('No se pudo retirar: ' + error.message);
}

/* --- Gestor --- */

export async function solicitudesDelNegocio(estado = null) {
  let q = sb
    .from('requests')
    .select('id, worker_id, type, status, start_date, end_date, message, manager_note, created_at, resolved_at')
    .eq('business_id', ctx.business.id)
    .order('created_at', { ascending: false });
  if (estado) q = q.eq('status', estado);
  const { data, error } = await q;
  if (error) throw new Error('Solicitudes: ' + error.message);
  return data || [];
}

export async function contarPendientes() {
  const { count, error } = await sb
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.business.id)
    .eq('status', 'pending');
  if (error) return 0;
  return count || 0;
}

export async function resolverSolicitud(id, aprobar, nota) {
  const { error } = await sb.rpc('resolve_request', {
    p_request: id, p_approve: aprobar, p_note: nota || null,
  });
  if (error) throw new Error('No se pudo resolver: ' + error.message);
}

/* Semanas ya programadas/publicadas que se solapan: aviso antes de aprobar */
export async function semanasAfectadas(desde, hasta) {
  const { data, error } = await sb.rpc('weeks_overlapping', {
    p_business: ctx.business.id, p_from: desde, p_to: hasta || desde,
  });
  if (error) return [];
  return data || [];
}
