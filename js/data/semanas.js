// Acceso a datos de semanas y asignaciones. Sin interfaz aquí. v7
import { sb } from '../supabase.js?v=7';
import { ctx } from '../auth.js?v=7';

/* Lunes (ISO yyyy-mm-dd) de la semana a la que pertenece una fecha */
export function lunesDe(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const desplaza = (d.getDay() + 6) % 7;   // lun=0 … dom=6
  d.setDate(d.getDate() - desplaza);
  return isoDe(d);
}
export function isoDe(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
export function sumarDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDe(new Date(y, m - 1, d + n));
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
export function fmtCorto(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return d + ' ' + MESES[m - 1].slice(0, 3);
}
/* "Del 27 de julio al 2 de agosto" (omite el primer mes si coincide) */
export function etiquetaSemana(startIso) {
  const fin = sumarDias(startIso, 6);
  const [, m1, d1] = startIso.split('-').map(Number);
  const [, m2, d2] = fin.split('-').map(Number);
  return m1 === m2
    ? `Del ${d1} al ${d2} de ${MESES[m2 - 1]}`
    : `Del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]}`;
}

/* Devuelve la semana de ese lunes; si no existe la crea como borrador
   congelando la configuración actual del negocio (config_snapshot). */
export async function obtenerOCrearSemana(startIso) {
  const biz = ctx.business.id;

  const { data: existente, error: e1 } = await sb
    .from('weeks')
    .select('id, start_date, status, publish_at, publish_at_manual, notes, config_snapshot')
    .eq('business_id', biz)
    .eq('start_date', startIso)
    .maybeSingle();
  if (e1) throw new Error('Semana: ' + e1.message);
  if (existente) return existente;

  const { data: nueva, error: e2 } = await sb
    .from('weeks')
    .insert({
      business_id: biz,
      start_date: startIso,
      status: 'draft',
      config_snapshot: ctx.business.config,
    })
    .select('id, start_date, status, publish_at, publish_at_manual, notes, config_snapshot')
    .single();
  if (e2) throw new Error('No se pudo crear la semana: ' + e2.message);
  return nueva;
}

export async function cargarAsignaciones(weekId) {
  const { data, error } = await sb
    .from('assignments')
    .select('day_id, position_id, worker_id, is_all, sort_order')
    .eq('week_id', weekId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('Asignaciones: ' + error.message);
  return data || [];
}

/* Guardado atómico de toda la semana vía RPC (ver 02_guardar_semana.sql) */
export async function guardarSemana(weekId, filas, notas) {
  const { error } = await sb.rpc('save_week', {
    p_week_id: weekId,
    p_cells: filas,
    p_notes: notas,
  });
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}
