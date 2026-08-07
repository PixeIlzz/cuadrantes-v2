// Acceso a datos del fichaje. La hora la pone siempre el servidor.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* Fichar (alterna entrada/salida). Devuelve {tipo, momento}. */
export async function fichar() {
  const { data, error } = await sb.rpc('fichar');
  if (error) throw new Error(error.message);
  return data;
}

/* Fichajes de un trabajador en un rango de fechas (ISO). */
export async function fichajesDe(workerId, desdeIso, hastaIso) {
  const { data, error } = await sb
    .from('time_entries')
    .select('id, tipo, momento, estimado, origen, nota')
    .eq('worker_id', workerId)
    .gte('momento', desdeIso + 'T00:00:00')
    .lte('momento', hastaIso + 'T23:59:59')
    .order('momento', { ascending: true });
  if (error) throw new Error('Fichajes: ' + error.message);
  return data || [];
}

/* Mis fichajes de hoy (empleado). */
export async function misFichajesHoy() {
  const hoy = hoyIso();
  return fichajesDe(ctx.workerId, hoy, hoy);
}

/* ¿Estoy fichado ahora mismo? (último de hoy es entrada) */
export async function miEstado() {
  const hoy = await misFichajesHoy();
  if (hoy.length === 0) return { dentro: false, desde: null };
  const ultimo = hoy[hoy.length - 1];
  return { dentro: ultimo.tipo === 'entrada', desde: ultimo.tipo === 'entrada' ? ultimo.momento : null };
}

/* Fichajes de hoy de TODO el equipo (gestor). Devuelve por worker_id. */
export async function fichajesHoyEquipo() {
  const hoy = hoyIso();
  const { data, error } = await sb
    .from('time_entries')
    .select('id, worker_id, tipo, momento, estimado, origen')
    .eq('business_id', ctx.business.id)
    .gte('momento', hoy + 'T00:00:00')
    .lte('momento', hoy + 'T23:59:59')
    .order('momento', { ascending: true });
  if (error) throw new Error('Fichajes equipo: ' + error.message);
  const porWorker = {};
  for (const f of (data || [])) (porWorker[f.worker_id] ||= []).push(f);
  return porWorker;
}

/* Corregir un fichaje (gestor). Queda en la auditoría automáticamente. */
export async function corregirFichaje(id, nuevoMomento, nota) {
  const { error } = await sb
    .from('time_entries')
    .update({ momento: nuevoMomento, origen: 'gestor', nota: nota || null })
    .eq('id', id);
  if (error) throw new Error('No se pudo corregir: ' + error.message);
}

/* Añadir un fichaje manual (gestor), p.ej. una salida que se olvidó. */
export async function anadirFichajeManual(workerId, profileId, tipo, momentoIso, nota) {
  const { error } = await sb
    .from('time_entries')
    .insert({
      business_id: ctx.business.id, worker_id: workerId, profile_id: profileId,
      tipo, momento: momentoIso, origen: 'gestor', nota: nota || null,
    });
  if (error) throw new Error('No se pudo añadir: ' + error.message);
}

/* Borrar un fichaje (gestor). Queda en la auditoría. */
export async function borrarFichaje(id) {
  const { error } = await sb.from('time_entries').delete().eq('id', id);
  if (error) throw new Error('No se pudo borrar: ' + error.message);
}

/* Horario previsto del negocio (para detectar retrasos). */
export function horarioNegocio() {
  return (ctx.business.config && ctx.business.config.fichaje) || { horarios: {}, cierre_auto: '' };
}

export async function guardarHorarioFichaje(fichajeConfig) {
  const cfg = { ...(ctx.business.config || {}), fichaje: fichajeConfig };
  const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
  ctx.business.config = cfg;
}

function hoyIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
