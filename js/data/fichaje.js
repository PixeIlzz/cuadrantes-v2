// Acceso a datos del fichaje. La hora la pone siempre el servidor.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* Fichar (alterna entrada/salida). Devuelve {tipo, momento}. */
export async function fichar() {
  const { data, error } = await sb.rpc('fichar');
  if (error) throw new Error(error.message);
  return data;
}

/* Realtime: avisa (cb) cuando cambia algún fichaje del negocio.
   La RLS limita lo que llega a cada usuario. Devuelve el canal. */
export function suscribirFichajes(businessId, cb) {
  return sb.channel('fichajes-' + businessId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'time_entries', filter: 'business_id=eq.' + businessId },
      cb)
    .subscribe();
}
export function cerrarCanal(canal) {
  if (canal) sb.removeChannel(canal);
}

/* Fichajes de un trabajador en un rango de fechas (ISO). */
/* Fichajes agrupados por DÍA LABORAL: un turno de noche que acaba de
   madrugada cuenta en el día en que empezó. Cada fila trae 'dia'. */
export async function fichajesPorJornada(workerId, desdeIso, hastaIso) {
  const { data, error } = await sb.rpc('fichajes_por_jornada', {
    p_worker_id: workerId, p_desde: desdeIso, p_hasta: hastaIso,
  });
  if (error) throw new Error('Fichajes: ' + error.message);
  return (data || []).filter((f) => f.dia >= desdeIso && f.dia <= hastaIso);
}

export async function fichajesDe(workerId, desdeIso, hastaIso) {
  // Pedimos un día extra por cada lado: el corte por UTC podría dejarse
  // fuera fichajes de madrugada. Luego filtramos por la fecha real.
  const mas = (iso, dias) => {
    const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const { data, error } = await sb
    .from('time_entries')
    .select('id, tipo, momento, estimado, origen, nota')
    .eq('worker_id', workerId)
    .gte('momento', mas(desdeIso, -1) + 'T00:00:00')
    .lte('momento', mas(hastaIso, 1) + 'T23:59:59')
    .order('momento', { ascending: true });
  if (error) throw new Error('Fichajes: ' + error.message);
  return (data || []).filter((f) => {
    const d = diaDe(f.momento);
    return d >= desdeIso && d <= hastaIso;
  });
}

/* Mis fichajes de hoy (empleado). */
export async function misFichajesHoy() {
  const hoy = hoyIso();
  return fichajesDe(ctx.workerId, hoy, hoy);
}

/* ¿Estoy fichado ahora mismo? (último de hoy es entrada) */
export async function miEstado() {
  // Último fichaje sin filtrar por día: soporta turnos que cruzan medianoche.
  return estadoDeWorker(ctx.workerId);
}

/* Fichajes de hoy de TODO el equipo (gestor). Devuelve por worker_id. */
/* Estado de hoy del equipo, calculado en el servidor (zona del negocio). */
export async function jornadaHoy() {
  const { data, error } = await sb.rpc('jornada_hoy', { p_business_id: ctx.business.id });
  if (error) throw new Error('Jornada: ' + error.message);
  return data || [];
}

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

/* Tramos previstos de un trabajador un día concreto (del cuadrante,
   con respaldo al horario general del negocio). */
export async function turnoPrevisto(workerId, diaIso) {
  const { data, error } = await sb.rpc('turno_previsto', {
    p_business_id: ctx.business.id, p_worker_id: workerId, p_dia: diaIso,
  });
  if (error) return [];
  return data || [];
}

export async function estadoDeWorker(workerId) {
  const { data, error } = await sb.from('time_entries')
    .select('tipo, momento')
    .eq('worker_id', workerId)
    .order('momento', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const ult = (data && data[0]) || null;
  return {
    dentro: !!ult && ult.tipo === 'entrada',
    desde: (ult && ult.tipo === 'entrada') ? ult.momento : null,
  };
}

export function datosLegales() {
  return (ctx.business.config && ctx.business.config.legal) || { razon_social: '', cif: '' };
}
export async function guardarDatosLegales(legal) {
  const cfg = { ...(ctx.business.config || {}), legal };
  const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
  ctx.business.config = cfg;
}

export async function guardarHorarioFichaje(fichajeConfig) {
  const cfg = { ...(ctx.business.config || {}), fichaje: fichajeConfig };
  const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
  ctx.business.config = cfg;
}

export const TZ = 'Atlantic/Canary';
/* Fecha yyyy-mm-dd de un instante, en la zona del negocio (no del dispositivo). */
export function diaDe(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}
function hoyIso() { return diaDe(new Date()); }
