// Solicitudes: bandeja del gestor y formulario/historial del empleado. v12
import { toast } from './toast.js?v=18';
import { confirmar } from './confirmar.js?v=18';
import { ctx } from '../auth.js?v=18';
import { plantilla } from '../data/empleado.js?v=18';
import { etiquetaSemana, fmtCorto } from '../data/semanas.js?v=18';
import {
  crearSolicitud, misSolicitudes, retirarSolicitud,
  solicitudesDelNegocio, contarPendientes, resolverSolicitud, semanasAfectadas,
} from '../data/solicitudes.js?v=18';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const TIPO = { vacation: 'Vacaciones', change: 'Cambio de turno', other: 'Otro' };
const ESTADO = { pending: 'Pendiente', approved: 'Aprobada', denied: 'Denegada' };

let equipoCache = [];

/* =====================================================================
   GESTOR
   ===================================================================== */

export function initSolicitudes() {
  document.querySelectorAll('.sol-filtro').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.sol-filtro').forEach((x) =>
        x.classList.toggle('active', x === b));
      abrirSolicitudes(b.dataset.estado || null);
    });
  });
}

export async function abrirSolicitudes(estado = 'pending') {
  const cont = $('lista-solicitudes');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    if (equipoCache.length === 0) equipoCache = await plantilla();
    const lista = await solicitudesDelNegocio(estado);
    await refrescarContador();

    cont.innerHTML = '';
    if (lista.length === 0) {
      cont.innerHTML = '<span class="empty-note">'
        + (estado === 'pending' ? 'No hay solicitudes pendientes.' : 'No hay solicitudes en este estado.')
        + '</span>';
      return;
    }
    for (const s of lista) cont.appendChild(await tarjetaGestor(s));
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}

export async function refrescarContador() {
  try {
    const n = await contarPendientes();
    const badge = $('badge-solicitudes');
    if (!badge) return;
    badge.textContent = n;
    badge.hidden = (n === 0);
  } catch (_) {}
}

const nombreDe = (id) => (equipoCache.find((w) => w.id === id) || {}).name || 'Trabajador';

async function tarjetaGestor(s) {
  const card = document.createElement('div');
  card.className = 'sol-card sol-' + s.status;

  const cab = document.createElement('div');
  cab.className = 'sol-cab';
  cab.innerHTML =
    '<span class="sol-quien"></span>' +
    '<span class="sol-tipo">' + TIPO[s.type] + '</span>' +
    '<span class="status-chip sol-estado-' + s.status + '">' + ESTADO[s.status] + '</span>';
  cab.querySelector('.sol-quien').textContent = nombreDe(s.worker_id);
  card.appendChild(cab);

  const fechas = document.createElement('div');
  fechas.className = 'sol-fechas';
  fechas.textContent = s.start_date
    ? (s.end_date && s.end_date !== s.start_date
        ? 'Del ' + fmtCorto(s.start_date) + ' al ' + fmtCorto(s.end_date)
        : 'El ' + fmtCorto(s.start_date))
    : 'Sin fecha concreta';
  card.appendChild(fechas);

  if (s.message) {
    const m = document.createElement('div');
    m.className = 'sol-msg';
    m.textContent = '«' + s.message + '»';
    card.appendChild(m);
  }

  if (s.status === 'pending') {
    // Aviso si las fechas caen en semanas ya programadas o publicadas
    if (s.start_date) {
      const afectadas = await semanasAfectadas(s.start_date, s.end_date);
      if (afectadas.length) {
        const av = document.createElement('div');
        av.className = 'sol-aviso';
        av.textContent = '⚠ Afecta a ' + afectadas.length + ' semana(s) ya '
          + (afectadas.some((w) => w.status === 'published') ? 'publicada(s)' : 'programada(s)')
          + ': ' + afectadas.map((w) => etiquetaSemana(w.start_date)).join(' · ');
        card.appendChild(av);
      }
    }

    const nota = document.createElement('textarea');
    nota.className = 'sol-nota';
    nota.placeholder = 'Nota para el empleado (opcional)…';
    nota.maxLength = 300;
    card.appendChild(nota);

    const acciones = document.createElement('div');
    acciones.className = 'sol-acciones';

    const bSi = document.createElement('button');
    bSi.type = 'button'; bSi.className = 'btn small primary'; bSi.textContent = 'Aprobar';
    bSi.addEventListener('click', async () => {
      const extra = s.type === 'vacation'
        ? 'Se añadirá el periodo a sus vacaciones.'
        : s.type === 'change'
          ? 'Queda constancia de la aprobación. Recuerda mover los turnos a mano en el cuadrante.'
          : 'Queda constancia de la aprobación y de tu nota.';
      const ok = await confirmar('Aprobar la solicitud de ' + nombreDe(s.worker_id) + '. ' + extra,
        { textoOk: 'Aprobar' });
      if (!ok) return;
      try {
        await resolverSolicitud(s.id, true, nota.value);
        toast('Solicitud aprobada');
        abrirSolicitudes(estadoActivo());
      } catch (err) { toast(err.message); }
    });

    const bNo = document.createElement('button');
    bNo.type = 'button'; bNo.className = 'btn small danger'; bNo.textContent = 'Denegar';
    bNo.addEventListener('click', async () => {
      const ok = await confirmar('Denegar la solicitud de ' + nombreDe(s.worker_id) + '.',
        { textoOk: 'Denegar', peligro: true });
      if (!ok) return;
      try {
        await resolverSolicitud(s.id, false, nota.value);
        toast('Solicitud denegada');
        abrirSolicitudes(estadoActivo());
      } catch (err) { toast(err.message); }
    });

    acciones.append(bSi, bNo);
    card.appendChild(acciones);
  } else if (s.manager_note) {
    const n = document.createElement('div');
    n.className = 'sol-respuesta';
    n.textContent = 'Tu respuesta: ' + s.manager_note;
    card.appendChild(n);
  }

  const pie = document.createElement('div');
  pie.className = 'sol-pie';
  pie.textContent = 'Enviada el ' + new Date(s.created_at).toLocaleDateString('es-ES',
    { day: 'numeric', month: 'short', year: 'numeric' });
  card.appendChild(pie);

  return card;
}

function estadoActivo() {
  const b = document.querySelector('.sol-filtro.active');
  return b ? (b.dataset.estado || null) : 'pending';
}

/* =====================================================================
   EMPLEADO
   ===================================================================== */

export function initMisSolicitudes() {
  document.querySelectorAll('input[name="sol-tipo"]').forEach((r) => {
    r.addEventListener('change', pintarCampos);
  });
  $('btn-enviar-sol').addEventListener('click', enviar);
  pintarCampos();
}

function pintarCampos() {
  const tipo = document.querySelector('input[name="sol-tipo"]:checked').value;
  $('sol-hasta-wrap').hidden = (tipo !== 'vacation');
  $('sol-fechas-wrap').hidden = false;
  $('sol-desde-lbl').textContent =
    tipo === 'vacation' ? 'Desde el día'
    : tipo === 'change' ? 'Día afectado'
    : 'Día relacionado (opcional)';
  $('sol-msg').placeholder =
    tipo === 'vacation' ? 'Motivo (opcional). Ej.: boda de mi hermana'
    : tipo === 'change' ? 'Explica el cambio que necesitas. Ej.: no puedo el viernes noche, ¿puedo cambiar con Pedro?'
    : 'Cuéntanos qué necesitas. Ej.: necesito un justificante, tengo cita médica, una duda sobre el cuadrante…';
}

async function enviar() {
  const tipo = document.querySelector('input[name="sol-tipo"]:checked').value;
  const desde = $('sol-desde').value;
  const hasta = tipo === 'vacation' ? ($('sol-hasta').value || desde) : (desde || null);
  const mensaje = $('sol-msg').value.trim();

  if (!ctx.workerId) { toast('Tu cuenta no está enlazada a una ficha de trabajador.'); return; }
  if (tipo !== 'other' && !desde) { toast('Elige la fecha'); return; }
  if (tipo === 'vacation' && hasta < desde) { toast('La fecha final no puede ser anterior'); return; }
  if (tipo === 'change' && !mensaje) { toast('Explica brevemente el cambio que necesitas'); return; }
  if (tipo === 'other' && !mensaje) { toast('Escribe en qué podemos ayudarte'); return; }

  const btn = $('btn-enviar-sol');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await crearSolicitud({ tipo, desde: desde || null, hasta, mensaje });
    $('sol-desde').value = ''; $('sol-hasta').value = ''; $('sol-msg').value = '';
    toast('Solicitud enviada. Tu responsable la verá en la app.');
    await abrirMisSolicitudes();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar solicitud';
  }
}

export async function abrirMisSolicitudes() {
  const cont = $('mis-solicitudes');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    if (!ctx.workerId) {
      cont.innerHTML = '<span class="empty-note">Tu cuenta todavía no está enlazada a una ficha de trabajador. Habla con tu responsable.</span>';
      return;
    }
    const lista = await misSolicitudes();
    cont.innerHTML = '';
    if (lista.length === 0) {
      cont.innerHTML = '<span class="empty-note">Todavía no has enviado ninguna solicitud.</span>';
      return;
    }
    for (const s of lista) {
      const card = document.createElement('div');
      card.className = 'sol-card sol-' + s.status;

      const cab = document.createElement('div');
      cab.className = 'sol-cab';
      cab.innerHTML = '<span class="sol-tipo">' + TIPO[s.type] + '</span>'
        + '<span class="status-chip sol-estado-' + s.status + '">' + ESTADO[s.status] + '</span>';
      card.appendChild(cab);

      const f = document.createElement('div');
      f.className = 'sol-fechas';
      f.textContent = s.start_date
        ? (s.end_date && s.end_date !== s.start_date
            ? 'Del ' + fmtCorto(s.start_date) + ' al ' + fmtCorto(s.end_date)
            : 'El ' + fmtCorto(s.start_date))
        : '';
      card.appendChild(f);

      if (s.message) {
        const m = document.createElement('div');
        m.className = 'sol-msg';
        m.textContent = '«' + s.message + '»';
        card.appendChild(m);
      }
      if (s.manager_note) {
        const r = document.createElement('div');
        r.className = 'sol-respuesta';
        r.textContent = 'Respuesta: ' + s.manager_note;
        card.appendChild(r);
      }
      if (s.status === 'pending') {
        const acciones = document.createElement('div');
        acciones.className = 'sol-acciones';
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn small'; b.textContent = 'Retirar solicitud';
        b.addEventListener('click', async () => {
          const ok = await confirmar('Se retirará la solicitud. ¿Continuar?',
            { textoOk: 'Retirar', peligro: true });
          if (!ok) return;
          try { await retirarSolicitud(s.id); toast('Solicitud retirada'); abrirMisSolicitudes(); }
          catch (err) { toast(err.message); }
        });
        acciones.appendChild(b);
        card.appendChild(acciones);
      }

      const pie = document.createElement('div');
      pie.className = 'sol-pie';
      pie.textContent = 'Enviada el ' + new Date(s.created_at).toLocaleDateString('es-ES',
        { day: 'numeric', month: 'short', year: 'numeric' });
      card.appendChild(pie);

      cont.appendChild(card);
    }
  } catch (err) {
    cont.innerHTML = '';
    toast(err.message);
  }
}
