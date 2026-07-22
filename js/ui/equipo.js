// Pestaña Equipo: interfaz calcada a la v1, datos contra Supabase.
import { toast } from './toast.js?v=6';
import {
  listarEquipo, crearTrabajador, actualizarTrabajador, borrarTrabajador,
  crearVacacion, actualizarVacacion, borrarVacacion,
} from '../data/equipo.js?v=6';

let equipo = [];      // caché en memoria de la última carga
let cargado = false;

const $ = (id) => document.getElementById(id);

export function initEquipo() {
  $('btn-add').addEventListener('click', alta);
  $('new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
  $('new-hours').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
}

/* Se llama cada vez que se abre la pestaña: recarga de la base de datos
   (así ves lo último aunque hayas editado desde otro dispositivo). */
export async function abrirEquipo() {
  const list = $('worker-list');
  if (!cargado) list.innerHTML = '<span class="empty-note">Cargando equipo…</span>';
  try {
    equipo = await listarEquipo();
    cargado = true;
    render();
  } catch (err) {
    list.innerHTML = '';
    toast(err.message);
  }
}

async function alta() {
  const nameIn = $('new-name');
  const hoursIn = $('new-hours');
  const name = nameIn.value.trim();
  const shifts = parseInt(hoursIn.value, 10);
  if (!name) { toast('Escribe un nombre'); return; }
  if (!(shifts >= 1 && shifts <= 20)) { toast('Turnos entre 1 y 20'); return; }
  try {
    const nuevo = await crearTrabajador(name, shifts, equipo.length);
    equipo.push(nuevo);
    nameIn.value = ''; hoursIn.value = '';
    nameIn.focus();
    render();
  } catch (err) { toast(err.message); }
}

function render() {
  const list = $('worker-list');
  list.innerHTML = '';
  if (equipo.length === 0) {
    list.innerHTML = '<span class="empty-note">Sin trabajadores todavía. Añade el primero arriba.</span>';
    return;
  }
  for (const w of equipo) list.append(...filaTrabajador(w));
}

function filaTrabajador(w) {
  const row = document.createElement('div');
  row.className = 'worker-row';

  // Nombre editable en línea
  const nameIn = document.createElement('input');
  nameIn.type = 'text'; nameIn.value = w.name; nameIn.maxLength = 30;
  nameIn.addEventListener('change', async () => {
    const v = nameIn.value.trim();
    if (!v) { nameIn.value = w.name; return; }
    try { await actualizarTrabajador(w.id, { name: v }); w.name = v; }
    catch (err) { nameIn.value = w.name; toast(err.message); }
  });

  // Turnos semanales
  const hoursIn = document.createElement('input');
  hoursIn.type = 'number'; hoursIn.min = 1; hoursIn.max = 20; hoursIn.value = w.weekly_shifts;
  hoursIn.addEventListener('change', async () => {
    const v = parseInt(hoursIn.value, 10);
    if (!(v >= 1 && v <= 20)) { hoursIn.value = w.weekly_shifts; return; }
    try { await actualizarTrabajador(w.id, { weekly_shifts: v }); w.weekly_shifts = v; }
    catch (err) { hoursIn.value = w.weekly_shifts; toast(err.message); }
  });

  const lbl = document.createElement('span');
  lbl.className = 'h-label'; lbl.textContent = 'turnos/sem';

  // Botón vacaciones 🏖 con panel desplegable
  const vacBtn = document.createElement('button');
  vacBtn.type = 'button';
  vacBtn.className = 'btn small';
  vacBtn.textContent = '🏖 ' + w.vacs.length;
  vacBtn.title = 'Vacaciones';

  // Borrar con confirmación en dos toques (como la v1)
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del'; del.textContent = '✕'; del.title = 'Eliminar';
  del.addEventListener('click', async () => {
    if (!del._armed) {
      del._armed = setTimeout(() => { del._armed = null; del.textContent = '✕'; }, 3000);
      del.textContent = '¿Borrar?';
      return;
    }
    clearTimeout(del._armed); del._armed = null;
    try {
      await borrarTrabajador(w.id);
      equipo = equipo.filter((x) => x.id !== w.id);
      render();
      toast(w.name + ' eliminado');
    } catch (err) { toast(err.message); }
  });

  row.append(nameIn, hoursIn, lbl, vacBtn, del);

  // Panel de vacaciones
  const panel = document.createElement('div');
  panel.className = 'vac-panel';
  panel.hidden = true;

  const pintaPanel = () => {
    panel.innerHTML = '';
    if (w.vacs.length === 0) {
      const p = document.createElement('span');
      p.className = 'h-label'; p.textContent = 'Sin periodos de vacaciones.';
      panel.appendChild(p);
    }
    for (const vac of w.vacs) panel.appendChild(filaVacacion(w, vac, vacBtn, pintaPanel));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn small';
    add.textContent = 'Añadir periodo';
    add.addEventListener('click', () => {
      // Fila local sin guardar: se inserta en la base de datos al tener ambas fechas
      w.vacs.push({ id: null, start_date: '', end_date: '' });
      pintaPanel();
    });
    panel.appendChild(add);
  };

  vacBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) pintaPanel();
  });

  return [row, panel];
}

function filaVacacion(w, vac, vacBtn, pintaPanel) {
  const vr = document.createElement('div');
  vr.className = 'vac-row';

  const from = document.createElement('input');
  from.type = 'date'; from.value = vac.start_date || '';
  const to = document.createElement('input');
  to.type = 'date'; to.value = vac.end_date || '';

  const guardar = async () => {
    if (!from.value || !to.value) return;             // aún incompleto
    if (from.value > to.value) { toast('El inicio no puede ser posterior al fin'); return; }
    try {
      if (vac.id === null) {
        const creada = await crearVacacion(w.id, from.value, to.value);
        vac.id = creada.id;
      } else {
        await actualizarVacacion(vac.id, from.value, to.value);
      }
      vac.start_date = from.value; vac.end_date = to.value;
      vacBtn.textContent = '🏖 ' + w.vacs.filter((v) => v.id !== null).length;
    } catch (err) { toast(err.message); }
  };
  from.addEventListener('change', guardar);
  to.addEventListener('change', guardar);

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'del'; rm.textContent = '✕'; rm.title = 'Quitar periodo';
  rm.addEventListener('click', async () => {
    try {
      if (vac.id !== null) await borrarVacacion(vac.id);
      w.vacs = w.vacs.filter((v) => v !== vac);
      vacBtn.textContent = '🏖 ' + w.vacs.filter((v) => v.id !== null).length;
      pintaPanel();
    } catch (err) { toast(err.message); }
  });

  vr.append(document.createTextNode('Del '), from, document.createTextNode(' al '), to, rm);
  return vr;
}
