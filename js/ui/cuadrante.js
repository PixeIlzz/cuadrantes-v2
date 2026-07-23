// Pestaña Cuadrante: editor portado de la v1, guardando en Supabase. v7
import { toast } from './toast.js?v=8';
import { listarEquipo } from '../data/equipo.js?v=8';
import {
  lunesDe, sumarDias, fmtCorto, etiquetaSemana,
  obtenerOCrearSemana, cargarAsignaciones, guardarSemana,
  programarSemana, publicarAhora, despublicar, copiarSemana,
  listarSemanas, fmtMomento, localAIso,
} from '../data/semanas.js?v=8';
import { confirmar, elegirOpcion } from './confirmar.js?v=8';
import { ctx } from '../auth.js?v=8';

const ALL_ID = 'ALL';
const $ = (id) => document.getElementById(id);

/* ---------- Estado del editor ---------- */
let semana = null;        // fila de weeks
let cells = {};           // 'dia|puesto' -> [workerId | 'ALL']
let notas = {};           // {dia: 'texto'}
let equipo = [];          // trabajadores con vacaciones
let selectedId = null;
let DAYS = [];            // del config_snapshot de la semana
let ROLES = [];
let saveTimer = null;
let cargando = false;

/* ---------- Utilidades (portadas de la v1) ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleCls = (i) => ['role-cam','role-par','role-coc'][i % 3];
const cellKey = (d, r) => d + '|' + r;
function cellList(d, r) {
  const k = cellKey(d, r);
  if (!cells[k]) cells[k] = [];
  return cells[k];
}
const workerById = (id) => equipo.find((w) => w.id === id);
function dayHasAll(dayId) {
  return ROLES.some((r) => cellList(dayId, r.id).includes(ALL_ID));
}
function clearDay(dayId) {
  for (const r of ROLES) cells[cellKey(dayId, r.id)] = [];
}
function usedShifts(workerId) {
  let n = 0;
  for (const k in cells) n += cells[k].filter((id) => id === workerId).length;
  for (const d of DAYS) if (dayHasAll(d.id)) n++;
  return n;
}
function dateForDay(dayId) {
  if (!semana) return null;
  const base = DAYS.filter((d) => !d.night);
  const idx = base.findIndex((b) => b.id === dayId.replace(/N$/, ''));
  if (idx < 0) return null;
  return sumarDias(semana.start_date, idx);
}
function onVacation(w, iso) {
  return !!iso && (w.vacs || []).some((v) => v.start_date <= iso && v.end_date >= iso);
}
function vacInWeek(w) {
  if (!semana) return null;
  const fin = sumarDias(semana.start_date, 6);
  return (w.vacs || []).find((v) => v.start_date <= fin && v.end_date >= semana.start_date) || null;
}

/* ---------- Guardado (con debounce e indicador) ---------- */
function setSync(modo) {
  const el = $('sync-status');
  el.className = modo;
  el.textContent =
    modo === 'saving' ? 'Guardando…' :
    modo === 'ok'     ? 'Guardado ✓' :
    modo === 'err'    ? '⚠ Error al guardar' : '';
}
function scheduleSave() {
  if (!semana) return;
  setSync('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await guardarSemana(semana.id, filasParaGuardar(), notas);
      setSync('ok');
    } catch (err) {
      setSync('err');
      toast(err.message);
    }
  }, 700);
}
function filasParaGuardar() {
  const filas = [];
  for (const k in cells) {
    const [day, role] = k.split('|');
    cells[k].forEach((id, i) => {
      filas.push({
        day, role,
        worker: id === ALL_ID ? null : id,
        all: id === ALL_ID,
        ord: i,
      });
    });
  }
  return filas;
}

/* ---------- Carga de una semana ---------- */
async function cargar(startIso) {
  if (cargando) return;
  cargando = true;
  setSync('');
  $('grid').innerHTML = '<span class="empty-note">Cargando semana…</span>';
  try {
    equipo = await listarEquipo();
    semana = await obtenerOCrearSemana(startIso);

    const cfg = semana.config_snapshot || {};
    DAYS = cfg.days || [];
    ROLES = cfg.roles || [];
    notas = semana.notes || {};

    cells = {};
    for (const a of await cargarAsignaciones(semana.id)) {
      cellList(a.day_id, a.position_id).push(a.is_all ? ALL_ID : a.worker_id);
    }

    selectedId = null;
    pintarSelector();
    renderStrip();
    renderGrid();
  } catch (err) {
    toast(err.message);
    $('grid').innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>';
  }
  cargando = false;
}

function pintarSelector() {
  $('wk-date').value = semana.start_date;
  $('wk-label').textContent = etiquetaSemana(semana.start_date);
  const st = $('wk-status');
  st.textContent =
    semana.status === 'draft' ? 'Borrador' :
    semana.status === 'scheduled' ? 'Programada' : 'Publicada';
  st.className = 'status-chip ' + semana.status;

  const tz = (ctx.business.config.publish || {}).tz;
const info = $('wk-publish-info');
  const pub = ctx.business.config.publish || {};
  const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const reglaDefecto = DIAS[pub.weekday ?? 0] + ' a las ' + (pub.time || '18:00');

  if (semana.publish_at) {
    info.textContent =
      (semana.status === 'published' ? 'Ya publicada · visible desde el ' : 'Programada · el equipo la verá el ')
      + fmtMomento(semana.publish_at, tz)
      + (semana.publish_at_manual ? ' · fecha propia de esta semana' : ' · regla por defecto');
  } else {
    info.textContent = 'Sin programar · el equipo todavía no la ve. '
      + 'Con «Programar» se publicaría el ' + reglaDefecto + '.';
  }
  $('btn-despublicar').hidden = (semana.status === 'draft');

  // Precarga el campo con la fecha actual de publicación, si la hay
  if (semana.publish_at) {
    const d = new Date(semana.publish_at);
    const p = (n) => String(n).padStart(2, '0');
    $('wk-manual').value =
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  } else {
    $('wk-manual').value = '';
  }
}

/* ---------- Tira de trabajadores ---------- */
function renderStrip() {
  const strip = $('worker-strip');
  strip.innerHTML = '';

  const all = document.createElement('div');
  all.className = 'worker-card all-card' + (selectedId === ALL_ID ? ' selected' : '');
  all.innerHTML = '<div class="w-name">TODOS</div><div class="w-hours">Sin límite</div>';
  all.draggable = true;
  all.addEventListener('click', () => toggleSelect(ALL_ID));
  all.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', ALL_ID));
  strip.appendChild(all);

  for (const w of equipo) {
    const used = usedShifts(w.id);
    const vac = vacInWeek(w);
    const card = document.createElement('div');
    card.className = 'worker-card'
      + (selectedId === w.id ? ' selected' : '')
      + (used > w.weekly_shifts ? ' over' : used === w.weekly_shifts ? ' full' : '')
      + (vac ? ' vac' : '');
    const pct = Math.min(100, Math.round(used / w.weekly_shifts * 100));
    card.innerHTML =
      '<div class="w-name">' + esc(w.name) + '</div>' +
      '<div class="w-hours">' + used + ' / ' + w.weekly_shifts + ' turnos' + (used > w.weekly_shifts ? ' ⚠' : '') + '</div>' +
      (vac ? '<div class="w-vac">🏖 vacaciones ' + fmtCorto(vac.start_date) + ' – ' + fmtCorto(vac.end_date) + '</div>' : '') +
      '<div class="w-bar"><i style="width:' + pct + '%"></i></div>';
    card.draggable = true;
    card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', w.id));
    card.addEventListener('click', () => toggleSelect(w.id));
    strip.appendChild(card);
  }
}

function toggleSelect(id) {
  selectedId = (selectedId === id) ? null : id;
  renderStrip(); renderGrid();
}

/* ---------- Grid ---------- */
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  for (const d of DAYS) {
    const col = document.createElement('div');
    col.className = 'day-col' + (d.night ? ' night' : '');
    const selW = (selectedId && selectedId !== ALL_ID) ? workerById(selectedId) : null;
    const selVacDay = selW ? onVacation(selW, dateForDay(d.id)) : false;
    if (selVacDay) col.classList.add('vac-day');

    const name = document.createElement('div');
    name.className = 'day-name';
    name.textContent = d.label + (selVacDay ? ' 🏖' : '');
    col.appendChild(name);

    const makeNote = () => {
      const nd = document.createElement('div');
      nd.className = 'day-note';
      const ta = document.createElement('textarea');
      ta.placeholder = 'Nota…';
      ta.value = notas[d.id] || '';
      ta.maxLength = 200;
      ta.addEventListener('change', () => {
        const v = ta.value.trim();
        if (v) notas[d.id] = v; else delete notas[d.id];
        scheduleSave();
      });
      nd.appendChild(ta);
      return nd;
    };

    if (dayHasAll(d.id)) {
      const block = document.createElement('div');
      block.className = 'all-day';
      const chip = document.createElement('div');
      chip.className = 'chip all-chip all-day-chip';
      chip.innerHTML = '<span>TODOS</span><span class="x">✕</span>';
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        clearDay(d.id);
        renderStrip(); renderGrid(); scheduleSave();
      });
      block.appendChild(chip);
      const note = document.createElement('div');
      note.className = 'all-day-note';
      note.textContent = 'Día completo';
      block.appendChild(note);
      block.addEventListener('click', () => {
        if (selectedId && selectedId !== ALL_ID)
          toast('Ese día está cubierto por TODOS. Quítalo para asignar por puestos.');
      });
      block.addEventListener('dragover', (e) => e.preventDefault());
      block.addEventListener('drop', (e) => {
        e.preventDefault();
        toast('Ese día está cubierto por TODOS. Quítalo para asignar por puestos.');
      });
      col.appendChild(block);
      col.appendChild(makeNote());
      grid.appendChild(col);
      continue;
    }

    ROLES.forEach((r, ri) => {
      const block = document.createElement('div');
      block.className = 'role-block ' + roleCls(ri);
      const list = cellList(d.id, r.id);
      const ok = list.length >= r.min;
      const head = document.createElement('div');
      head.className = 'role-head';
      head.innerHTML = '<span>' + esc(r.label) + '</span>' +
        '<span class="count' + (ok ? ' ok' : '') + '">' + list.length + '/' + r.min + '</span>';
      block.appendChild(head);

      const zone = document.createElement('div');
      zone.className = 'drop-zone' + (selectedId ? ' armed' : '');

      list.forEach((id, idx) => {
        const isAll = id === ALL_ID;
        const w = isAll ? null : workerById(id);
        const chipVac = !isAll && w ? onVacation(w, dateForDay(d.id)) : false;
        const chip = document.createElement('div');
        chip.className = 'chip' + (isAll ? ' all-chip' : '')
          + (selectedId === id ? ' hl' : '') + (chipVac ? ' chip-vac' : '');
        chip.innerHTML = '<span>' + (chipVac ? '🏖 ' : '')
          + (isAll ? 'TODOS' : esc(w ? w.name : '?')) + '</span><span class="x">✕</span>';
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (selectedId) assign(d.id, r.id, selectedId);
          else removeAssignment(d.id, r.id, idx);
        });
        if (!isAll) {
          chip.draggable = true;
          chip.addEventListener('dragstart', (ev) => {
            ev.stopPropagation();
            ev.dataTransfer.setData('text/plain', 'move|' + d.id + '|' + r.id + '|' + idx + '|' + id);
          });
        }
        zone.appendChild(chip);
      });

      zone.addEventListener('click', () => {
        if (selectedId) assign(d.id, r.id, selectedId);
      });
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        if (data.startsWith('move|')) {
          const [, fromDay, fromRole, fromIdx, wid] = data.split('|');
          if (fromDay === d.id && fromRole === r.id) return;
          if (dayHasAll(d.id)) { toast('Ese día está cubierto por TODOS. Quítalo para asignar por puestos.'); return; }
          if (fromDay !== d.id) {
            for (const ro of ROLES) {
              if (cellList(d.id, ro.id).includes(wid)) {
                const w = workerById(wid);
                toast((w ? w.name : '') + ' ya está el ' + d.label.toLowerCase() + ' en ' + ro.label.toLowerCase());
                return;
              }
            }
          }
          cellList(fromDay, fromRole).splice(parseInt(fromIdx, 10), 1);
          assign(d.id, r.id, wid);
        } else {
          assign(d.id, r.id, data);
        }
      });

      block.appendChild(zone);
      col.appendChild(block);
    });

    col.appendChild(makeNote());
    grid.appendChild(col);
  }
}

/* ---------- Colocación ---------- */
function assign(dayId, roleId, id) {
  if (dayHasAll(dayId)) {
    toast('Ese día está cubierto por TODOS. Quítalo para asignar por puestos.');
    return;
  }
  if (id === ALL_ID) {
    clearDay(dayId);
    cellList(dayId, ROLES[0].id).push(ALL_ID);
    renderStrip(); renderGrid(); scheduleSave();
    return;
  }
  const w = workerById(id);
  if (!w) return;
  for (const r of ROLES) {
    if (cellList(dayId, r.id).includes(id)) {
      const day = DAYS.find((x) => x.id === dayId);
      toast(w.name + ' ya está el ' + day.label.toLowerCase() + ' en ' + r.label.toLowerCase());
      return;
    }
  }
  const dayIso = dateForDay(dayId);
  let vacWarn = false;
  if (onVacation(w, dayIso)) {
    const day = DAYS.find((x) => x.id === dayId);
    toast('Ojo: ' + w.name + ' está de vacaciones el ' + day.label.toLowerCase() + ' (' + fmtCorto(dayIso) + ')');
    vacWarn = true;
  }
  cellList(dayId, roleId).push(id);
  if (!vacWarn && usedShifts(w.id) > w.weekly_shifts) toast(w.name + ' tiene turnos de más esta semana');
  renderStrip(); renderGrid(); scheduleSave();
}

function removeAssignment(dayId, roleId, index) {
  cellList(dayId, roleId).splice(index, 1);
  renderStrip(); renderGrid(); scheduleSave();
}

/* ---------- Publicación ---------- */

/* Devuelve la lista de incumplimientos de mínimos, como el chequeo de la v1 */
function fallosDeMinimos() {
  const fallos = [];
  for (const d of DAYS) {
    if (dayHasAll(d.id)) continue;              // día completo: no aplica
    for (const r of ROLES) {
      const n = cellList(d.id, r.id).length;
      if (n < r.min) fallos.push(`${d.label}: ${r.label} ${n}/${r.min}`);
    }
  }
  return fallos;
}

async function confirmarMinimos(accion) {
  const fallos = fallosDeMinimos();
  if (fallos.length === 0) return true;
  const lista = fallos.slice(0, 6).join(' · ')
    + (fallos.length > 6 ? ` y ${fallos.length - 6} más` : '');
  return confirmar(
    `No se llega al mínimo en ${fallos.length} puesto(s):\n${lista}\n\n¿${accion} igualmente?`,
    { textoOk: accion, peligro: true }
  );
}

async function guardarYa() {
  clearTimeout(saveTimer);
  await guardarSemana(semana.id, filasParaGuardar(), notas);
  setSync('ok');
}

async function accionPublicar() {
  if (!(await confirmarMinimos('Publicar'))) return;
  try {
    await guardarYa();
    await publicarAhora(semana.id);
    semana.status = 'published';
    semana.publish_at = new Date().toISOString();
    pintarSelector();
    toast('Semana publicada. Ya es visible para el equipo.');
  } catch (err) { toast(err.message); }
}

async function accionProgramar() {
  if (!(await confirmarMinimos('Programar'))) return;
  try {
    await guardarYa();
    const at = await programarSemana(semana.id, null);
    semana.publish_at = at;
    semana.publish_at_manual = false;
    semana.status = new Date(at) <= new Date() ? 'published' : 'scheduled';
    pintarSelector();
    const tz = (ctx.business.config.publish || {}).tz;
    toast('Se publicará el ' + fmtMomento(at, tz));
  } catch (err) { toast(err.message); }
}

async function accionFechaManual() {
  const valor = $('wk-manual').value;
  if (!valor) { toast('Elige fecha y hora'); return; }
  if (!(await confirmarMinimos('Programar'))) return;
  try {
    await guardarYa();
    const at = await programarSemana(semana.id, localAIso(valor));
    semana.publish_at = at;
    semana.publish_at_manual = true;
    semana.status = new Date(at) <= new Date() ? 'published' : 'scheduled';
    pintarSelector();
    toast('Publicación fijada para esta semana');
  } catch (err) { toast(err.message); }
}

async function accionDespublicar() {
  const ok = await confirmar(
    'La semana volverá a borrador y dejará de verse por el equipo. ¿Continuar?',
    { textoOk: 'Pasar a borrador', peligro: true });
  if (!ok) return;
  try {
    await despublicar(semana.id);
    semana.status = 'draft';
    semana.publish_at = null;
    semana.publish_at_manual = false;
    pintarSelector();
    toast('Semana en borrador');
  } catch (err) { toast(err.message); }
}

async function accionCopiarDe() {
  try {
    const todas = (await listarSemanas()).filter((w) => w.id !== semana.id);
    if (todas.length === 0) { toast('No hay otras semanas para copiar'); return; }
    const elegida = await elegirOpcion('Copiar el contenido de…', todas.slice(0, 20).map((w) => ({
      valor: w.id,
      etiqueta: etiquetaSemana(w.start_date),
      nota: w.status === 'draft' ? 'Borrador'
          : w.status === 'scheduled' ? 'Programada' : 'Publicada',
    })));
    if (!elegida) return;
    const ok = await confirmar(
      'Se reemplazará todo el contenido de la semana en edición. ¿Continuar?',
      { textoOk: 'Copiar', peligro: true });
    if (!ok) return;
    await copiarSemana(elegida, semana.id);
    await cargar(semana.start_date);
    toast('Semana copiada');
  } catch (err) { toast(err.message); }
}

/* ---------- API pública de la pestaña ---------- */
export function initCuadrante() {
  $('wk-prev').addEventListener('click', () => cargar(sumarDias(semana.start_date, -7)));
  $('wk-next').addEventListener('click', () => cargar(sumarDias(semana.start_date, 7)));
  $('wk-date').addEventListener('change', () => {
    const v = $('wk-date').value;
    if (!v) return;
    const [y, m, d] = v.split('-').map(Number);
    cargar(lunesDe(new Date(y, m - 1, d)));
  });
  $('btn-publicar').addEventListener('click', accionPublicar);
  $('btn-programar').addEventListener('click', accionProgramar);
  $('btn-manual').addEventListener('click', accionFechaManual);
  $('btn-despublicar').addEventListener('click', accionDespublicar);
  $('btn-copiar').addEventListener('click', accionCopiarDe);
}

export async function abrirCuadrante(startIso = null) {
  if (startIso) { await cargar(startIso); return; }
  if (semana) { await cargar(semana.start_date); return; }
  await cargar(lunesDe(new Date()));
}
