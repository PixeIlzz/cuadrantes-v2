// Datos para la vista de empleado: semanas publicadas y turnos propios. v9
import { sb } from '../supabase.js?v=17';
import { ctx } from '../auth.js?v=17';

/* Semanas visibles para el empleado. RLS ya filtra por publish_at <= now(),
   así que lo que no toca ver, sencillamente no llega. */
export async function semanasVisibles() {
  const { data, error } = await sb
    .from('weeks')
    .select('id, start_date, notes, config_snapshot')
    .eq('business_id', ctx.business.id)
    .order('start_date', { ascending: false });
  if (error) throw new Error('Semanas: ' + error.message);
  return data || [];
}

export async function asignacionesDe(weekId) {
  const { data, error } = await sb
    .from('assignments')
    .select('day_id, position_id, worker_id, is_all, sort_order')
    .eq('week_id', weekId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('Turnos: ' + error.message);
  return data || [];
}

export async function plantilla() {
  const { data, error } = await sb
    .from('workers')
    .select('id, name, sort_order')
    .eq('business_id', ctx.business.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('Equipo: ' + error.message);
  return data || [];
}
