// Pestaña Semanas: registro completo agrupado por año y mes. v14
import { toast } from './toast.js?v=15';
import { confirmar } from './confirmar.js?v=15';
import { ctx } from '../auth.js?v=15';
import {
  listarSemanas, etiquetaSemana, fmtMomento, localAIso,
  programarSemana, borrarSemana, setVisibilidad,
  estadoBase, esVisible, modoVisibilidad, iconoOjo, textoVisibilidad,
  ETIQUETA_ESTADO, contarSemanasRango, borrarSemanasRango,
} from '../data/semanas.js?v=15';

const $ = (id) => document.getElementById(id);
const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
let alEditar = null;

export function initProgramadas(onEditar) { alEditar = onEditar; }

export async function abrirProgramadas() {
  const cont = $('lista-semanas');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    pintar(await listarSemanas());
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

function pintar(semanas) {
  const cont = $('lista-semanas');
  cont.innerHTML = '';
  if (semanas.length === 0) {
    cont.innerHTML = '<span class="empty-note">Todavía no hay semanas. Crea una desde la pestaña Cuadrante.</span>';
    return;
  }

  // Agrupar: año → mes → semanas (ya vienen ordenadas de más nueva a más antigua)
  const porAño = {};
  for (const w of semanas) {
    const [y, m] = w.start_date.split('-').map(Number);
    ((porAño[y] ||= {})[m] ||= []).push(w);
  }

  for (const año of Object.keys(porAño).sort((a, b) => b - a)) {
    const bloqueAño = document.createElement('div');
    bloqueAño.className = 'grupo-año';

    const cabAño = document.createElement('div');
    cabAño.className = 'grupo-cab grupo-cab-año';
    const tAño = document.createElement('h3');
    const nAño = Object.values(porAño[año]).reduce((n, arr) => n + arr.length, 0);
    tAño.textContent = año;
    const subAño = document.createElement('span');
    subAño.className = 'grupo-num';
    subAño.textContent = nAño + (nAño === 1 ? ' semana' : ' semanas');
    const delAño = document.createElement('button');
    delAño.type = 'button'; delAño.className = 'btn small danger';
    delAño.textContent = 'Borrar todo ' + año;
    delAño.addEventListener('click', () =>
      borrarRango(`${año}-01-01`, `${año}-12-31`, 'todo el año ' + año));
    cabAño.append(tAño, subAño, delAño);
    bloqueAño.appendChild(cabAño);

    for (const mes of Object.keys(porAño[año]).sort((a, b) => b - a)) {
      const lista = porAño[año][mes];
      const cabMes = document.createElement('div');
      cabMes.className = 'grupo-cab grupo-cab-mes';
      const tMes = document.createElement('h4');
      tMes.textContent = MESES[mes - 1];
      const subMes = document.createElement('span');
      subMes.className = 'grupo-num';
      subMes.textContent = lista.length + (lista.length === 1 ? ' semana' : ' semanas');
      const delMes = document.createElement('button');
      delMes.type = 'button'; delMes.className = 'btn small';
      delMes.textContent = 'Borrar mes';
      const ultimo = new Date(año, mes, 0).getDate();
      delMes.addEventListener('click', () =>
        borrarRango(`${año}-${String(mes).padStart(2,'0')}-01`,
                    `${año}-${String(mes).padStart(2,'0')}-${ultimo}`,
                    MESES[mes - 1] + ' de ' + año));
      cabMes.append(tMes, subMes, delMes);
      bloqueAño.appendChild(cabMes);

      for (const w of lista) bloqueAño.appendChild(fila(w));
    }
    cont.appendChild(bloqueAño);
  }
}

function fila(w) {
  const tz = (ctx.business.config.publish || {}).tz;
  const base = estadoBase(w);
  const visible = esVisible(w);
  const modo = modoVisibilidad(w);

  const f = document.createElement('div');
  f.className = 'week-row';

  const izq = document.createElement('div');
  izq.className = 'week-main';
  const t = document.createElement('div');
  t.className = 'week-title';
  t.textContent = etiquetaSemana(w.start_date);
  const sub = document.createElement('div');
  sub.className = 'week-sub';
  sub.textContent = (w.publish_at
      ? 'Programada para el ' + fmtMomento(w.publish_at, tz)
        + (w.publish_at_manual ? ' · fecha propia' : '')
      : 'Sin programar')
    + (base === 'archivada' && modo === 'auto' ? ' · archivada, solo la ves tú' : '');
  izq.append(t, sub);

  // Dos indicadores separados: ojo (visibilidad) y chip (estado)
  const marcas = document.createElement('div');
  marcas.className = 'week-marcas';

  const ojo = document.createElement('span');
  ojo.className = 'ojo ' + (visible ? 'ojo-on' : 'ojo-off')
    + (modo !== 'auto' ? ' ojo-manual' : '');
  ojo.innerHTML = iconoOjo(visible) + '<span>' + textoVisibilidad(w) + '</span>';

  const chip = document.createElement('span');
  chip.className = 'status-chip est-' + base;
  chip.textContent = ETIQUETA_ESTADO[base];

  marcas.append(ojo, chip);

  const acciones = document.createElement('div');
  acciones.className = 'week-actions';

  const bEd = document.createElement('button');
  bEd.type = 'button'; bEd.className = 'btn small'; bEd.textContent = 'Editar';
  bEd.addEventListener('click', () => alEditar && alEditar(w.start_date));

  const bVis = document.createElement('button');
  bVis.type = 'button'; bVis.className = 'btn small';
  bVis.textContent = visible ? '🚫 Ocultar' : '👁 Mostrar';
  bVis.addEventListener('click', async () => {
    const modo = visible ? 'hidden' : 'shown';
    const ok = await confirmar(
      visible
        ? 'Dejará de verse por el equipo. El contenido y la fecha programada se conservan.'
        : 'Será visible para el equipo ahora mismo. La fecha programada se conserva.',
      { textoOk: visible ? 'Ocultar' : 'Mostrar', peligro: visible });
    if (!ok) return;
    try { await setVisibilidad(w.id, modo); abrirProgramadas(); }
    catch (err) { toast(err.message); }
  });

  const bAuto = document.createElement('button');
  bAuto.type = 'button'; bAuto.className = 'btn small';
  bAuto.textContent = '↺ Automático';
  bAuto.hidden = (modo === 'auto');
  bAuto.addEventListener('click', async () => {
    try { await setVisibilidad(w.id, 'auto'); toast('Comportamiento automático'); abrirProgramadas(); }
    catch (err) { toast(err.message); }
  });

  const bFecha = document.createElement('button');
  bFecha.type = 'button'; bFecha.className = 'btn small'; bFecha.textContent = 'Cambiar fecha';
  bFecha.addEventListener('click', () => abrirFecha(w, f));

  const bDefecto = document.createElement('button');
  bDefecto.type = 'button'; bDefecto.className = 'btn small';
  bDefecto.textContent = 'Fecha por defecto';
  bDefecto.hidden = !w.publish_at_manual;
  bDefecto.addEventListener('click', async () => {
    try { await programarSemana(w.id, null); toast('Vuelve a la regla por defecto'); abrirProgramadas(); }
    catch (err) { toast(err.message); }
  });

  const bDel = document.createElement('button');
  bDel.type = 'button'; bDel.className = 'del'; bDel.textContent = '✕';
  bDel.title = 'Eliminar semana';
  bDel.addEventListener('click', async () => {
    const ok = await confirmar(
      'Se eliminará ' + etiquetaSemana(w.start_date) + ' y todo su contenido. Esto no se puede deshacer.',
      { textoOk: 'Eliminar', peligro: true });
    if (!ok) return;
    try { await borrarSemana(w.id); toast('Semana eliminada'); abrirProgramadas(); }
    catch (err) { toast(err.message); }
  });

  acciones.append(bEd, bVis, bAuto, bFecha, bDefecto, bDel);
  f.append(izq, marcas, acciones);
  return f;
}

function abrirFecha(w, fila) {
  const previo = fila.querySelector('.week-fecha');
  if (previo) { previo.remove(); return; }
  const caja = document.createElement('div');
  caja.className = 'week-fecha';
  const inp = document.createElement('input');
  inp.type = 'datetime-local';
  if (w.publish_at) {
    const d = new Date(w.publish_at);
    const p = (n) => String(n).padStart(2, '0');
    inp.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn small primary'; b.textContent = 'Guardar';
  b.addEventListener('click', async () => {
    if (!inp.value) { toast('Elige fecha y hora'); return; }
    try {
      await programarSemana(w.id, localAIso(inp.value));
      toast('Fecha de publicación actualizada');
      abrirProgramadas();
    } catch (err) { toast(err.message); }
  });
  caja.append(inp, b);
  fila.appendChild(caja);
}

/* Borrado masivo con doble confirmación */
async function borrarRango(desde, hasta, descripcion) {
  try {
    const n = await contarSemanasRango(desde, hasta);
    if (n === 0) { toast('No hay semanas en ese periodo'); return; }

    const uno = await confirmar(
      'Se van a eliminar ' + n + (n === 1 ? ' semana' : ' semanas') + ' de ' + descripcion
      + ', con todos sus turnos y notas. Esto no se puede deshacer.',
      { textoOk: 'Continuar', peligro: true });
    if (!uno) return;

    const dos = await confirmar(
      '¿Seguro del todo? Se borrarán ' + n + (n === 1 ? ' semana' : ' semanas') + ' de forma definitiva.',
      { textoOk: 'Sí, eliminar', textoNo: 'No, cancelar', peligro: true });
    if (!dos) return;

    const borradas = await borrarSemanasRango(desde, hasta);
    toast(borradas + (borradas === 1 ? ' semana eliminada' : ' semanas eliminadas'));
    abrirProgramadas();
  } catch (err) { toast(err.message); }
}
