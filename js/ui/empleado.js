// Vistas del empleado: cuadrante publicado (solo lectura) y "mis turnos". v9
import { toast } from './toast.js';
import { ctx } from '../auth.js';
import {
  semanasVisibles, asignacionesDe, plantilla, misAsignaciones, misVacaciones,
} from '../data/empleado.js';
import { etiquetaSemana, sumarDias, fmtCorto } from '../data/semanas.js';

const ALL_ID = 'ALL';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleCls = (i) => ['role-cam','role-par','role-coc'][i % 3];

let semanas = [];
let idx = 0;
let equipo = [];
let resaltado = null;      // worker_id resaltado en la vista general
let cargado = false;

export function initEmpleado() {
  $('emp-prev').addEventListener('click', () => mover(1));    // hacia atrás en el tiempo
  $('emp-next').addEventListener('click', () => mover(-1));
}

async function cargarBase() {
  if (cargado) return;
  if (!ctx.business) throw new Error('La sesión no se cargó del todo. Cierra sesión y vuelve a entrar.');
  equipo = await plantilla();
  semanas = await semanasVisibles();
  // La más reciente ya publicada es la primera (orden descendente)
  idx = 0;
  resaltado = ctx.workerId || null;
  cargado = true;
}

function mover(paso) {
  const nuevo = idx + paso;
  if (nuevo < 0 || nuevo >= semanas.length) return;
  idx = nuevo;
  pintarSemana();
}

/* ---------- Vista general del cuadrante ---------- */
export async function abrirEmpCuadrante() {
  const cont = $('emp-grid');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    cargado = false;                 // siempre datos frescos al entrar
    await cargarBase();
    if (semanas.length === 0) {
      $('emp-week-label').textContent = '';
      cont.innerHTML = '<span class="empty-note">Todavía no hay ningún cuadrante publicado.</span>';
      $('emp-people').innerHTML = '';
      return;
    }
    pintarPersonas();
    await pintarSemana();
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

function pintarPersonas() {
  const box = $('emp-people');
  box.innerHTML = '';
  for (const w of equipo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'people-chip'
      + (resaltado === w.id ? ' on' : '')
      + (ctx.workerId === w.id ? ' yo' : '');
    b.textContent = w.name + (ctx.workerId === w.id ? ' (tú)' : '');
    b.addEventListener('click', () => {
      resaltado = (resaltado === w.id) ? null : w.id;
      pintarPersonas();
      pintarSemana();
    });
    box.appendChild(b);
  }
}

async function pintarSemana() {
  const s = semanas[idx];
  const cont = $('emp-grid');
  $('emp-week-label').textContent = etiquetaSemana(s.start_date);
  $('emp-prev').disabled = (idx >= semanas.length - 1);
  $('emp-next').disabled = (idx <= 0);
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';

  const cfg = s.config_snapshot || {};
  const DAYS = cfg.days || [];
  const ROLES = cfg.roles || [];
  const notas = s.notes || {};

  const filas = await asignacionesDe(s.id);
  const cells = {};
  for (const a of filas) {
    const k = a.day_id + '|' + a.position_id;
    (cells[k] ||= []).push(a.is_all ? ALL_ID : a.worker_id);
  }
  const nombre = (id) => (equipo.find((w) => w.id === id) || {}).name || '?';
  const dayHasAll = (d) => ROLES.some((r) => (cells[d + '|' + r.id] || []).includes(ALL_ID));

  cont.innerHTML = '';
  for (const d of DAYS) {
    const col = document.createElement('div');
    col.className = 'day-col' + (d.night ? ' night' : '');
    const nm = document.createElement('div');
    nm.className = 'day-name';
    nm.textContent = d.label;
    col.appendChild(nm);

    if (dayHasAll(d.id)) {
      const block = document.createElement('div');
      block.className = 'all-day';
      block.innerHTML = '<div class="chip all-chip all-day-chip"><span>TODOS</span></div>'
        + '<div class="all-day-note">Día completo</div>';
      col.appendChild(block);
    } else {
      ROLES.forEach((r, ri) => {
        const lista = cells[d.id + '|' + r.id] || [];
        const block = document.createElement('div');
        block.className = 'role-block ' + roleCls(ri);
        block.innerHTML = '<div class="role-head"><span>' + esc(r.label) + '</span></div>';
        const zone = document.createElement('div');
        zone.className = 'drop-zone';
        if (lista.length === 0) {
          const vac = document.createElement('span');
          vac.className = 'zone-vacio';
          vac.textContent = '—';
          zone.appendChild(vac);
        }
        for (const id of lista) {
          const chip = document.createElement('div');
          chip.className = 'chip solo-lectura'
            + (id === ALL_ID ? ' all-chip' : '')
            + (resaltado && id === resaltado ? ' hl' : '');
          chip.textContent = id === ALL_ID ? 'TODOS' : nombre(id);
          zone.appendChild(chip);
        }
        block.appendChild(zone);
        col.appendChild(block);
      });
    }

    if (notas[d.id]) {
      const n = document.createElement('div');
      n.className = 'day-note-ro';
      n.textContent = notas[d.id];
      col.appendChild(n);
    }
    cont.appendChild(col);
  }
}

/* =====================================================================
   Pantalla "Hoy" del empleado
   ===================================================================== */

export async function abrirEmpHoy() {
  const cont = $('emp-hoy');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    cargado = false;
    await cargarBase();
    const hoy = isoDe(new Date());
    cont.innerHTML = '';

    // Cabecera con la fecha
    const cab = document.createElement('div');
    cab.className = 'panel panel-hoy-cab';
    const f = new Date(hoy + 'T12:00:00');
    cab.innerHTML = '<div class="hoy-fecha"></div><div class="hoy-sub"></div>';
    cab.querySelector('.hoy-fecha').textContent = f.toLocaleDateString('es-ES',
      { weekday: 'long', day: 'numeric', month: 'long' });
    const yo = equipo.find((w) => w.id === ctx.workerId);
    cab.querySelector('.hoy-sub').textContent = yo ? 'Hola, ' + yo.name : '';
    cont.appendChild(cab);

    // ¿Vacaciones hoy?
    const vacs = await misVacaciones();
    const vacHoy = vacs.find((v) => v.start_date <= hoy && v.end_date >= hoy);
    if (vacHoy) {
      const p = document.createElement('div');
      p.className = 'panel panel-vac-hoy';
      p.innerHTML = '<div class="vac-hoy-tit">🏖 Estás de vacaciones</div>'
        + '<div class="vac-hoy-sub"></div>';
      p.querySelector('.vac-hoy-sub').textContent =
        'Hasta el ' + fmtCorto(vacHoy.end_date)
        + (vacHoy.note ? ' · ' + vacHoy.note : '');
      cont.appendChild(p);
    }

    // Mis turnos de hoy + notas del día
    cont.appendChild(await tarjetaHoyTurnos(hoy));
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

async function tarjetaHoyTurnos(hoy) {
  const p = document.createElement('div');
  p.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Mi jornada de hoy';
  p.appendChild(h);

  // Buscar la semana visible que contiene hoy
  const sem = semanas.find((s) => s.start_date <= hoy && sumarDias(s.start_date, 6) >= hoy);
  if (!sem) {
    p.appendChild(nota('El cuadrante de esta semana todavía no está publicado.'));
    return p;
  }
  const cfg = sem.config_snapshot || {};
  const DAYS = cfg.days || [];
  const ROLES = cfg.roles || [];
  const base = DAYS.filter((d) => !d.night);
  const idx = Math.round((new Date(hoy) - new Date(sem.start_date)) / 86400000);
  const hoyBase = base[idx];
  if (!hoyBase) {
    p.appendChild(nota('Hoy no es un día del cuadrante.'));
    return p;
  }
  const columnas = DAYS.filter((d) => d.id === hoyBase.id || d.id === hoyBase.id + 'N');
  const filas = await asignacionesDe(sem.id);

  let tengo = false;
  for (const col of columnas) {
    const mios = filas.filter((a) => a.day_id === col.id
      && (a.is_all || a.worker_id === ctx.workerId));
    if (mios.length === 0) continue;
    tengo = true;
    for (const a of mios) {
      const r = ROLES.find((x) => x.id === a.position_id);
      const el = document.createElement('div');
      el.className = 'turno-row' + (a.is_all ? ' todos' : '');
      el.innerHTML = '<span class="turno-dia">' + esc(col.label) + '</span>'
        + '<span class="turno-puesto">'
        + (a.is_all ? 'Día completo (TODOS)' : esc(r ? r.label : '')) + '</span>';
      p.appendChild(el);
    }
  }
  if (!tengo) p.appendChild(nota('Hoy no tienes turno asignado.'));

  // Notas del día que escribió el gestor
  const notas = sem.notes || {};
  const textos = columnas.map((c) => notas[c.id]).filter((t) => t && String(t).trim());
  if (textos.length) {
    const nt = document.createElement('div');
    nt.className = 'emp-notas';
    const h2 = document.createElement('div');
    h2.className = 'emp-notas-tit';
    h2.textContent = 'Notas del día';
    nt.appendChild(h2);
    for (const t of textos) {
      const el = document.createElement('div');
      el.className = 'emp-nota';
      el.textContent = t;
      nt.appendChild(el);
    }
    p.appendChild(nt);
  }
  return p;
}

function nota(txt) {
  const s = document.createElement('span');
  s.className = 'empty-note';
  s.textContent = txt;
  return s;
}

/* =====================================================================
   Calendario mensual de "Mis turnos"
   ===================================================================== */

const MESES_LARGO = ['enero','febrero','marzo','abril','mayo','junio',
                     'julio','agosto','septiembre','octubre','noviembre','diciembre'];
let mesVisible = null;      // {a: 2026, m: 7}  (m = 1..12)
let diasConTurno = {};      // iso -> [{color, label}]
let diasVacaciones = {};    // iso -> nota

const isoDe = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
const colorPuesto = (i) => ['var(--cam)','var(--par)','var(--coc)'][i % 3];

async function cargarCalendario() {
  diasConTurno = {}; diasVacaciones = {};

  // Turnos: cada asignación se traduce a la fecha real de su día
  for (const a of await misAsignaciones()) {
    const sem = a.weeks;
    if (!sem) continue;
    const cfg = sem.config_snapshot || {};
    const DAYS = cfg.days || [];
    const ROLES = cfg.roles || [];
    const base = DAYS.filter((d) => !d.night);
    const idx = base.findIndex((b) => b.id === a.day_id.replace(/N$/, ''));
    if (idx < 0) continue;
    const iso = sumarDias(sem.start_date, idx);
    const ri = ROLES.findIndex((r) => r.id === a.position_id);
    const rol = ROLES[ri];
    (diasConTurno[iso] ||= []).push({
      color: a.is_all ? 'var(--ink)' : colorPuesto(ri < 0 ? 0 : ri),
      label: a.is_all ? 'Día completo' : (rol ? rol.label : ''),
    });
  }

  // Vacaciones: se pintan aunque no haya cuadrante publicado
  for (const v of await misVacaciones()) {
    let d = new Date(v.start_date + 'T12:00:00');
    const fin = new Date(v.end_date + 'T12:00:00');
    while (d <= fin) {
      diasVacaciones[isoDe(d)] = v.note || '';
      d.setDate(d.getDate() + 1);
    }
  }
}

function pintarCalendario() {
  const cont = $('emp-calendario');
  if (!cont) return;
  if (!mesVisible) {
    const h = new Date();
    mesVisible = { a: h.getFullYear(), m: h.getMonth() + 1 };
  }
  const { a, m } = mesVisible;
  cont.innerHTML = '';

  // Cabecera con navegación
  const cab = document.createElement('div');
  cab.className = 'cal-cab';
  const bPrev = document.createElement('button');
  bPrev.type = 'button'; bPrev.className = 'btn small'; bPrev.textContent = '‹';
  bPrev.addEventListener('click', () => {
    mesVisible = (m === 1) ? { a: a - 1, m: 12 } : { a, m: m - 1 };
    pintarCalendario();
  });
  const tit = document.createElement('span');
  tit.className = 'cal-titulo';
  tit.textContent = MESES_LARGO[m - 1] + ' ' + a;
  const bNext = document.createElement('button');
  bNext.type = 'button'; bNext.className = 'btn small'; bNext.textContent = '›';
  bNext.addEventListener('click', () => {
    mesVisible = (m === 12) ? { a: a + 1, m: 1 } : { a, m: m + 1 };
    pintarCalendario();
  });
  const bHoy = document.createElement('button');
  bHoy.type = 'button'; bHoy.className = 'btn small'; bHoy.textContent = 'Hoy';
  bHoy.addEventListener('click', () => {
    const h = new Date();
    mesVisible = { a: h.getFullYear(), m: h.getMonth() + 1 };
    pintarCalendario();
  });
  cab.append(bPrev, tit, bNext, bHoy);
  cont.appendChild(cab);

  // Rejilla
  const rej = document.createElement('div');
  rej.className = 'cal-rejilla';
  for (const d of ['L','M','X','J','V','S','D']) {
    const c = document.createElement('div');
    c.className = 'cal-dow';
    c.textContent = d;
    rej.appendChild(c);
  }

  const primero = new Date(a, m - 1, 1);
  const hueco = (primero.getDay() + 6) % 7;      // lunes primero
  const diasMes = new Date(a, m, 0).getDate();
  const hoy = isoDe(new Date());

  for (let i = 0; i < hueco; i++) {
    const c = document.createElement('div');
    c.className = 'cal-dia cal-fuera';
    rej.appendChild(c);
  }

  for (let dia = 1; dia <= diasMes; dia++) {
    const iso = a + '-' + String(m).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    const turnos = diasConTurno[iso] || [];
    const vac = Object.prototype.hasOwnProperty.call(diasVacaciones, iso);

    const c = document.createElement('div');
    c.className = 'cal-dia'
      + (iso === hoy ? ' cal-hoy' : '')
      + (vac ? ' cal-vac' : '')
      + (turnos.length ? ' cal-con-turno' : '');

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = dia;
    c.appendChild(num);

    if (vac) {
      const s = document.createElement('span');
      s.className = 'cal-playa';
      s.textContent = '🏖';
      c.appendChild(s);
    } else if (turnos.length) {
      const puntos = document.createElement('span');
      puntos.className = 'cal-puntos';
      for (const t of turnos.slice(0, 3)) {
        const p = document.createElement('i');
        p.style.background = t.color;
        puntos.appendChild(p);
      }
      c.appendChild(puntos);
    }

    const partes = [];
    if (vac) partes.push('Vacaciones' + (diasVacaciones[iso] ? ': ' + diasVacaciones[iso] : ''));
    for (const t of turnos) partes.push(t.label);
    if (partes.length) c.title = partes.join(' · ');

    rej.appendChild(c);
  }
  cont.appendChild(rej);

  const ley = document.createElement('div');
  ley.className = 'cal-leyenda';
  ley.innerHTML = '<span class="cl cl-turno">Con turno</span>'
    + '<span class="cl cl-vac">Vacaciones</span>'
    + '<span class="cl cl-hoy">Hoy</span>';
  cont.appendChild(ley);
}

/* ---------- Mis turnos ---------- */
export async function abrirMisTurnos() {
  const cont = $('mis-turnos');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    cargado = false;
    await cargarBase();
    if (!ctx.workerId) {
      cont.innerHTML = '<span class="empty-note">Tu cuenta todavía no está enlazada a una ficha de trabajador. Habla con tu responsable.</span>';
      return;
    }
    cont.innerHTML = '';
    await cargarCalendario();
    pintarCalendario();

    if (semanas.length === 0) {
      const aviso = document.createElement('div');
      aviso.className = 'panel';
      aviso.innerHTML = '<span class="empty-note">Todavía no hay ningún cuadrante publicado.</span>';
      cont.appendChild(aviso);
      return;
    }

    // Semana publicada más reciente y las siguientes que ya estén visibles
    for (const s of semanas.slice(0, 4)) {
      const cfg = s.config_snapshot || {};
      const DAYS = cfg.days || [];
      const ROLES = cfg.roles || [];
      const filas = await asignacionesDe(s.id);

      const mios = [];
      for (const a of filas) {
        const esMio = a.is_all || a.worker_id === ctx.workerId;
        if (!esMio) continue;
        const d = DAYS.find((x) => x.id === a.day_id);
        const r = ROLES.find((x) => x.id === a.position_id);
        if (!d) continue;
        const iBase = DAYS.filter((x) => !x.night).findIndex((x) => x.id === a.day_id.replace(/N$/, ''));
        mios.push({
          orden: DAYS.findIndex((x) => x.id === a.day_id),
          fecha: iBase >= 0 ? sumarDias(s.start_date, iBase) : null,
          dia: d.label,
          puesto: a.is_all ? 'Día completo (TODOS)' : (r ? r.label : ''),
          todos: a.is_all,
        });
      }
      mios.sort((a, b) => a.orden - b.orden);

      const bloque = document.createElement('div');
      bloque.className = 'panel';
      const h = document.createElement('h2');
      h.textContent = etiquetaSemana(s.start_date);
      bloque.appendChild(h);

      if (mios.length === 0) {
        const p = document.createElement('span');
        p.className = 'empty-note';
        p.textContent = 'No tienes turnos esta semana.';
        bloque.appendChild(p);
      } else {
        const ul = document.createElement('div');
        ul.className = 'turno-list';
        for (const m of mios) {
          const li = document.createElement('div');
          li.className = 'turno-row' + (m.todos ? ' todos' : '');
          li.innerHTML =
            '<span class="turno-dia">' + esc(m.dia) + '</span>' +
            (m.fecha ? '<span class="turno-fecha">' + fmtCorto(m.fecha) + '</span>' : '') +
            '<span class="turno-puesto">' + esc(m.puesto) + '</span>';
          ul.appendChild(li);
        }
        bloque.appendChild(ul);
        const tot = document.createElement('div');
        tot.className = 'turno-total';
        tot.textContent = mios.length + (mios.length === 1 ? ' turno' : ' turnos');
        bloque.appendChild(tot);
      }
      cont.appendChild(bloque);
    }
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}
