// Pestaña Equipo: interfaz calcada a la v1, datos contra Supabase.
import { toast } from './toast.js?v=17';
import {
  listarEquipo, crearTrabajador, actualizarTrabajador, borrarTrabajador,
  crearVacacion, actualizarVacacion, borrarVacacion,
} from '../data/equipo.js?v=17';
import { generarCodigo, codigoVivo } from '../data/invitaciones.js?v=17';
import { confirmar } from './confirmar.js?v=17';

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
  del.className = 'del'; del.textContent = '✕'; del.title = 'Eliminar trabajador';
  del.addEventListener('click', async () => {
    const ok = await confirmar(
      'Se eliminará a ' + w.name + ' del equipo y desaparecerá de todos los cuadrantes '
      + 'en los que esté colocado, incluidos los ya publicados. ¿Seguro?',
      { textoOk: 'Eliminar', peligro: true });
    if (!ok) return;
    try {
      await borrarTrabajador(w.id);
      equipo = equipo.filter((x) => x.id !== w.id);
      render();
      toast(w.name + ' eliminado');
    } catch (err) { toast(err.message); }
  });

  // Invitación: genera y muestra el código para que el empleado se registre
  const invBtn = document.createElement('button');
  invBtn.type = 'button';
  invBtn.className = 'btn small';
  invBtn.textContent = '🔑 Acceso';
  invBtn.title = 'Código de acceso para el empleado';
  invBtn.addEventListener('click', () => mostrarInvitacion(w, invPanel));

  row.append(nameIn, hoursIn, lbl, vacBtn, invBtn, del);

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

  const invPanel = document.createElement('div');
  invPanel.className = 'inv-panel';
  invPanel.hidden = true;

  return [row, panel, invPanel];
}

/* Panel de código de invitación de un trabajador */
async function mostrarInvitacion(w, panel) {
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<span class="h-label">Comprobando…</span>';
  try {
    let inv = await codigoVivo(w.id);
    pintarInvitacion(w, panel, inv);
  } catch (err) {
    panel.innerHTML = '';
    toast(err.message);
  }
}

function pintarInvitacion(w, panel, inv) {
  panel.innerHTML = '';
  const txt = document.createElement('div');
  txt.className = 'inv-txt';

  if (inv) {
    txt.innerHTML = 'Código de acceso de <b></b>: <span class="inv-code"></span>';
    txt.querySelector('b').textContent = w.name;
    txt.querySelector('.inv-code').textContent = inv.code;
    const ayuda = document.createElement('div');
    ayuda.className = 'h-label';
    ayuda.textContent = 'Que se registre en la app con este código. Un solo uso.';
    panel.append(txt, ayuda);

    const copiar = document.createElement('button');
    copiar.type = 'button'; copiar.className = 'btn small';
    copiar.textContent = 'Copiar';
    copiar.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inv.code); toast('Código copiado'); }
      catch (_) { toast('Copia el código a mano: ' + inv.code); }
    });
    const nuevo = document.createElement('button');
    nuevo.type = 'button'; nuevo.className = 'btn small';
    nuevo.textContent = 'Generar otro';
    nuevo.addEventListener('click', async () => {
      const ok = await confirmar('El código anterior dejará de servir. ¿Generar uno nuevo?',
        { textoOk: 'Generar' });
      if (!ok) return;
      try {
        const code = await generarCodigo(w.id);
        pintarInvitacion(w, panel, { code });
        toast('Código nuevo generado');
      } catch (err) { toast(err.message); }
    });
    const acciones = document.createElement('div');
    acciones.className = 'inv-acciones';
    acciones.append(copiar, nuevo);
    panel.appendChild(acciones);
  } else {
    txt.textContent = 'Este trabajador todavía no tiene código de acceso.';
    const gen = document.createElement('button');
    gen.type = 'button'; gen.className = 'btn small primary';
    gen.textContent = 'Generar código';
    gen.addEventListener('click', async () => {
      try {
        const code = await generarCodigo(w.id);
        pintarInvitacion(w, panel, { code });
        toast('Código generado');
      } catch (err) { toast(err.message); }
    });
    panel.append(txt, gen);
  }
}

function filaVacacion(w, vac, vacBtn, pintaPanel) {
  const vr = document.createElement('div');
  vr.className = 'vac-row';

  const fechas = document.createElement('div');
  fechas.className = 'vac-fechas';

  const from = document.createElement('input');
  from.type = 'date'; from.value = vac.start_date || '';
  const to = document.createElement('input');
  to.type = 'date'; to.value = vac.end_date || '';

  const guardarFechas = async () => {
    if (!from.value || !to.value) return;             // aún incompleto
    if (from.value > to.value) { toast('El inicio no puede ser posterior al fin'); return; }
    try {
      if (vac.id === null) {
        const creada = await crearVacacion(w.id, from.value, to.value, nota.value.trim() || null);
        vac.id = creada.id;
      } else {
        await actualizarVacacion(vac.id, { start_date: from.value, end_date: to.value });
      }
      vac.start_date = from.value; vac.end_date = to.value;
      vacBtn.textContent = '🏖 ' + w.vacs.filter((v) => v.id !== null).length;
    } catch (err) { toast(err.message); }
  };
  from.addEventListener('change', guardarFechas);
  to.addEventListener('change', guardarFechas);

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'del'; rm.textContent = '✕'; rm.title = 'Quitar periodo';
  rm.addEventListener('click', async () => {
    if (vac.id !== null) {
      const ok = await confirmar(
        'Se quitará el periodo de vacaciones del ' + (vac.start_date || '?')
        + ' al ' + (vac.end_date || '?') + ' de ' + w.name + '. ¿Continuar?',
        { textoOk: 'Quitar', peligro: true });
      if (!ok) return;
    }
    try {
      if (vac.id !== null) await borrarVacacion(vac.id);
      w.vacs = w.vacs.filter((v) => v !== vac);
      vacBtn.textContent = '🏖 ' + w.vacs.filter((v) => v.id !== null).length;
      pintaPanel();
    } catch (err) { toast(err.message); }
  });

  fechas.append(document.createTextNode('Del '), from,
                document.createTextNode(' al '), to);

  // Etiqueta de origen: si vino de una solicitud aprobada del trabajador
  if (vac.source === 'request') {
    const et = document.createElement('span');
    et.className = 'vac-etiqueta';
    et.textContent = 'SOLICITUD';
    et.title = 'Periodo creado al aprobar una solicitud del trabajador';
    fechas.appendChild(et);
  }

  // Nota del periodo (motivo, aclaraciones…)
  const nota = document.createElement('input');
  nota.type = 'text';
  nota.className = 'vac-nota';
  nota.maxLength = 120;
  nota.placeholder = 'Nota: motivo, aclaraciones…';
  nota.value = vac.note || '';
  nota.addEventListener('change', async () => {
    const v = nota.value.trim() || null;
    if (vac.id === null) { vac.note = v; return; }   // se guardará al completar fechas
    try {
      await actualizarVacacion(vac.id, { note: v });
      vac.note = v;
    } catch (err) {
      nota.value = vac.note || '';
      toast(err.message);
    }
  });

  vr.append(fechas, nota, rm);
  return vr;
}
