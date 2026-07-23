// Acceso a datos de semanas y asignaciones. Sin interfaz aquí. v7
import { sb } from '../supabase.js?v=17';
import { ctx } from '../auth.js?v=17';

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
    .select('id, start_date, status, publish_at, publish_at_manual, visibility, notes, config_snapshot')
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
    .select('id, start_date, status, publish_at, publish_at_manual, visibility, notes, config_snapshot')
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

/* ---------- Publicación ---------- */

export async function programarSemana(weekId, manualISO = null) {
  const { data, error } = await sb.rpc('schedule_week', {
    p_week_id: weekId,
    p_manual: manualISO,
  });
  if (error) throw new Error('No se pudo programar: ' + error.message);
  return data;   // timestamptz resultante
}

export async function publicarAhora(weekId) {
  const { error } = await sb.rpc('publish_week_now', { p_week_id: weekId });
  if (error) throw new Error('No se pudo publicar: ' + error.message);
}

export async function despublicar(weekId) {
  const { error } = await sb.rpc('unpublish_week', { p_week_id: weekId });
  if (error) throw new Error('No se pudo pasar a borrador: ' + error.message);
}

export async function copiarSemana(desdeId, haciaId) {
  const { error } = await sb.rpc('copy_week', { p_from: desdeId, p_to: haciaId });
  if (error) throw new Error('No se pudo copiar: ' + error.message);
}

export async function recalcularProgramadas() {
  const { data, error } = await sb.rpc('recompute_scheduled', {
    p_business: ctx.business.id,
  });
  if (error) throw new Error('No se pudieron recalcular: ' + error.message);
  return data || 0;
}

/* ---------- Listado ---------- */

/* Todas las semanas del negocio, de más reciente a más antigua */
export async function listarSemanas() {
  const { data, error } = await sb
    .from('weeks')
    .select('id, start_date, status, publish_at, publish_at_manual, visibility')
    .eq('business_id', ctx.business.id)
    .order('start_date', { ascending: false });
  if (error) throw new Error('Semanas: ' + error.message);
  return data || [];
}

export async function borrarSemana(weekId) {
  const { error } = await sb.from('weeks').delete().eq('id', weekId);
  if (error) throw new Error('No se pudo eliminar: ' + error.message);
}

/* Formatea un timestamptz en hora local del negocio */
export function fmtMomento(iso, tz) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      timeZone: tz || 'Atlantic/Canary',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    return new Date(iso).toLocaleString('es-ES');
  }
}

/* Convierte 'yyyy-mm-ddThh:mm' (input datetime-local, hora del dispositivo)
   a ISO absoluto. Se usa solo en el override manual, donde el gestor
   está eligiendo un momento concreto mirando su propio reloj. */
export function localAIso(valor) {
  if (!valor) return null;
  return new Date(valor).toISOString();
}

/* Estado de la semana en su ciclo de vida. NO depende de si está oculta:
   una semana puede estar "Programada" y a la vez oculta a mano. */
export function estadoBase(w) {
  if (!w.publish_at) return 'draft';
  if (new Date(w.publish_at) > new Date()) return 'scheduled';
  return semanaTerminada(w.start_date) ? 'archivada' : 'publicada';
}

/* Si el equipo la ve o no. Aquí sí manda la visibilidad manual. */
export function esVisible(w) {
  if (w.visibility === 'hidden') return false;
  if (w.visibility === 'shown')  return true;
  const base = estadoBase(w);
  return base === 'publicada';
}

/* Modo de visibilidad: automático, forzado a visible, o forzado a oculto */
export function modoVisibilidad(w) {
  return (w.visibility === 'hidden' || w.visibility === 'shown') ? w.visibility : 'auto';
}

export function semanaTerminada(startIso) {
  const hoy = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const hoyIso = hoy.getFullYear() + '-' + p(hoy.getMonth() + 1) + '-' + p(hoy.getDate());
  return sumarDias(startIso, 6) < hoyIso;
}

export const ETIQUETA_ESTADO = {
  draft:     'Borrador',
  scheduled: 'Programada',
  publicada: 'Publicada',
  archivada: 'Archivada',
};

/* Icono de ojo (visible) / ojo tachado (oculta), como SVG en línea */
export function iconoOjo(visible) {
  return visible
    ? '<svg class="ico-ojo" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7z"/>'
      + '<circle class="pupila" cx="12" cy="12" r="3.2"/></svg>'
    : '<svg class="ico-ojo" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7z"/>'
      + '<circle class="pupila" cx="12" cy="12" r="3.2"/>'
      + '<line class="tacha" x1="3.5" y1="20.5" x2="20.5" y2="3.5"/></svg>';
}

/* Texto corto que explica la visibilidad */
export function textoVisibilidad(w) {
  const modo = modoVisibilidad(w);
  const visible = esVisible(w);
  if (modo === 'hidden') return 'Oculta a mano';
  if (modo === 'shown')  return 'Visible a mano';
  return visible ? 'La ve el equipo' : 'No la ve el equipo';
}

/* Cambia la visibilidad sin tocar la fecha programada */
export async function setVisibilidad(weekId, modo) {
  const { error } = await sb.rpc('set_week_visibility', {
    p_week_id: weekId, p_mode: modo,
  });
  if (error) throw new Error('No se pudo cambiar la visibilidad: ' + error.message);
}

/* Borrado por rango (mes o año) */
export async function contarSemanasRango(desde, hasta) {
  const { data, error } = await sb.rpc('count_weeks_range', {
    p_business: ctx.business.id, p_from: desde, p_to: hasta,
  });
  if (error) return 0;
  return data || 0;
}

export async function borrarSemanasRango(desde, hasta) {
  const { data, error } = await sb.rpc('delete_weeks_range', {
    p_business: ctx.business.id, p_from: desde, p_to: hasta,
  });
  if (error) throw new Error('No se pudieron borrar: ' + error.message);
  return data || 0;
}
