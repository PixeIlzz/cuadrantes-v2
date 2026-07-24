// Tareas / checklist del negocio.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

export const hoyIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

export async function listarTareas(soloActivas = true) {
  let q = sb.from('tasks')
    .select('id, title, detail, repeat_type, repeat_days, due_date, active, sort_order, created_at')
    .eq('business_id', ctx.business.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (soloActivas) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error('Tareas: ' + error.message);
  return data || [];
}

export async function crearTarea(campos) {
  const { data, error } = await sb.from('tasks')
    .insert({ ...campos, business_id: ctx.business.id, created_by: ctx.user.id })
    .select('id, title, detail, repeat_type, repeat_days, due_date, active, sort_order, created_at')
    .single();
  if (error) throw new Error('No se pudo crear la tarea: ' + error.message);
  return data;
}

export async function actualizarTarea(id, campos) {
  const { error } = await sb.from('tasks').update(campos).eq('id', id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

export async function borrarTarea(id) {
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar: ' + error.message);
}

/* Marcas de completado en un rango de fechas */
export async function completadas(desde, hasta) {
  const { data, error } = await sb.from('task_completions')
    .select('task_id, done_date, done_at')
    .eq('business_id', ctx.business.id)
    .gte('done_date', desde)
    .lte('done_date', hasta);
  if (error) throw new Error('Tareas hechas: ' + error.message);
  return data || [];
}

export async function marcarHecha(taskId, fecha) {
  const { error } = await sb.from('task_completions')
    .insert({
      task_id: taskId,
      business_id: ctx.business.id,
      done_date: fecha,
      done_by: ctx.user.id,
    });
  if (error && !/duplicate|unique/i.test(error.message)) {
    throw new Error('No se pudo marcar: ' + error.message);
  }
}

export async function desmarcar(taskId, fecha) {
  const { error } = await sb.from('task_completions')
    .delete().eq('task_id', taskId).eq('done_date', fecha);
  if (error) throw new Error('No se pudo desmarcar: ' + error.message);
}

/* ¿Toca esta tarea en esta fecha? */
export function tocaHoy(t, iso) {
  if (!t.active) return false;
  if (t.repeat_type === 'daily') return true;
  if (t.repeat_type === 'weekly') {
    const dow = new Date(iso + 'T12:00:00').getDay();   // 0=domingo
    return (t.repeat_days || []).includes(dow);
  }
  // 'once': el día señalado, o arrastrada si ya pasó y sigue sin hacerse
  if (!t.due_date) return true;
  return t.due_date <= iso;
}

export function textoRepeticion(t) {
  const D = ['domingos','lunes','martes','miércoles','jueves','viernes','sábados'];
  if (t.repeat_type === 'daily') return 'Todos los días';
  if (t.repeat_type === 'weekly') {
    const d = (t.repeat_days || []).slice().sort();
    if (d.length === 0) return 'Semanal (sin días elegidos)';
    return 'Cada ' + d.map((x) => D[x]).join(', ');
  }
  if (t.due_date) {
    const [a, m, dd] = t.due_date.split('-');
    return 'Un día: ' + dd + '/' + m + '/' + a;
  }
  return 'Puntual';
}
