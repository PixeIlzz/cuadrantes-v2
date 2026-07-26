// Importar datos de la v1 y copias de seguridad de la v2.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';
import { isoDe, sumarDias } from './semanas.js';

const ALL_V1 = '__ALL__';
const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];

/* =====================================================================
   Reconocer qué archivo nos han dado
   ===================================================================== */
export function identificar(json) {
  if (json && json.staffpoint === 'backup') return 'v2';
  if (Array.isArray(json)) return 'v1-programadas';        // programadas.json
  if (json && Array.isArray(json.workers) && json.cells) return 'v1-backup';
  if (json && Array.isArray(json.w) && json.c) return 'v1-publicada';  // datos.json
  return null;
}

/* Fecha de inicio a partir de la etiqueta de la v1 ("del 20 al 26 de julio").
   La v1 no guardaba el año: se deduce igual que ella lo hacía. */
export function fechaDesdeEtiqueta(label, refIso = null) {
  if (!label) return null;
  let dia, mi;
  let m = /^del\s+(\d+)\s+de\s+(\S+)\s+al\s+(\d+)\s+de\s+(\S+)$/i.exec(label.trim());
  if (m) { dia = parseInt(m[1], 10); mi = MESES.indexOf(m[2].toLowerCase()); }
  else {
    m = /^del\s+(\d+)\s+al\s+(\d+)\s+de\s+(\S+)$/i.exec(label.trim());
    if (!m) return null;
    dia = parseInt(m[1], 10); mi = MESES.indexOf(m[3].toLowerCase());
  }
  if (mi < 0 || !(dia >= 1 && dia <= 31)) return null;

  const ref = refIso ? new Date(refIso + 'T12:00:00') : new Date();
  let d = new Date(ref.getFullYear(), mi, dia);
  if (d.getTime() < ref.getTime() - 120 * 86400000) {
    d = new Date(ref.getFullYear() + 1, mi, dia);
  }
  return isoDe(d);
}

/* =====================================================================
   Análisis previo: qué se va a importar (sin tocar nada)
   ===================================================================== */
export function analizar(archivos) {
  const res = {
    config: null,
    trabajadores: [],     // {nombre, turnos, vacaciones:[{from,to}]}
    semanas: [],          // {startIso, etiqueta, cells:{clave:[nombre|ALL]}, notas, origen}
    avisos: [],
  };

  for (const { nombre, json } of archivos) {
    const tipo = identificar(json);

    if (tipo === 'v1-backup') {
      if (json.config) res.config = json.config;
      for (const w of json.workers) {
        res.trabajadores.push({
          nombre: String(w.name || '').trim(),
          turnos: Number(w.shifts) || 5,
          vacaciones: (w.vac || [])
            .filter((v) => v && v.from && v.to)
            .map((v) => ({ from: v.from, to: v.to })),
        });
      }
      const start = fechaDesdeEtiqueta(json.dateLabel);
      if (start) {
        const porNombre = {};
        json.workers.forEach((w) => { porNombre[w.id] = String(w.name || '').trim(); });
        const cells = {};
        for (const k in (json.cells || {})) {
          const lista = (json.cells[k] || [])
            .map((id) => (id === ALL_V1 ? '__TODOS__' : porNombre[id]))
            .filter(Boolean);
          if (lista.length) cells[k] = lista;
        }
        res.semanas.push({
          startIso: start,
          etiqueta: json.dateLabel,
          cells,
          notas: limpiarNotas(json.dayNotes),
          config: json.config || null,
          origen: 'semana en curso (' + nombre + ')',
        });
      } else if (json.dateLabel) {
        res.avisos.push('La semana en curso tenía la etiqueta «' + json.dateLabel
          + '», que no se pudo convertir en fecha. No se importa.');
      }
    }

    if (tipo === 'v1-programadas' || tipo === 'v1-publicada') {
      const lista = tipo === 'v1-programadas' ? json : [json];
      for (const p of lista) {
        const start = fechaDesdeEtiqueta(p.d);
        if (!start) {
          res.avisos.push('Una semana con etiqueta «' + (p.d || 'sin fecha')
            + '» no se pudo convertir en fecha. No se importa.');
          continue;
        }
        // En los payloads los ids son índices del array de nombres, y 'A' = TODOS
        const nombres = p.w || [];
        const cells = {};
        for (const k in (p.c || {})) {
          const lista2 = (p.c[k] || [])
            .map((i) => (i === 'A' ? '__TODOS__' : nombres[Number(i)]))
            .filter(Boolean);
          if (lista2.length) cells[k] = lista2;
        }
        res.semanas.push({
          startIso: start,
          etiqueta: p.d,
          cells,
          notas: limpiarNotas(p.n),
          config: p.cfg || null,
          origen: tipo === 'v1-publicada'
            ? 'semana publicada (' + nombre + ')'
            : 'semana programada (' + nombre + ')',
        });
        // Los nombres que salen en semanas pero no están en el equipo
        for (const n of nombres) {
          const limpio = String(n || '').trim();
          if (limpio && !res.trabajadores.some((t) => igual(t.nombre, limpio))) {
            res.trabajadores.push({ nombre: limpio, turnos: 5, vacaciones: [], deSemana: true });
          }
        }
      }
    }
  }

  // Quitar trabajadores repetidos (conservando el que trae más información)
  const unicos = [];
  for (const t of res.trabajadores) {
    const ya = unicos.find((u) => igual(u.nombre, t.nombre));
    if (!ya) { unicos.push(t); continue; }
    if (t.vacaciones.length > ya.vacaciones.length) ya.vacaciones = t.vacaciones;
    if (!t.deSemana && ya.deSemana) { ya.turnos = t.turnos; ya.deSemana = false; }
  }
  res.trabajadores = unicos.filter((t) => t.nombre);

  // Semanas repetidas: gana la que tenga más contenido
  const porFecha = {};
  for (const s of res.semanas) {
    const ya = porFecha[s.startIso];
    if (!ya || cuentaCeldas(s.cells) > cuentaCeldas(ya.cells)) porFecha[s.startIso] = s;
  }
  res.semanas = Object.values(porFecha).sort((a, b) => a.startIso.localeCompare(b.startIso));

  return res;
}

const igual = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const cuentaCeldas = (c) => Object.values(c || {}).reduce((n, l) => n + l.length, 0);
function limpiarNotas(n) {
  const out = {};
  for (const k in (n || {})) {
    const v = n[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

/* =====================================================================
   Importar de verdad
   ===================================================================== */
export async function importarV1(plan, opciones = {}) {
  const { aplicarConfig = true, importarSemanas = true } = opciones;
  const biz = ctx.business.id;
  const log = [];

  // 1) Configuración de días y puestos
  if (aplicarConfig && plan.config && plan.config.days && plan.config.roles) {
    const cfgActual = ctx.business.config || {};
    const cfg = {
      days: plan.config.days,
      roles: plan.config.roles,
      publish: cfgActual.publish || { weekday: 0, time: '18:00', tz: 'Atlantic/Canary' },
    };
    const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', biz);
    if (error) throw new Error('Configuración: ' + error.message);
    ctx.business.config = cfg;
    log.push('Configuración importada: ' + cfg.days.length + ' columnas y '
      + cfg.roles.length + ' puestos.');
  }

  // 2) Equipo (sin duplicar los que ya existan)
  const { data: existentes, error: e0 } = await sb
    .from('workers').select('id, name').eq('business_id', biz);
  if (e0) throw new Error('Equipo: ' + e0.message);

  const idPorNombre = {};
  for (const w of (existentes || [])) idPorNombre[w.name.trim().toLowerCase()] = w.id;

  let nuevos = 0, reutilizados = 0;
  for (const [i, t] of plan.trabajadores.entries()) {
    const clave = t.nombre.trim().toLowerCase();
    if (idPorNombre[clave]) { reutilizados++; continue; }
    const { data, error } = await sb.from('workers')
      .insert({ business_id: biz, name: t.nombre, weekly_shifts: t.turnos, sort_order: i })
      .select('id').single();
    if (error) throw new Error('Al crear a ' + t.nombre + ': ' + error.message);
    idPorNombre[clave] = data.id;
    nuevos++;
  }
  log.push('Equipo: ' + nuevos + ' creados, ' + reutilizados + ' ya existían.');

  // 3) Vacaciones (evitando repetir el mismo periodo)
  const { data: vacsYa } = await sb.from('vacations')
    .select('worker_id, start_date, end_date').eq('business_id', biz);
  const yaHay = new Set((vacsYa || [])
    .map((v) => v.worker_id + '|' + v.start_date + '|' + v.end_date));

  let vacs = 0;
  for (const t of plan.trabajadores) {
    const wid = idPorNombre[t.nombre.trim().toLowerCase()];
    if (!wid) continue;
    for (const v of t.vacaciones) {
      const k = wid + '|' + v.from + '|' + v.to;
      if (yaHay.has(k)) continue;
      const { error } = await sb.from('vacations').insert({
        business_id: biz, worker_id: wid,
        start_date: v.from, end_date: v.to, source: 'manager',
      });
      if (!error) { vacs++; yaHay.add(k); }
    }
  }
  log.push('Vacaciones: ' + vacs + ' periodos importados.');

  // 4) Semanas
  let semOk = 0, semSalta = 0;
  if (importarSemanas) {
    for (const s of plan.semanas) {
      const { data: existe } = await sb.from('weeks')
        .select('id').eq('business_id', biz).eq('start_date', s.startIso).maybeSingle();
      if (existe) { semSalta++; continue; }

      const { data: nueva, error: eW } = await sb.from('weeks').insert({
        business_id: biz,
        start_date: s.startIso,
        status: 'draft',
        notes: s.notas || {},
        config_snapshot: s.config && s.config.days
          ? { days: s.config.days, roles: s.config.roles }
          : ctx.business.config,
        visibility: 'hidden',      // se importan ocultas: tú decides cuándo mostrarlas
      }).select('id').single();
      if (eW) throw new Error('Semana ' + s.startIso + ': ' + eW.message);

      const filas = [];
      for (const clave in s.cells) {
        const [day, role] = clave.split('|');
        s.cells[clave].forEach((nombre, idx) => {
          if (nombre === '__TODOS__') {
            filas.push({ day, role, worker: null, all: true, ord: idx });
          } else {
            const wid = idPorNombre[String(nombre).trim().toLowerCase()];
            if (wid) filas.push({ day, role, worker: wid, all: false, ord: idx });
          }
        });
      }
      if (filas.length) {
        const { error: eS } = await sb.rpc('save_week', {
          p_week_id: nueva.id, p_cells: filas, p_notes: s.notas || {},
        });
        if (eS) throw new Error('Turnos de ' + s.startIso + ': ' + eS.message);
      }
      semOk++;
    }
    log.push('Semanas: ' + semOk + ' importadas'
      + (semSalta ? ', ' + semSalta + ' ya existían y se han saltado' : '') + '.');
  }

  return log;
}

/* =====================================================================
   Copia de seguridad de la v2 (completa)
   ===================================================================== */
export async function exportarTodo() {
  const biz = ctx.business.id;

  const tabla = async (nombre, cols, extra = null) => {
    let q = sb.from(nombre).select(cols).eq('business_id', biz);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(nombre + ': ' + error.message);
    return data || [];
  };

  const negocio = { id: ctx.business.id, name: ctx.business.name, config: ctx.business.config };
  const workers = await tabla('workers', 'id, name, weekly_shifts, active, sort_order, created_at');
  const vacations = await tabla('vacations', 'id, worker_id, start_date, end_date, source, note, created_at');
  const weeks = await tabla('weeks',
    'id, start_date, status, publish_at, publish_at_manual, visibility, notes, config_snapshot, created_at');
  const requests = await tabla('requests',
    'id, worker_id, type, status, start_date, end_date, message, manager_note, resolved_at, created_at');
  const announcements = await tabla('announcements', 'id, text, pinned, active, expires_at, created_at');
  const tasks = await tabla('tasks',
    'id, title, detail, repeat_type, repeat_days, due_date, active, sort_order, created_at');
  const completions = await tabla('task_completions', 'id, task_id, done_date, done_at');

  // Asignaciones de todas las semanas
  const ids = weeks.map((w) => w.id);
  let assignments = [];
  if (ids.length) {
    const { data, error } = await sb.from('assignments')
      .select('week_id, day_id, position_id, worker_id, is_all, sort_order')
      .in('week_id', ids);
    if (error) throw new Error('assignments: ' + error.message);
    assignments = data || [];
  }

  return {
    staffpoint: 'backup',
    version: 1,
    exportado: new Date().toISOString(),
    negocio,
    workers, vacations, weeks, assignments,
    requests, announcements, tasks, completions,
  };
}

/* Restaurar una copia de la v2. Añade lo que falte; no borra nada.
   Los identificadores se recrean: no se pisan los datos actuales. */
export async function restaurarBackup(json, opciones = {}) {
  const { restaurarConfig = true } = opciones;
  if (identificar(json) !== 'v2') throw new Error('Ese archivo no es una copia de StaffPoint.');
  const biz = ctx.business.id;
  const log = [];

  if (restaurarConfig && json.negocio && json.negocio.config) {
    const { error } = await sb.from('businesses')
      .update({ config: json.negocio.config }).eq('id', biz);
    if (error) throw new Error('Configuración: ' + error.message);
    ctx.business.config = json.negocio.config;
    log.push('Configuración restaurada.');
  }

  // Equipo, casando por nombre
  const { data: existentes } = await sb.from('workers')
    .select('id, name').eq('business_id', biz);
  const mapa = {};   // id antiguo -> id nuevo
  const porNombre = {};
  for (const w of (existentes || [])) porNombre[w.name.trim().toLowerCase()] = w.id;

  let nuevos = 0;
  for (const w of (json.workers || [])) {
    const clave = String(w.name).trim().toLowerCase();
    if (porNombre[clave]) { mapa[w.id] = porNombre[clave]; continue; }
    const { data, error } = await sb.from('workers').insert({
      business_id: biz, name: w.name, weekly_shifts: w.weekly_shifts,
      active: w.active !== false, sort_order: w.sort_order || 0,
    }).select('id').single();
    if (error) throw new Error('Al crear a ' + w.name + ': ' + error.message);
    mapa[w.id] = data.id; porNombre[clave] = data.id; nuevos++;
  }
  log.push('Equipo: ' + nuevos + ' creados, ' + ((json.workers || []).length - nuevos) + ' ya existían.');

  // Vacaciones
  const { data: vacsYa } = await sb.from('vacations')
    .select('worker_id, start_date, end_date').eq('business_id', biz);
  const yaHay = new Set((vacsYa || [])
    .map((v) => v.worker_id + '|' + v.start_date + '|' + v.end_date));
  let vacs = 0;
  for (const v of (json.vacations || [])) {
    const wid = mapa[v.worker_id];
    if (!wid || yaHay.has(wid + '|' + v.start_date + '|' + v.end_date)) continue;
    const { error } = await sb.from('vacations').insert({
      business_id: biz, worker_id: wid, start_date: v.start_date,
      end_date: v.end_date, source: v.source || 'manager', note: v.note || null,
    });
    if (!error) { vacs++; yaHay.add(wid + '|' + v.start_date + '|' + v.end_date); }
  }
  log.push('Vacaciones: ' + vacs + ' periodos.');

  // Semanas y sus asignaciones
  const porSemana = {};
  for (const a of (json.assignments || [])) (porSemana[a.week_id] ||= []).push(a);

  let semOk = 0, semSalta = 0;
  for (const w of (json.weeks || [])) {
    const { data: existe } = await sb.from('weeks')
      .select('id').eq('business_id', biz).eq('start_date', w.start_date).maybeSingle();
    if (existe) { semSalta++; continue; }
    const { data: nueva, error } = await sb.from('weeks').insert({
      business_id: biz, start_date: w.start_date, status: w.status || 'draft',
      publish_at: w.publish_at, publish_at_manual: w.publish_at_manual || false,
      visibility: w.visibility || 'auto',
      notes: w.notes || {}, config_snapshot: w.config_snapshot || ctx.business.config,
    }).select('id').single();
    if (error) throw new Error('Semana ' + w.start_date + ': ' + error.message);

    const filas = (porSemana[w.id] || []).map((a) => ({
      day: a.day_id, role: a.position_id,
      worker: a.is_all ? null : (mapa[a.worker_id] || null),
      all: a.is_all, ord: a.sort_order || 0,
    })).filter((f) => f.all || f.worker);
    if (filas.length) {
      await sb.rpc('save_week', { p_week_id: nueva.id, p_cells: filas, p_notes: w.notes || {} });
    }
    semOk++;
  }
  log.push('Semanas: ' + semOk + ' restauradas'
    + (semSalta ? ', ' + semSalta + ' ya existían' : '') + '.');

  // Avisos y tareas
  let avisos = 0;
  for (const a of (json.announcements || [])) {
    const { error } = await sb.from('announcements').insert({
      business_id: biz, text: a.text, pinned: a.pinned || false,
      active: a.active !== false, expires_at: a.expires_at || null,
      created_by: ctx.user.id,
    });
    if (!error) avisos++;
  }
  let tareas = 0;
  for (const t of (json.tasks || [])) {
    const { error } = await sb.from('tasks').insert({
      business_id: biz, title: t.title, detail: t.detail,
      repeat_type: t.repeat_type, repeat_days: t.repeat_days || [],
      due_date: t.due_date, active: t.active !== false,
      sort_order: t.sort_order || 0, created_by: ctx.user.id,
    });
    if (!error) tareas++;
  }
  log.push('Avisos: ' + avisos + ' · Tareas: ' + tareas + '.');
  log.push('Las solicitudes no se restauran: pertenecen a las cuentas de los empleados.');

  return log;
}
