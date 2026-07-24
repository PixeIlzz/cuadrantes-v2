// Tablón de avisos: gestión (gestor) y lectura (todo el equipo). v18
import { toast } from './toast.js?v=18';
import { confirmar } from './confirmar.js?v=18';
import { ctx } from '../auth.js?v=18';
import {
  avisosVisibles, todosLosAvisos, crearAviso, actualizarAviso, borrarAviso,
} from '../data/avisos.js?v=18';

const $ = (id) => document.getElementById(id);
const fmtFecha = (iso) => new Date(iso).toLocaleDateString('es-ES',
  { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------------------------------------------------------
   Tablón de lectura: se inserta donde se le diga (empleado y gestor)
   --------------------------------------------------------------- */
export async function pintarTablon(contenedorId) {
  const cont = $(contenedorId);
  if (!cont) return;
  try {
    const lista = await avisosVisibles();
    cont.innerHTML = '';
    cont.hidden = (lista.length === 0);
    for (const a of lista) {
      const el = document.createElement('div');
      el.className = 'aviso' + (a.pinned ? ' aviso-pin' : '');
      const txt = document.createElement('div');
      txt.className = 'aviso-txt';
      txt.textContent = a.text;
      const pie = document.createElement('div');
      pie.className = 'aviso-pie';
      pie.textContent = (a.pinned ? '📌 Destacado · ' : '') + fmtFecha(a.created_at)
        + (a.expires_at ? ' · hasta el ' + fmtFecha(a.expires_at) : '');
      el.append(txt, pie);
      cont.appendChild(el);
    }
  } catch (err) {
    cont.hidden = true;
    console.warn('Tablón:', err.message);
  }
}

/* ---------------------------------------------------------------
   Gestión (pestaña Ajustes del gestor)
   --------------------------------------------------------------- */
export function initAvisos() {
  $('btn-nuevo-aviso').addEventListener('click', publicar);
}

async function publicar() {
  const texto = $('aviso-texto').value.trim();
  if (!texto) { toast('Escribe el aviso'); return; }
  const pinned = $('aviso-pin').checked;
  const expira = $('aviso-expira').value || null;
  const btn = $('btn-nuevo-aviso');
  btn.disabled = true;
  try {
    await crearAviso(texto, { pinned, expira });
    $('aviso-texto').value = '';
    $('aviso-pin').checked = false;
    $('aviso-expira').value = '';
    toast('Aviso publicado. Ya lo ve el equipo.');
    await abrirAvisos();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
}

export async function abrirAvisos() {
  const cont = $('lista-avisos');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    const lista = await todosLosAvisos();
    cont.innerHTML = '';
    if (lista.length === 0) {
      cont.innerHTML = '<span class="empty-note">Todavía no hay avisos. El equipo verá aquí lo que publiques.</span>';
      return;
    }
    for (const a of lista) cont.appendChild(fila(a));
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

function fila(a) {
  const hoy = new Date().toISOString().slice(0, 10);
  const caducado = a.expires_at && a.expires_at < hoy;
  const visible = a.active && !caducado;

  const f = document.createElement('div');
  f.className = 'aviso-row' + (visible ? '' : ' apagado');

  const txt = document.createElement('div');
  txt.className = 'aviso-row-txt';
  txt.textContent = a.text;

  const meta = document.createElement('div');
  meta.className = 'aviso-row-meta';
  meta.textContent = fmtFecha(a.created_at)
    + (a.pinned ? ' · 📌 destacado' : '')
    + (caducado ? ' · caducado' : (a.expires_at ? ' · hasta el ' + fmtFecha(a.expires_at) : ''))
    + (a.active ? '' : ' · archivado');

  const acciones = document.createElement('div');
  acciones.className = 'aviso-row-acciones';

  const bPin = document.createElement('button');
  bPin.type = 'button'; bPin.className = 'btn small';
  bPin.textContent = a.pinned ? 'Quitar destacado' : '📌 Destacar';
  bPin.addEventListener('click', async () => {
    try { await actualizarAviso(a.id, { pinned: !a.pinned }); abrirAvisos(); }
    catch (err) { toast(err.message); }
  });

  const bAct = document.createElement('button');
  bAct.type = 'button'; bAct.className = 'btn small';
  bAct.textContent = a.active ? 'Archivar' : 'Reactivar';
  bAct.addEventListener('click', async () => {
    try {
      await actualizarAviso(a.id, { active: !a.active });
      toast(a.active ? 'Aviso archivado' : 'Aviso reactivado');
      abrirAvisos();
    } catch (err) { toast(err.message); }
  });

  const bDel = document.createElement('button');
  bDel.type = 'button'; bDel.className = 'del'; bDel.textContent = '✕';
  bDel.title = 'Eliminar aviso';
  bDel.addEventListener('click', async () => {
    const ok = await confirmar('Se eliminará el aviso definitivamente. ¿Continuar?',
      { textoOk: 'Eliminar', peligro: true });
    if (!ok) return;
    try { await borrarAviso(a.id); toast('Aviso eliminado'); abrirAvisos(); }
    catch (err) { toast(err.message); }
  });

  acciones.append(bPin, bAct, bDel);
  f.append(txt, meta, acciones);
  return f;
}
