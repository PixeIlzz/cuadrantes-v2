// Acceso a datos del equipo (workers + vacations). Sin interfaz aquí.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

export async function listarEquipo() {
  const biz = ctx.business.id;

  const { data: workers, error: e1 } = await sb
    .from('workers')
    .select('id, name, weekly_shifts, sort_order, full_name')
    .eq('business_id', biz)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (e1) throw new Error('Equipo: ' + e1.message);

  /* NIF y nº de Seguridad Social van aparte: desde la migración 42 esas
     columnas están cerradas al cliente, porque la RLS es por fila y no
     limitaba columnas —cualquier empleado podía leerlas, y también el
     pin_hash—. La RPC comprueba is_manager, así que al empleado le llega
     un error que aquí se ignora y se queda sin esos campos. */
  const legales = {};
  const { data: dl } = await sb.rpc('equipo_datos_legales', { p_business_id: biz });
  for (const d of (dl || [])) legales[d.worker_id] = d;

  const { data: vacs, error: e2 } = await sb
    .from('vacations')
    .select('id, worker_id, start_date, end_date, note, source')
    .eq('business_id', biz)
    .order('start_date', { ascending: true });
  if (e2) throw new Error('Vacaciones: ' + e2.message);

  const porTrabajador = {};
  for (const v of vacs || []) {
    (porTrabajador[v.worker_id] ||= []).push(v);
  }
  return (workers || []).map((w) => ({
    ...w,
    nif: (legales[w.id] || {}).nif || null,
    nss: (legales[w.id] || {}).nss || null,
    vacs: porTrabajador[w.id] || [],
  }));
}

export async function crearTrabajador(name, weeklyShifts, sortOrder) {
  const { data, error } = await sb
    .from('workers')
    .insert({
      business_id: ctx.business.id,
      name,
      weekly_shifts: weeklyShifts,
      sort_order: sortOrder,
    })
    .select('id, name, weekly_shifts, sort_order')
    .single();
  if (error) throw new Error('No se pudo crear: ' + error.message);
  return { ...data, vacs: [] };
}

export async function actualizarTrabajador(id, campos) {
  const { error } = await sb.from('workers').update(campos).eq('id', id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

/* Reinicia el PIN del kiosco: lo BORRA para que el trabajador ponga otro.
   No se fija uno nuevo desde fuera, así nadie más llega a conocerlo.
   Levanta también el bloqueo por intentos fallidos (migración 48). */
export async function resetearPin(workerId) {
  const { error } = await sb.rpc('resetear_pin', { p_worker_id: workerId });
  if (error) throw new Error('No se pudo reiniciar el PIN: ' + error.message);
}

export async function borrarTrabajador(id) {
  const { error } = await sb.from('workers').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar: ' + error.message);
}

export async function crearVacacion(workerId, desde, hasta, nota = null) {
  const { data, error } = await sb
    .from('vacations')
    .insert({
      business_id: ctx.business.id,
      worker_id: workerId,
      start_date: desde,
      end_date: hasta,
      note: nota,
      source: 'manager',
    })
    .select('id, worker_id, start_date, end_date, note, source')
    .single();
  if (error) throw new Error('No se pudo guardar el periodo: ' + error.message);
  return data;
}

export async function actualizarVacacion(id, campos) {
  const { error } = await sb.from('vacations').update(campos).eq('id', id);
  if (error) throw new Error('No se pudo guardar el periodo: ' + error.message);
}

export async function borrarVacacion(id) {
  const { error } = await sb.from('vacations').delete().eq('id', id);
  if (error) throw new Error('No se pudo quitar el periodo: ' + error.message);
}
