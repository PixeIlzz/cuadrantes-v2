// Datos para la vista de empleado: semanas publicadas y turnos propios. v9
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* Si esto salta, la sesión no se cargó bien: mejor un mensaje claro
   que un error críptico de JavaScript. */
function negocioId() {
  if (!ctx.business || !ctx.business.id) {
    throw new Error('La sesión no se cargó del todo. Cierra sesión y vuelve a entrar.');
  }
  return ctx.business.id;
}

/* Semanas visibles para el empleado. RLS ya filtra por publish_at <= now(),
   así que lo que no toca ver, sencillamente no llega. */
export async function semanasVisibles() {
  const { data, error } = await sb
    .from('weeks')
    .select('id, start_date, notes, config_snapshot')
    .eq('business_id', negocioId())
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
    .eq('business_id', negocioId())
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('Equipo: ' + error.message);
  return data || [];
}
