// Pestaña Tareas: checklist del día y gestión de tareas repetitivas.
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import {
  listarTareas, crearTarea, actualizarTarea, borrarTarea,
  completadas, marcarHecha, desmarcar, tocaHoy, textoRepeticion, hoyIso,
} from '../data/tareas.js';

const $ = (id) => document.getElementById(id);
const DIAS = [
  { v: 1, l: 'L' }, { v: 2, l: 'M' }, { v: 3, l: 'X' }, { v: 4, l: 'J' },
  { v: 5, l: 'V' }, { v: 6, l: 'S' }, { v: 0, l: 'D' },
];

let tareas = [];
let hechasHoy = new Set();

export function initTareas() {
  $('btn-nueva-tarea').addEventListener('click', crear);
  document.querySelectorAll('input[name="tarea-repite"]').forEach((r) => {
    r.addEventListener('change', pintarOpciones);
  });
  pintarOpciones();
}

function pintarOpciones() {
  const tipo = document.querySelector('input[name="tarea-repite"]:checked').value;
  $('tarea-dias').hidden = (tipo !== 'weekly');
  $('tarea-fecha-wrap').hidden = (tipo !== 'once');
}

export async function abrirTareas() {
  const hoy = $('tareas-hoy');
  hoy.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    const iso = hoyIso();
    tareas = await listarTareas(false);
    const comp = await completadas(iso, iso);
    hechasHoy = new Set(comp.map((c) => c.task_id));
    pintarHoy(iso);
    pintarTodas();
    await refrescarContadorTareas();
  } catch (err) {
    hoy.innerHTML = '';
    toast(err.message);
  }
}

/* ---------- Checklist de hoy ---------- */
function pintarHoy(iso) {
  const cont = $('tareas-hoy');
  cont.innerHTML = '';
  const deHoy = tareas.filter((t) => t.active && tocaHoy(t, iso));
  if (deHoy.length === 0) {
    cont.innerHTML = '<span class="empty-note">No hay tareas para hoy.</span>';
    return;
  }
  const pend = deHoy.filter((t) => !hechasHoy.has(t.id)).length;
  const res = document.createElement('div');
  res.className = 'tarea-resumen';
  res.textContent = pend === 0
    ? '¡Todo hecho por hoy! ✓'
    : pend + (pend === 1 ? ' tarea pendiente' : ' tareas pendientes')
      + ' de ' + deHoy.length;
  cont.appendChild(res);

  for (const t of deHoy) cont.appendChild(filaHoy(t, iso));
}

function filaHoy(t, iso) {
  const hecha = hechasHoy.has(t.id);
  const f = document.createElement('label');
  f.className = 'tarea-check' + (hecha ? ' hecha' : '');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = hecha;
  cb.addEventListener('change', async () => {
    cb.disabled = true;
    try {
      if (cb.checked) { await marcarHecha(t.id, iso); hechasHoy.add(t.id); }
      else { await desmarcar(t.id, iso); hechasHoy.delete(t.id); }
      pintarHoy(iso);
      refrescarContadorTareas();
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err.message);
    } finally { cb.disabled = false; }
  });

  const txt = document.createElement('div');
  txt.className = 'tarea-txt';
  const t1 = document.createElement('div');
  t1.className = 'tarea-titulo';
  t1.textContent = t.title;
  txt.appendChild(t1);
  if (t.detail) {
    const t2 = document.createElement('div');
    t2.className = 'tarea-detalle';
    t2.textContent = t.detail;
    txt.appendChild(t2);
  }
  const t3 = document.createElement('div');
  t3.className = 'tarea-repite';
  t3.textContent = textoRepeticion(t);
  if (t.repeat_type === 'once' && t.due_date && t.due_date < iso) {
    t3.textContent += ' · atrasada';
    t3.classList.add('atrasada');
  }
  txt.appendChild(t3);

  f.append(cb, txt);
  return f;
}

/* ---------- Gestión ---------- */
function pintarTodas() {
  const cont = $('tareas-todas');
  cont.innerHTML = '';
  if (tareas.length === 0) {
    cont.innerHTML = '<span class="empty-note">Todavía no has creado ninguna tarea.</span>';
    return;
  }
  for (const t of tareas) cont.appendChild(filaGestion(t));
}

function filaGestion(t) {
  const f = document.createElement('div');
  f.className = 'tarea-row' + (t.active ? '' : ' apagada');

  const cab = document.createElement('div');
  cab.className = 'tarea-row-cab';

  const izq = document.createElement('div');
  izq.className = 'tarea-row-main';
  const tit = document.createElement('div');
  tit.className = 'tarea-row-titulo';
  tit.textContent = t.title;
  const meta = document.createElement('div');
  meta.className = 'tarea-row-meta';
  meta.textContent = textoRepeticion(t)
    + (t.detail ? ' · ' + t.detail : '')
    + (t.active ? '' : ' · pausada');
  izq.append(tit, meta);

  const acciones = document.createElement('div');
  acciones.className = 'tarea-row-acciones';

  const bEdit = document.createElement('button');
  bEdit.type = 'button'; bEdit.className = 'btn small';
  bEdit.textContent = 'Editar';

  const bAct = document.createElement('button');
  bAct.type = 'button'; bAct.className = 'btn small';
  bAct.textContent = t.active ? 'Pausar' : 'Reactivar';
  bAct.addEventListener('click', async () => {
    try { await actualizarTarea(t.id, { active: !t.active }); abrirTareas(); }
    catch (err) { toast(err.message); }
  });

  const bDel = document.createElement('button');
  bDel.type = 'button'; bDel.className = 'del'; bDel.textContent = '✕';
  bDel.title = 'Eliminar tarea';
  bDel.addEventListener('click', async () => {
    const ok = await confirmar(
      'Se eliminará «' + t.title + '» y su historial de días completados. ¿Continuar?',
      { textoOk: 'Eliminar', peligro: true });
    if (!ok) return;
    try { await borrarTarea(t.id); toast('Tarea eliminada'); abrirTareas(); }
    catch (err) { toast(err.message); }
  });

  acciones.append(bEdit, bAct, bDel);
  cab.append(izq, acciones);
  f.appendChild(cab);

  // Panel de edición: mismas opciones que al crear
  const editor = document.createElement('div');
  editor.className = 'tarea-editor';
  editor.hidden = true;
  f.appendChild(editor);

  bEdit.addEventListener('click', () => {
    if (!editor.hidden) { editor.hidden = true; bEdit.textContent = 'Editar'; return; }
    editor.hidden = false;
    bEdit.textContent = 'Cerrar';
    pintarEditor(t, editor);
  });

  return f;
}

function pintarEditor(t, cont) {
  cont.innerHTML = '';

  const campo = (etiqueta, el) => {
    const w = document.createElement('label');
    w.className = 'ed-campo';
    const s = document.createElement('span');
    s.textContent = etiqueta;
    w.append(s, el);
    return w;
  };

  const tit = document.createElement('input');
  tit.type = 'text'; tit.value = t.title; tit.maxLength = 120;

  const det = document.createElement('input');
  det.type = 'text'; det.value = t.detail || ''; det.maxLength = 200;
  det.placeholder = 'Opcional';

  // Tipo de repetición
  const radios = document.createElement('div');
  radios.className = 'tarea-radios';
  const nombreGrupo = 'ed-rep-' + t.id;
  const opciones = [
    { v: 'once',   l: 'Un día' },
    { v: 'daily',  l: 'Todos los días' },
    { v: 'weekly', l: 'Días concretos' },
  ];
  for (const o of opciones) {
    const l = document.createElement('label');
    l.className = 'check';
    const r = document.createElement('input');
    r.type = 'radio'; r.name = nombreGrupo; r.value = o.v;
    r.checked = (t.repeat_type === o.v);
    r.addEventListener('change', refrescar);
    l.append(r, document.createTextNode(' ' + o.l));
    radios.appendChild(l);
  }

  // Días de la semana
  const dias = document.createElement('div');
  dias.className = 'tarea-dias';
  const DIAS_UI = [[1,'L'],[2,'M'],[3,'X'],[4,'J'],[5,'V'],[6,'S'],[0,'D']];
  for (const [v, l] of DIAS_UI) {
    const lab = document.createElement('label');
    lab.className = 'dia-chip';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.value = v; c.className = 'ed-dia';
    c.checked = (t.repeat_days || []).includes(v);
    const sp = document.createElement('span');
    sp.textContent = l;
    lab.append(c, sp);
    dias.appendChild(lab);
  }

  const fecha = document.createElement('input');
  fecha.type = 'date';
  fecha.value = t.due_date || '';

  const wDias = campo('Días de la semana', dias);
  const wFecha = campo('Fecha', fecha);

  function refrescar() {
    const tipo = cont.querySelector('input[name="' + nombreGrupo + '"]:checked').value;
    wDias.hidden = (tipo !== 'weekly');
    wFecha.hidden = (tipo !== 'once');
  }

  const guardar = document.createElement('button');
  guardar.type = 'button'; guardar.className = 'btn primary small';
  guardar.textContent = 'Guardar cambios';
  guardar.addEventListener('click', async () => {
    const titulo = tit.value.trim();
    if (!titulo) { toast('El nombre no puede quedar vacío'); return; }
    const tipo = cont.querySelector('input[name="' + nombreGrupo + '"]:checked').value;

    const campos = {
      title: titulo,
      detail: det.value.trim() || null,
      repeat_type: tipo,
      repeat_days: [],
      due_date: null,
    };
    if (tipo === 'weekly') {
      const sel = [...cont.querySelectorAll('.ed-dia:checked')].map((c) => Number(c.value));
      if (sel.length === 0) { toast('Elige al menos un día de la semana'); return; }
      campos.repeat_days = sel;
    } else if (tipo === 'once') {
      campos.due_date = fecha.value || hoyIso();
    }

    guardar.disabled = true;
    try {
      await actualizarTarea(t.id, campos);
      toast('Tarea actualizada');
      await abrirTareas();
    } catch (err) { toast(err.message); guardar.disabled = false; }
  });

  cont.append(
    campo('Nombre', tit),
    campo('Detalle', det),
    campo('Repetición', radios),
    wDias, wFecha, guardar,
  );
  refrescar();
}

async function crear() {
  const title = $('tarea-titulo').value.trim();
  if (!title) { toast('Escribe el nombre de la tarea'); return; }
  const detail = $('tarea-detalle').value.trim() || null;
  const tipo = document.querySelector('input[name="tarea-repite"]:checked').value;

  const campos = { title, detail, repeat_type: tipo, sort_order: tareas.length };
  if (tipo === 'weekly') {
    const dias = [...document.querySelectorAll('.tarea-dia:checked')].map((c) => Number(c.value));
    if (dias.length === 0) { toast('Elige al menos un día de la semana'); return; }
    campos.repeat_days = dias;
  } else if (tipo === 'once') {
    campos.due_date = $('tarea-fecha').value || hoyIso();
  }

  const btn = $('btn-nueva-tarea');
  btn.disabled = true;
  try {
    await crearTarea(campos);
    $('tarea-titulo').value = '';
    $('tarea-detalle').value = '';
    $('tarea-fecha').value = '';
    document.querySelectorAll('.tarea-dia').forEach((c) => { c.checked = false; });
    toast('Tarea añadida');
    await abrirTareas();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
}

/* Contador de pendientes en la pestaña, como en Solicitudes */
export async function refrescarContadorTareas() {
  try {
    const iso = hoyIso();
    const lista = tareas.length ? tareas : await listarTareas(false);
    tareas = lista;
    const comp = await completadas(iso, iso);
    const hechas = new Set(comp.map((c) => c.task_id));
    const pend = lista.filter((t) => t.active && tocaHoy(t, iso) && !hechas.has(t.id)).length;
    const badge = $('badge-tareas');
    if (badge) { badge.textContent = pend; badge.hidden = (pend === 0); }
    return pend;
  } catch (_) { return 0; }
}

/* Resumen para el panel de Hoy */
export async function pendientesDeHoy() {
  const iso = hoyIso();
  const lista = await listarTareas(true);
  const comp = await completadas(iso, iso);
  const hechas = new Set(comp.map((c) => c.task_id));
  const deHoy = lista.filter((t) => tocaHoy(t, iso));
  return {
    total: deHoy.length,
    pendientes: deHoy.filter((t) => !hechas.has(t.id)),
  };
}
