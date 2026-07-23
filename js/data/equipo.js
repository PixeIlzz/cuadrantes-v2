// Acceso a datos del equipo (workers + vacations). Sin interfaz aquí.
import { sb } from '../supabase.js?v=8';
import { ctx } from '../auth.js?v=8';

export async function listarEquipo() {
  const biz = ctx.business.id;

  const { data: workers, error: e1 } = await sb
    .from('workers')
    .select('id, name, weekly_shifts, sort_order')
    .eq('business_id', biz)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (e1) throw new Error('Equipo: ' + e1.message);

  const { data: vacs, error: e2 } = await sb
    .from('vacations')
    .select('id, worker_id, start_date, end_date')
    .eq('business_id', biz)
    .order('start_date', { ascending: true });
  if (e2) throw new Error('Vacaciones: ' + e2.message);

  const porTrabajador = {};
  for (const v of vacs || []) {
    (porTrabajador[v.worker_id] ||= []).push(v);
  }
  return (workers || []).map((w) => ({ ...w, vacs: porTrabajador[w.id] || [] }));
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

export async function borrarTrabajador(id) {
  const { error } = await sb.from('workers').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar: ' + error.message);
}

export async function crearVacacion(workerId, desde, hasta) {
  const { data, error } = await sb
    .from('vacations')
    .insert({
      business_id: ctx.business.id,
      worker_id: workerId,
      start_date: desde,
      end_date: hasta,
      source: 'manager',
    })
    .select('id, worker_id, start_date, end_date')
    .single();
  if (error) throw new Error('No se pudo guardar el periodo: ' + error.message);
  return data;
}

export async function actualizarVacacion(id, desde, hasta) {
  const { error } = await sb
    .from('vacations')
    .update({ start_date: desde, end_date: hasta })
    .eq('id', id);
  if (error) throw new Error('No se pudo guardar el periodo: ' + error.message);
}

export async function borrarVacacion(id) {
  const { error } = await sb.from('vacations').delete().eq('id', id);
  if (error) throw new Error('No se pudo quitar el periodo: ' + error.message);
}
