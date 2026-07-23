// Vistas del empleado: cuadrante publicado (solo lectura) y "mis turnos". v9
import { toast } from './toast.js?v=17';
import { ctx } from '../auth.js?v=17';
import { semanasVisibles, asignacionesDe, plantilla } from '../data/empleado.js?v=17';
import { etiquetaSemana, sumarDias, fmtCorto } from '../data/semanas.js?v=17';

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
    if (semanas.length === 0) {
      cont.innerHTML = '<span class="empty-note">Todavía no hay ningún cuadrante publicado.</span>';
      return;
    }

    cont.innerHTML = '';
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
