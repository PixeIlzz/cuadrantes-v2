// Pestaña Ajustes: puestos, días y publicación por defecto. v8
import { toast } from './toast.js?v=18';
import { confirmar } from './confirmar.js?v=18';
import { ctx } from '../auth.js?v=18';
import { sb } from '../supabase.js?v=18';
import { recalcularProgramadas } from '../data/semanas.js?v=18';

const $ = (id) => document.getElementById(id);
const DIAS_SEMANA = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
let cfg = null;   // copia de trabajo

export function initAjustes() {
  $('btn-add-role').addEventListener('click', añadirPuesto);
  $('btn-add-day').addEventListener('click', añadirDia);
  $('btn-guardar-cfg').addEventListener('click', guardar);
}

export function abrirAjustes() {
  cfg = JSON.parse(JSON.stringify(ctx.business.config || {}));
  cfg.days ||= []; cfg.roles ||= []; cfg.publish ||= { weekday: 0, time: '18:00', tz: 'Atlantic/Canary' };
  pintarPuestos();
  pintarDias();
  pintarPublicacion();
}

/* ---------- Puestos ---------- */
function pintarPuestos() {
  const box = $('roles-list');
  box.innerHTML = '';
  cfg.roles.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'worker-row';

    const nombre = document.createElement('input');
    nombre.type = 'text'; nombre.value = r.label; nombre.maxLength = 20;
    nombre.addEventListener('change', () => {
      r.label = nombre.value.trim() || r.label;
      nombre.value = r.label;
    });

    const min = document.createElement('input');
    min.type = 'number'; min.min = 0; min.max = 20; min.value = r.min;
    min.addEventListener('change', () => {
      const v = parseInt(min.value, 10);
      if (v >= 0 && v <= 20) r.min = v; else min.value = r.min;
    });

    const lbl = document.createElement('span');
    lbl.className = 'h-label'; lbl.textContent = 'mínimo';

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (cfg.roles.length <= 1) { toast('Tiene que quedar al menos un puesto'); return; }
      const ok = await confirmar(
        'Se quitará el puesto «' + r.label + '». Al guardar, desaparecerá de las semanas '
        + 'nuevas y de los borradores, junto con quien esté colocado en él. '
        + 'Las semanas publicadas no se tocan. ¿Continuar?',
        { textoOk: 'Quitar puesto', peligro: true });
      if (!ok) return;
      cfg.roles.splice(i, 1);
      pintarPuestos();
    });

    row.append(nombre, min, lbl, del);
    box.appendChild(row);
  });
}

function añadirPuesto() {
  const nombre = $('new-role').value.trim();
  if (!nombre) { toast('Escribe el nombre del puesto'); return; }
  const id = idDesde(nombre, cfg.roles.map((r) => r.id));
  cfg.roles.push({ id, label: nombre, min: 1 });
  $('new-role').value = '';
  pintarPuestos();
}

/* ---------- Días ---------- */
function pintarDias() {
  const box = $('days-list');
  box.innerHTML = '';
  cfg.days.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'worker-row';

    const nombre = document.createElement('input');
    nombre.type = 'text'; nombre.value = d.label; nombre.maxLength = 20;
    nombre.addEventListener('change', () => {
      d.label = nombre.value.trim() || d.label;
      nombre.value = d.label;
    });

    const et = document.createElement('span');
    et.className = 'h-label';
    et.textContent = d.night ? 'noche' : 'día';

    const arriba = document.createElement('button');
    arriba.type = 'button'; arriba.className = 'btn small'; arriba.textContent = '↑';
    arriba.addEventListener('click', () => {
      if (i === 0) return;
      [cfg.days[i - 1], cfg.days[i]] = [cfg.days[i], cfg.days[i - 1]];
      pintarDias();
    });

    const abajo = document.createElement('button');
    abajo.type = 'button'; abajo.className = 'btn small'; abajo.textContent = '↓';
    abajo.addEventListener('click', () => {
      if (i === cfg.days.length - 1) return;
      [cfg.days[i + 1], cfg.days[i]] = [cfg.days[i], cfg.days[i + 1]];
      pintarDias();
    });

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (cfg.days.length <= 1) { toast('Tiene que quedar al menos un día'); return; }
      const ok = await confirmar(
        'Se quitará la columna «' + d.label + '». Al guardar, desaparecerá de las semanas '
        + 'nuevas y de los borradores, junto con los turnos colocados en ella. '
        + 'Las semanas publicadas no se tocan. ¿Continuar?',
        { textoOk: 'Quitar columna', peligro: true });
      if (!ok) return;
      cfg.days.splice(i, 1);
      pintarDias();
    });

    row.append(nombre, et, arriba, abajo, del);
    box.appendChild(row);
  });
}

function añadirDia() {
  const nombre = $('new-day').value.trim();
  if (!nombre) { toast('Escribe el nombre de la columna'); return; }
  const noche = $('new-day-night').checked;
  const id = idDesde(nombre, cfg.days.map((d) => d.id)) + (noche ? 'N' : '');
  cfg.days.push(noche ? { id, label: nombre, night: true } : { id, label: nombre });
  $('new-day').value = '';
  $('new-day-night').checked = false;
  pintarDias();
}

/* ---------- Publicación ---------- */
function pintarPublicacion() {
  const sel = $('pub-weekday');
  sel.innerHTML = '';
  DIAS_SEMANA.forEach((nombre, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = nombre;
    sel.appendChild(o);
  });
  sel.value = cfg.publish.weekday ?? 0;
  $('pub-time').value = cfg.publish.time || '18:00';
}

/* ---------- Guardado ---------- */
async function guardar() {
  cfg.publish.weekday = parseInt($('pub-weekday').value, 10);
  cfg.publish.time = $('pub-time').value || '18:00';
  cfg.publish.tz ||= 'Atlantic/Canary';

  const ok = await confirmar(
    'Los cambios se aplicarán a las semanas nuevas y a los borradores. '
    + 'Las semanas ya publicadas conservan su estructura. ¿Guardar?',
    { textoOk: 'Guardar' });
  if (!ok) return;

  try {
    const { error } = await sb.from('businesses')
      .update({ config: cfg }).eq('id', ctx.business.id);
    if (error) throw new Error(error.message);

    // Los borradores adoptan la nueva estructura; lo publicado no se toca.
    await sb.from('weeks')
      .update({ config_snapshot: cfg })
      .eq('business_id', ctx.business.id)
      .eq('status', 'draft');

    ctx.business.config = cfg;
    const n = await recalcularProgramadas();
    toast('Ajustes guardados' + (n ? ` · ${n} semana(s) reprogramada(s)` : ''));
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  }
}

/* id corto y único a partir del nombre */
function idDesde(nombre, usados) {
  let base = nombre.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '').slice(0, 4) || 'x';
  let id = base, n = 2;
  while (usados.includes(id)) id = base + (n++);
  return id;
}
