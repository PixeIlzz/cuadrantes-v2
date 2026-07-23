// Pestaña Programadas: cola de semanas con su estado y publicación. v8
import { toast } from './toast.js?v=12';
import { confirmar } from './confirmar.js?v=12';
import { ctx } from '../auth.js?v=12';
import {
  listarSemanas, etiquetaSemana, fmtMomento, localAIso,
  programarSemana, despublicar, borrarSemana,
} from '../data/semanas.js?v=12';

const $ = (id) => document.getElementById(id);
let alEditar = null;   // callback para saltar al editor

export function initProgramadas(onEditar) {
  alEditar = onEditar;
}

export async function abrirProgramadas() {
  const cont = $('lista-semanas');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    const semanas = await listarSemanas();
    pintar(semanas);
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
  const tz = (ctx.business.config.publish || {}).tz;
  const hoyLunes = new Date();

  for (const w of semanas) {
    const fila = document.createElement('div');
    fila.className = 'week-row';

    const izq = document.createElement('div');
    izq.className = 'week-main';
    const t = document.createElement('div');
    t.className = 'week-title';
    t.textContent = etiquetaSemana(w.start_date);
    const sub = document.createElement('div');
    sub.className = 'week-sub';
    sub.textContent = w.publish_at
      ? (w.status === 'published' ? 'Publicada el ' : 'Se publica el ')
        + fmtMomento(w.publish_at, tz) + (w.publish_at_manual ? ' · fecha propia' : '')
      : 'Sin programar';
    izq.append(t, sub);

    const chip = document.createElement('span');
    chip.className = 'status-chip ' + w.status;
    chip.textContent = w.status === 'draft' ? 'Borrador'
      : w.status === 'scheduled' ? 'Programada' : 'Publicada';

    const acciones = document.createElement('div');
    acciones.className = 'week-actions';

    const bEd = document.createElement('button');
    bEd.type = 'button'; bEd.className = 'btn small'; bEd.textContent = 'Editar';
    bEd.addEventListener('click', () => alEditar && alEditar(w.start_date));

    const bFecha = document.createElement('button');
    bFecha.type = 'button'; bFecha.className = 'btn small';
    bFecha.textContent = 'Cambiar fecha';
    bFecha.addEventListener('click', () => abrirFecha(w, fila));

    const bAuto = document.createElement('button');
    bAuto.type = 'button'; bAuto.className = 'btn small';
    bAuto.textContent = 'Usar por defecto';
    bAuto.hidden = !w.publish_at_manual;
    bAuto.addEventListener('click', async () => {
      try {
        await programarSemana(w.id, null);
        toast('Vuelve a la regla por defecto');
        abrirProgramadas();
      } catch (err) { toast(err.message); }
    });

    const bDes = document.createElement('button');
    bDes.type = 'button'; bDes.className = 'btn small';
    bDes.textContent = 'A borrador';
    bDes.hidden = (w.status === 'draft');
    bDes.addEventListener('click', async () => {
      const ok = await confirmar('Dejará de verse por el equipo. ¿Continuar?',
        { textoOk: 'A borrador', peligro: true });
      if (!ok) return;
      try { await despublicar(w.id); abrirProgramadas(); }
      catch (err) { toast(err.message); }
    });

    const bDel = document.createElement('button');
    bDel.type = 'button'; bDel.className = 'del'; bDel.textContent = '✕';
    bDel.title = 'Eliminar semana';
    bDel.addEventListener('click', async () => {
      const ok = await confirmar(
        'Se eliminará la semana ' + etiquetaSemana(w.start_date) + ' y todo su contenido. ¿Seguro?',
        { textoOk: 'Eliminar', peligro: true });
      if (!ok) return;
      try { await borrarSemana(w.id); toast('Semana eliminada'); abrirProgramadas(); }
      catch (err) { toast(err.message); }
    });

    acciones.append(bEd, bFecha, bAuto, bDes, bDel);
    fila.append(izq, chip, acciones);
    cont.appendChild(fila);
  }
}

function abrirFecha(w, fila) {
  if (fila.querySelector('.week-fecha')) { fila.querySelector('.week-fecha').remove(); return; }
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
