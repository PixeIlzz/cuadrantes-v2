// Panel de hoy: lo que el gestor necesita ver de un vistazo al abrir la app.
import { toast } from './toast.js';
import { ctx } from '../auth.js';
import { listarEquipo } from '../data/equipo.js';
import { contarPendientes } from '../data/solicitudes.js';
import { pendientesDeHoy } from './tareas.js';
import { marcarHecha, desmarcar, tocaHoy, listarTareas } from '../data/tareas.js';
import { completadas } from '../data/tareas.js';
import {
  lunesDe, sumarDias, etiquetaSemana, buscarSemana, cargarAsignaciones,
  esVisible, estadoBase, ETIQUETA_ESTADO,
} from '../data/semanas.js';

const ALL_ID = 'ALL';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let alIrA = null;   // callback para saltar a otra pestaña

export function initHoy(navegar) { alIrA = navegar; }

const hoyIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

export async function abrirHoy() {
  const cont = $('panel-hoy');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    const hoy = hoyIso();
    const lunes = lunesDe(new Date());
    const [equipo, semana, pendientes] = await Promise.all([
      listarEquipo(),
      buscarSemana(lunes),
      contarPendientes(),
    ]);

    cont.innerHTML = '';
    cont.appendChild(cabecera(hoy, semana, lunes));
    if (pendientes > 0) cont.appendChild(tarjetaSolicitudes(pendientes));
    cont.appendChild(await tarjetaTareas());
    cont.appendChild(await tarjetaTurnosHoy(hoy, lunes, semana, equipo));
    cont.appendChild(tarjetaVacaciones(hoy, equipo));
    cont.appendChild(tarjetaProximasVacaciones(hoy, equipo));
    if (semana) cont.appendChild(await tarjetaMinimos(semana));
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

function panel(titulo) {
  const p = document.createElement('div');
  p.className = 'panel';
  if (titulo) {
    const h = document.createElement('h2');
    h.textContent = titulo;
    p.appendChild(h);
  }
  return p;
}

function cabecera(hoy, semana, lunes) {
  const p = panel(null);
  p.className = 'panel panel-hoy-cab';
  const f = new Date(hoy + 'T12:00:00');
  const t = document.createElement('div');
  t.className = 'hoy-fecha';
  t.textContent = f.toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'long' });
  const sub = document.createElement('div');
  sub.className = 'hoy-sub';
  if (!semana) {
    sub.textContent = 'La semana en curso (' + etiquetaSemana(lunes) + ') todavía no existe.';
  } else {
    sub.textContent = etiquetaSemana(lunes) + ' · ' + ETIQUETA_ESTADO[estadoBase(semana)]
      + (esVisible(semana) ? ' · la ve el equipo' : ' · el equipo no la ve');
  }
  p.append(t, sub);
  return p;
}

function tarjetaSolicitudes(n) {
  const p = panel(null);
  p.className = 'panel panel-alerta';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hoy-alerta';
  b.innerHTML = '<span class="hoy-alerta-num">' + n + '</span>'
    + '<span>' + (n === 1 ? 'solicitud pendiente' : 'solicitudes pendientes') + '</span>'
    + '<span class="hoy-alerta-ir">Ver →</span>';
  b.addEventListener('click', () => alIrA && alIrA('solicitudes'));
  p.appendChild(b);
  return p;
}

async function tarjetaTurnosHoy(hoy, lunes, semana, equipo) {
  const p = panel('Hoy trabajan');
  if (!semana) {
    p.appendChild(vacio('No hay cuadrante para esta semana.'));
    return p;
  }
  const cfg = semana.config_snapshot || {};
  const DAYS = cfg.days || [];
  const ROLES = cfg.roles || [];

  // Columnas que corresponden a hoy (día y, si existe, noche)
  const base = DAYS.filter((d) => !d.night);
  const idx = Math.round((new Date(hoy) - new Date(lunes)) / 86400000);
  const hoyBase = base[idx];
  if (!hoyBase) {
    p.appendChild(vacio('Hoy no es un día del cuadrante.'));
    return p;
  }
  const columnas = DAYS.filter((d) => d.id === hoyBase.id || d.id === hoyBase.id + 'N');

  const filas = await cargarAsignaciones(semana.id);
  const nombre = (id) => (equipo.find((w) => w.id === id) || {}).name || '?';

  let algo = false;
  for (const col of columnas) {
    const bloque = document.createElement('div');
    bloque.className = 'hoy-col';
    const h = document.createElement('div');
    h.className = 'hoy-col-nom';
    h.textContent = col.label;
    bloque.appendChild(h);

    const delDia = filas.filter((a) => a.day_id === col.id);
    if (delDia.some((a) => a.is_all)) {
      const chip = document.createElement('span');
      chip.className = 'persona-chip persona-todos';
      chip.textContent = 'TODOS · día completo';
      bloque.appendChild(chip);
      algo = true;
    } else if (delDia.length === 0) {
      bloque.appendChild(vacio('Nadie asignado.'));
    } else {
      for (const r of ROLES) {
        const gente = delDia.filter((a) => a.position_id === r.id);
        if (gente.length === 0) continue;
        const fila = document.createElement('div');
        fila.className = 'hoy-rol';
        const et = document.createElement('span');
        et.className = 'hoy-rol-nom';
        et.textContent = r.label;
        const caja = document.createElement('span');
        caja.className = 'hoy-rol-gente';
        for (const a of gente) {
          const ficha = document.createElement('span');
          ficha.className = 'persona-chip rol-' + (ROLES.indexOf(r) % 3);
          ficha.textContent = nombre(a.worker_id);
          caja.appendChild(ficha);
        }
        fila.append(et, caja);
        bloque.appendChild(fila);
        algo = true;
      }
    }
    p.appendChild(bloque);
  }
  if (!algo && columnas.length) p.appendChild(vacio('Nadie asignado hoy.'));
  return p;
}

function tarjetaVacaciones(hoy, equipo) {
  const p = panel('De vacaciones hoy');
  const deVacas = equipo.filter((w) =>
    (w.vacs || []).some((v) => v.start_date <= hoy && v.end_date >= hoy));
  if (deVacas.length === 0) {
    p.appendChild(vacio('Nadie está de vacaciones hoy.'));
    return p;
  }
  const lista = document.createElement('div');
  lista.className = 'hoy-vacas';
  for (const w of deVacas) {
    const v = w.vacs.find((x) => x.start_date <= hoy && x.end_date >= hoy);
    const el = document.createElement('div');
    el.className = 'hoy-vac';
    el.innerHTML = '<span>🏖 <b>' + esc(w.name) + '</b></span>'
      + '<span class="hoy-vac-hasta">hasta el ' + v.end_date.split('-').reverse().slice(0, 2).join('/') + '</span>'
      + (v.note ? '<span class="hoy-vac-nota">' + esc(v.note) + '</span>' : '');
    lista.appendChild(el);
  }
  p.appendChild(lista);
  return p;
}

/* Avisos de vacaciones que empiezan en los próximos 14 días */
function tarjetaProximasVacaciones(hoy, equipo) {
  const p = panel('Vacaciones próximas (2 semanas)');
  const limite = sumarDias(hoy, 14);
  const proximas = [];
  for (const w of equipo) {
    for (const v of (w.vacs || [])) {
      if (v.start_date > hoy && v.start_date <= limite) {
        proximas.push({ nombre: w.name, ...v });
      }
    }
  }
  proximas.sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (proximas.length === 0) {
    p.appendChild(vacio('Nadie empieza vacaciones en las próximas dos semanas.'));
    return p;
  }
  const lista = document.createElement('div');
  lista.className = 'hoy-vacas';
  for (const v of proximas) {
    const dias = Math.round((new Date(v.start_date) - new Date(hoy)) / 86400000);
    const el = document.createElement('div');
    el.className = 'hoy-vac hoy-vac-prox';
    el.innerHTML = '<span>🏖 <b>' + esc(v.nombre) + '</b></span>'
      + '<span class="hoy-vac-hasta">'
      + (dias === 1 ? 'mañana' : 'en ' + dias + ' días')
      + ' · del ' + v.start_date.split('-').reverse().slice(0, 2).join('/')
      + ' al ' + v.end_date.split('-').reverse().slice(0, 2).join('/') + '</span>'
      + (v.note ? '<span class="hoy-vac-nota">' + esc(v.note) + '</span>' : '');
    lista.appendChild(el);
  }
  p.appendChild(lista);
  return p;
}

/* Checklist del día, marcable desde aquí mismo */
async function tarjetaTareas() {
  const p = panel('Tareas de hoy');
  const cont = document.createElement('div');
  cont.className = 'hoy-tareas';
  p.appendChild(cont);

  async function pintar() {
    cont.innerHTML = '<span class="empty-note">Cargando…</span>';
    try {
      const iso = hoyIso();
      const lista = (await listarTareas(true)).filter((t) => tocaHoy(t, iso));
      const hechas = new Set((await completadas(iso, iso)).map((c) => c.task_id));

      cont.innerHTML = '';
      if (lista.length === 0) {
        cont.appendChild(vacio('No hay tareas para hoy.'));
        return;
      }
      const pend = lista.filter((t) => !hechas.has(t.id)).length;
      const res = document.createElement('div');
      res.className = 'hoy-tareas-res';
      res.textContent = pend === 0
        ? 'Todas hechas por hoy ✓'
        : pend + (pend === 1 ? ' pendiente' : ' pendientes') + ' de ' + lista.length;
      cont.appendChild(res);

      for (const t of lista) {
        const hecha = hechas.has(t.id);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tarea-chip' + (hecha ? ' hecha' : '');
        chip.innerHTML = '<span class="tarea-chip-caja">' + (hecha ? '✓' : '') + '</span>'
          + '<span class="tarea-chip-txt"></span>';
        chip.querySelector('.tarea-chip-txt').textContent = t.title;
        chip.title = hecha ? 'Marcar como pendiente' : 'Marcar como hecha';
        chip.addEventListener('click', async () => {
          chip.disabled = true;
          try {
            if (hecha) await desmarcar(t.id, iso);
            else await marcarHecha(t.id, iso);
            await pintar();
          } catch (err) { toast(err.message); chip.disabled = false; }
        });
        cont.appendChild(chip);
      }

      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small';
      b.textContent = 'Ir a Tareas';
      b.addEventListener('click', () => alIrA && alIrA('tareas'));
      cont.appendChild(b);
    } catch (err) {
      cont.innerHTML = '';
      cont.appendChild(vacio('No se pudieron cargar las tareas.'));
    }
  }

  await pintar();
  return p;
}

async function tarjetaMinimos(semana) {
  const p = panel('Puestos por debajo del mínimo');
  const cfg = semana.config_snapshot || {};
  const DAYS = cfg.days || [];
  const ROLES = cfg.roles || [];
  const filas = await cargarAsignaciones(semana.id);

  const cuenta = {};
  for (const a of filas) cuenta[a.day_id + '|' + a.position_id] =
    (cuenta[a.day_id + '|' + a.position_id] || 0) + 1;
  const conTodos = new Set(filas.filter((a) => a.is_all).map((a) => a.day_id));

  const fallos = [];
  for (const d of DAYS) {
    if (conTodos.has(d.id)) continue;
    for (const r of ROLES) {
      const n = cuenta[d.id + '|' + r.id] || 0;
      if (n < r.min) fallos.push({ dia: d.label, rol: r.label, n, min: r.min });
    }
  }
  if (fallos.length === 0) {
    p.appendChild(vacio('Todos los puestos cubiertos esta semana. ✓'));
    return p;
  }
  const lista = document.createElement('div');
  lista.className = 'hoy-min-list';
  for (const f of fallos) {
    const el = document.createElement('div');
    el.className = 'hoy-min';
    el.innerHTML = '<span>' + esc(f.dia) + '</span>'
      + '<span class="hoy-min-rol">' + esc(f.rol) + '</span>'
      + '<span class="hoy-min-num">' + f.n + '/' + f.min + '</span>';
    lista.appendChild(el);
  }
  p.appendChild(lista);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn small';
  b.textContent = 'Ir al cuadrante';
  b.addEventListener('click', () => alIrA && alIrA('cuadrante'));
  p.appendChild(b);
  return p;
}

function vacio(txt) {
  const s = document.createElement('span');
  s.className = 'empty-note';
  s.textContent = txt;
  return s;
}
