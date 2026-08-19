// Modo Kiosco: emparejamiento (QR), pantalla de fichaje presencial,
// vinculación desde el gestor y "configurar mi PIN" del empleado.
// El emparejamiento y la pantalla de fichaje corren SIN sesión. v1
import QRCode from 'https://esm.sh/qrcode@1.5.4';
import jsQR from 'https://esm.sh/jsqr@1.4.0';
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import {
  reclamarToken, vincularKiosco, equipoKiosco, estadoKiosco, ficharKiosco,
  negociosGestor, ponerMiPin, tengoPin,
  listarKioscos, renombrarKiosco, eliminarKiosco,
} from '../data/kiosco.js';

const $ = (id) => document.getElementById(id);
const CLAVE_TOKEN = 'staffpoint-kiosco-token';

/* Zona horaria del local. La tablet está deslogueada, así que no puede leer
   la config del negocio: la manda kiosco_estado() (migración 43). Canarias
   solo es el respaldo mientras no llega la primera respuesta. */
let tzKiosco = 'Atlantic/Canary';

let pollTimer = null;
let relojTimer = null;
let contadorTimer = null;
let refrescoTimer = null;
let margenMin = 5;         // margen de cortesía (min), configurable

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
function claveHoy() { return DIAS[(new Date().getDay() + 6) % 7]; }
function hhmmAMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function minDelDia(d) { return d.getHours() * 60 + d.getMinutes(); }

/* Minutos previstos hoy (suma de tramos) y si una entrada llegó tarde. */
function calcularHorarioHoy(horarios, margenSeg) {
  margenMin = Math.round((Number(margenSeg) || 300) / 60);
}
/* Minutos previstos y tramos de UN trabajador (su turno de hoy) */
function minDeTramos(tramos) {
  let t = 0;
  for (const x of (tramos || [])) {
    const a = hhmmAMin(x.desde), b = hhmmAMin(x.hasta);
    // Un tramo que cruza medianoche (20:00-01:00) cuenta hasta el día siguiente
    if (a != null && b != null) t += (b > a) ? (b - a) : (b + 1440 - a);
  }
  return t;
}
function llegoTarde(desdeIso, tramos) {
  const lista = tramos || [];
  if (!lista.length || !desdeIso) return false;
  const minFich = minDelDia(new Date(desdeIso));
  let mejor = null;
  for (const t of lista) {
    const ini = hhmmAMin(t.desde);
    if (ini == null) continue;
    if (minFich >= ini - 30 && minFich <= ini + 240) {
      if (mejor === null || Math.abs(minFich - ini) < Math.abs(minFich - mejor)) mejor = ini;
    }
  }
  return mejor !== null && (minFich - mejor) > margenMin;
}
function fmtDur(ms) {
  const tot = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
  const p = (n) => String(n).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(s);
}

/* ---------- utilidades ---------- */
function hex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function iniciales(nombre) {
  const p = (nombre || '').trim().split(/\s+/);
  return (((p[0] || '')[0] || '?') + ((p[1] || '')[0] || '')).toUpperCase();
}
function horaCanaria(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', timeZone: tzKiosco });
}
function ocultarPantallas() {
  ['cargando', 'vista-login', 'vista-app', 'vista-kiosco', 'vista-kiosco-emparejar']
    .forEach((id) => { const e = $(id); if (e) e.hidden = true; });
}

/* =========================================================
   ARRANQUE: ¿es esta carga modo kiosco?
   ========================================================= */
export function arrancarKiosco() {
  const hash = location.hash || '';
  // El gestor que escanea trae #kiosco-claim: NO es modo kiosco, arranque normal.
  if (hash.startsWith('#kiosco-claim')) return false;

  // Una tablet ya emparejada arranca SIEMPRE en el kiosco, ignore el hash que quede.
  const token = localStorage.getItem(CLAVE_TOKEN);
  if (token) { mostrarKiosco(token); return true; }

  // Sin token: solo si venimos a emparejar.
  if (hash === '#emparejar-kiosko' || hash === '#kiosco') { mostrarEmparejamiento(); return true; }
  return false;
}

/* =========================================================
   EMPAREJAMIENTO — la tablet muestra el QR y espera
   ========================================================= */
export async function mostrarEmparejamiento() {
  ocultarPantallas();
  const v = $('vista-kiosco-emparejar');
  if (!v) return;
  v.hidden = false;

  const nonce = hex(16);   // 32 hex, encaja con el patrón del SQL
  const url = location.origin + location.pathname + '#kiosco-claim?code=' + nonce;

  const img = $('kiosco-qr');
  const alt = $('kiosco-qr-alt');
  try {
    img.src = await QRCode.toDataURL(url, { width: 280, margin: 1 });
    img.hidden = false; if (alt) alt.hidden = true;
  } catch (_) {
    if (alt) { alt.hidden = false; alt.textContent = url; }
    if (img) img.hidden = true;
  }

  const estado = $('kiosco-emp-estado');
  if (estado) estado.textContent = 'Esperando a que un gestor lo escanee…';

  const cancelar = $('kiosco-emp-cancelar');
  if (cancelar) cancelar.onclick = cancelarEmparejamiento;

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const token = await reclamarToken(nonce);
      if (token) {
        clearInterval(pollTimer); pollTimer = null;
        localStorage.setItem(CLAVE_TOKEN, token);
        history.replaceState(null, '', location.pathname + location.search);
        if (estado) estado.textContent = '¡Vinculado! Abriendo el kiosco…';
        setTimeout(() => mostrarKiosco(token), 700);
      }
    } catch (_) { /* reintenta al siguiente ciclo */ }
  }, 2000);
}

function cancelarEmparejamiento() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  location.hash = '';
  location.reload();
}

/* =========================================================
   EL GESTOR COMPLETA EL EMPAREJAMIENTO (#kiosco-claim)
   Se llama tras cargar la app, con ctx ya disponible.
   ========================================================= */
export async function revisarVinculacionPendiente(ctx) {
  const hash = location.hash || '';
  if (!hash.startsWith('#kiosco-claim')) return;
  const m = hash.match(/code=([a-f0-9]+)/i);
  const code = m ? m[1] : null;
  history.replaceState(null, '', location.pathname + location.search);
  if (!code) return;
  await vincularConCodigo(ctx, code);
}

/* Núcleo de la vinculación: pide negocio + nombre y llama al servidor. */
async function vincularConCodigo(ctx, code) {
  if (!ctx || ctx.role !== 'manager') {
    toast('Solo un gestor puede vincular un kiosco.');
    return;
  }
  let negocios = [];
  try { negocios = await negociosGestor(); } catch (_) {}
  if (negocios.length === 0) { toast('No se encontró tu negocio.'); return; }

  const datos = await pedirDatosVinculacion(negocios);
  if (!datos) return;
  try {
    await vincularKiosco(code, datos.businessId, datos.nombre);
    toast('Kiosco «' + datos.nombre + '» vinculado. La tablet ya puede fichar.');
  } catch (err) {
    toast('No se pudo vincular: ' + err.message);
  }
}

/* =========================================================
   ESCANEAR EL QR CON LA CÁMARA (desde Ajustes del gestor)
   ========================================================= */
export async function escanearYVincular(ctx) {
  if (!ctx || ctx.role !== 'manager') {
    toast('Solo un gestor puede vincular un kiosco.');
    return;
  }

  const ov = document.createElement('div');
  ov.className = 'kiosco-scan-ov';
  ov.innerHTML =
    '<div class="kiosco-scan">' +
      '<video id="kscan-video" playsinline muted></video>' +
      '<div class="kscan-marco"></div>' +
      '<p class="kscan-txt">Apunta al QR que muestra la tablet</p>' +
      '<button class="btn" id="kscan-cerrar" type="button">Cancelar</button>' +
    '</div>';
  document.body.appendChild(ov);

  const video = ov.querySelector('#kscan-video');
  const canvas = document.createElement('canvas');
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, raf = null, activo = true;

  const cerrar = () => {
    activo = false;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    ov.remove();
  };
  ov.querySelector('#kscan-cerrar').onclick = cerrar;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
  } catch (_) {
    cerrar();
    toast('No se pudo abrir la cámara. Revisa los permisos del navegador.');
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});

  const tick = () => {
    if (!activo) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      cx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let res = null;
      try {
        const img = cx.getImageData(0, 0, canvas.width, canvas.height);
        res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      } catch (_) {}
      if (res && res.data) {
        const m = res.data.match(/code=([a-f0-9]+)/i);
        if (m) { cerrar(); vincularConCodigo(ctx, m[1]); return; }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/* Modal: elegir negocio (si hay varios) + nombre del kiosco */
function pedirDatosVinculacion(negocios) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'kiosco-modal-ov';
    const opciones = negocios.map((n) =>
      '<option value="' + n.id + '">' + n.name + '</option>').join('');
    ov.innerHTML =
      '<div class="kiosco-modal">' +
        '<h3>Vincular kiosco</h3>' +
        (negocios.length > 1
          ? '<label class="km-campo">Negocio<select id="kv-negocio">' + opciones + '</select></label>'
          : '<input type="hidden" id="kv-negocio" value="' + negocios[0].id + '">') +
        '<label class="km-campo">Nombre del kiosco' +
          '<input type="text" id="kv-nombre" maxlength="30" placeholder="Ej.: Barra"></label>' +
        '<div class="kiosco-modal-btns">' +
          '<button class="btn" id="kv-cancelar" type="button">Cancelar</button>' +
          '<button class="btn primary" id="kv-ok" type="button">Vincular</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    const cerrar = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('#kv-cancelar').onclick = () => cerrar(null);
    ov.querySelector('#kv-ok').onclick = () => {
      const businessId = ov.querySelector('#kv-negocio').value;
      const nombre = (ov.querySelector('#kv-nombre').value || '').trim();
      if (!nombre) { toast('Ponle un nombre al kiosco'); return; }
      cerrar({ businessId, nombre });
    };
  });
}

/* =========================================================
   PANTALLA DE KIOSCO — rejilla → PIN → confirmación
   ========================================================= */
export async function mostrarKiosco(token) {
  ocultarPantallas();
  const v = $('vista-kiosco');
  if (!v) return;
  v.hidden = false;
  arrancarReloj();
  const salir = $('kiosco-salir');
  if (salir) salir.onclick = () => desvincular(false);
  await pintarRejilla(token);

  // Contador en vivo (cada segundo) y refresco de estado (cada 60 s).
  if (contadorTimer) clearInterval(contadorTimer);
  contadorTimer = setInterval(actualizarContadores, 1000);
  if (refrescoTimer) clearInterval(refrescoTimer);
  refrescoTimer = setInterval(() => pintarRejilla(token, true), 30000);
}

function arrancarReloj() {
  const reloj = $('kiosco-reloj');
  if (!reloj) return;
  const tick = () => {
    reloj.textContent = new Date().toLocaleTimeString('es-ES',
      { hour: '2-digit', minute: '2-digit', timeZone: tzKiosco });
  };
  tick();
  if (relojTimer) clearInterval(relojTimer);
  relojTimer = setInterval(tick, 1000);
}

async function pintarRejilla(token, silencioso) {
  const grid = $('kiosco-grid');
  if (!grid) return;
  if (!silencioso) grid.innerHTML = '<div class="empty-note">Cargando equipo…</div>';

  let estado;
  try {
    estado = await estadoKiosco(token);
  } catch (_) {
    grid.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'kiosco-error';
    msg.innerHTML = '<p>Este dispositivo ya no está vinculado.</p>';
    const b = document.createElement('button');
    b.className = 'btn primary'; b.textContent = 'Volver a emparejar';
    b.onclick = () => desvincular(true);
    msg.appendChild(b);
    grid.appendChild(msg);
    return;
  }

  if (estado.tz) tzKiosco = estado.tz;
  calcularHorarioHoy(estado.horarios, estado.margen_seg);
  const equipo = estado.workers || [];

  grid.innerHTML = '';
  if (equipo.length === 0) {
    grid.innerHTML = '<div class="empty-note">No hay trabajadores activos.</div>';
    return;
  }
  for (const w of equipo) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'kiosco-emp' + (w.tiene_pin ? '' : ' sin-pin');
    card.dataset.dentro = w.dentro ? '1' : '';
    card.dataset.desde = w.desde || '';
    card.dataset.tarde = (w.dentro && llegoTarde(w.desde, w.tramos)) ? '1' : '';
    card.dataset.max = String(minDeTramos(w.tramos));
    card.dataset.seghoy = String(Number(w.seg_hoy) || 0);
    card.innerHTML = '<span class="ke-avatar">' + iniciales(w.name) + '</span>'
      + '<span class="ke-nombre"></span>'
      + '<span class="ke-timer"></span>';
    card.querySelector('.ke-nombre').textContent = w.name;
    card.onclick = () => abrirPin(token, w);
    grid.appendChild(card);
  }
  actualizarContadores();
}

/* Actualiza el tiempo trabajado y el color de cada tarjeta (cada segundo). */
function actualizarContadores() {
  const grid = $('kiosco-grid');
  if (!grid) return;
  for (const card of grid.querySelectorAll('.kiosco-emp')) {
    const timer = card.querySelector('.ke-timer');
    if (!timer) continue;
    if (card.dataset.dentro === '1' && card.dataset.desde) {
      const ms = Date.now() - new Date(card.dataset.desde).getTime();
      const max = Number(card.dataset.max) || 0;
      const exceso = max > 0 && (ms / 60000) > max;
      const rojo = card.dataset.tarde === '1' || exceso;
      timer.textContent = fmtDur(ms) + (card.dataset.tarde === '1' ? ' · tarde' : (exceso ? ' · exceso' : ''));
      card.classList.toggle('activo', !rojo);
      card.classList.toggle('rojo', rojo);
    } else {
      const seg = Number(card.dataset.seghoy) || 0;
      timer.textContent = seg > 0 ? fmtDur(seg * 1000) : '00:00:00';
      card.classList.remove('activo', 'rojo');
      card.classList.toggle('hecho', seg > 0);
    }
  }
}

/* ---------- teclado de PIN ---------- */
function abrirPin(token, worker) {
  const ov = $('kiosco-pin');
  if (!ov) return;
  let pin = '';
  ov.hidden = false;
  ov.innerHTML = '';

  const caja = document.createElement('div');
  caja.className = 'kpin-caja';

  const titulo = document.createElement('div');
  titulo.className = 'kpin-nombre';
  titulo.textContent = worker.name;
  caja.appendChild(titulo);

  const puntos = document.createElement('div');
  puntos.className = 'kpin-puntos';
  caja.appendChild(puntos);

  const err = document.createElement('div');
  err.className = 'kpin-err';
  caja.appendChild(err);

  const pintarPuntos = () => {
    puntos.textContent = pin.length ? '●'.repeat(pin.length) : '·';
  };
  pintarPuntos();

  const teclado = document.createElement('div');
  teclado.className = 'kpin-teclado';
  for (const t of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kpin-tecla' + (t === 'OK' ? ' ok' : '') + (t === 'C' ? ' borrar' : '');
    b.textContent = t === 'C' ? '⌫' : t;
    b.onclick = async () => {
      err.textContent = '';
      if (t === 'C') { pin = pin.slice(0, -1); pintarPuntos(); return; }
      if (t === 'OK') {
        if (pin.length < 4) { err.textContent = 'PIN demasiado corto'; return; }
        await enviarFichaje(token, worker, pin, err, ov);
        return;
      }
      if (pin.length >= 6) return;
      pin += t; pintarPuntos();
    };
    teclado.appendChild(b);
  }
  caja.appendChild(teclado);

  const cancelar = document.createElement('button');
  cancelar.type = 'button'; cancelar.className = 'kpin-cancelar';
  cancelar.textContent = 'Cancelar';
  cancelar.onclick = () => { ov.hidden = true; };
  caja.appendChild(cancelar);

  ov.appendChild(caja);
}

const MENSAJES = {
  PIN_INCORRECTO: 'PIN incorrecto',
  SIN_PIN: 'Configura tu PIN en la app primero',
  IP_NO_PERMITIDA: 'Este dispositivo no está en la red del local',
  KIOSCO_INVALIDO: 'Dispositivo no vinculado',
  BLOQUEADO: 'Demasiados intentos. Espera unos minutos.',
  FALTAN_DATOS: 'No se pudo fichar, inténtalo de nuevo',
  ERROR: 'No se pudo fichar, inténtalo de nuevo',
};

async function enviarFichaje(token, worker, pin, err, ov) {
  err.textContent = 'Fichando…';
  try {
    const r = await ficharKiosco(token, worker.worker_id, pin);   // { ok, tipo, momento }
    ov.hidden = true;
    mostrarConfirmacion(worker, r.tipo, r.momento);
    pintarRejilla(token, true);   // refresca el estado del que acaba de fichar
  } catch (e) {
    const code = (e.message || 'ERROR').trim();
    err.textContent = MENSAJES[code] || ('No se pudo fichar · ' + code);
    if (code === 'KIOSCO_INVALIDO') setTimeout(() => desvincular(true), 1200);
  }
}

function mostrarConfirmacion(worker, tipo, momento) {
  const ov = $('kiosco-confirma');
  if (!ov) return;
  const entrada = tipo === 'entrada';
  ov.className = 'kiosco-confirma ' + (entrada ? 'entrada' : 'salida');
  ov.innerHTML =
    '<div class="kc-emoji">' + (entrada ? '✅' : '👋') + '</div>' +
    '<div class="kc-txt">' + (entrada ? 'Entrada registrada' : 'Salida registrada') + '</div>' +
    '<div class="kc-nombre"></div>' +
    '<div class="kc-hora">' + horaCanaria(momento) + '</div>';
  ov.querySelector('.kc-nombre').textContent = worker.name;
  ov.hidden = false;
  setTimeout(() => { ov.hidden = true; }, 3000);
}

/* ---------- salir del modo kiosco ---------- */
async function desvincular(silencioso) {
  if (!silencioso) {
    const ok = await confirmar('¿Sacar esta tablet del modo kiosco?', {
      textoOk: 'Sí, salir', peligro: true,
    });
    if (!ok) return;
  }
  if (contadorTimer) { clearInterval(contadorTimer); contadorTimer = null; }
  if (refrescoTimer) { clearInterval(refrescoTimer); refrescoTimer = null; }
  localStorage.removeItem(CLAVE_TOKEN);
  location.hash = '';
  location.reload();
}

/* =========================================================
   LISTA DE KIOSCOS (gestor · Ajustes) — renombrar / eliminar
   ========================================================= */
export async function pintarKioscos(ctx) {
  const cont = $('kioscos-lista');
  if (!cont || !ctx || !ctx.business) return;
  cont.innerHTML = '<div class="empty-note">Cargando…</div>';

  let lista;
  try { lista = await listarKioscos(ctx.business.id); }
  catch (_) { cont.innerHTML = '<div class="empty-note">No se pudieron cargar los kioscos.</div>'; return; }

  cont.innerHTML = '';
  if (lista.length === 0) {
    cont.innerHTML = '<div class="empty-note">Aún no hay ninguna tablet vinculada.</div>';
    return;
  }

  for (const k of lista) {
    const fila = document.createElement('div');
    fila.className = 'kiosco-fila';
    pintarFilaKiosco(fila, k, ctx);
    cont.appendChild(fila);
  }
}

function pintarFilaKiosco(fila, k, ctx) {
  fila.innerHTML = '';
  const nom = document.createElement('span');
  nom.className = 'kiosco-fila-nombre';
  nom.textContent = k.nombre;
  fila.appendChild(nom);

  const acc = document.createElement('div');
  acc.className = 'kiosco-fila-acc';

  const bRen = document.createElement('button');
  bRen.className = 'btn small'; bRen.type = 'button'; bRen.textContent = 'Renombrar';
  bRen.onclick = () => editarNombreKiosco(fila, k, ctx);

  const bDel = document.createElement('button');
  bDel.className = 'btn small peligro'; bDel.type = 'button'; bDel.textContent = 'Eliminar';
  bDel.onclick = async () => {
    const ok = await confirmar('¿Eliminar el kiosco «' + k.nombre + '»? Esa tablet dejará de poder fichar.', {
      textoOk: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    try { await eliminarKiosco(k.id); toast('Kiosco eliminado'); pintarKioscos(ctx); }
    catch (e) { toast('No se pudo eliminar: ' + e.message); }
  };

  acc.appendChild(bRen); acc.appendChild(bDel);
  fila.appendChild(acc);
}

function editarNombreKiosco(fila, k, ctx) {
  fila.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = k.nombre; inp.maxLength = 30; inp.className = 'kiosco-fila-input';
  fila.appendChild(inp);

  const acc = document.createElement('div');
  acc.className = 'kiosco-fila-acc';

  const bOk = document.createElement('button');
  bOk.className = 'btn small primary'; bOk.type = 'button'; bOk.textContent = 'Guardar';
  bOk.onclick = async () => {
    const nombre = (inp.value || '').trim();
    if (!nombre) { toast('Ponle un nombre'); return; }
    try { await renombrarKiosco(k.id, nombre); toast('Nombre actualizado'); pintarKioscos(ctx); }
    catch (e) { toast('No se pudo: ' + e.message); }
  };

  const bNo = document.createElement('button');
  bNo.className = 'btn small'; bNo.type = 'button'; bNo.textContent = 'Cancelar';
  bNo.onclick = () => pintarKioscos(ctx);

  acc.appendChild(bOk); acc.appendChild(bNo);
  fila.appendChild(acc);
  inp.focus();
}
export async function pintarPinEmpleado(ctx) {
  const cont = $('pin-empleado');
  if (!cont || !ctx || !ctx.business) return;

  let tiene = false;
  try { tiene = await tengoPin(ctx.business.id); } catch (_) {}
  const estado = $('pin-empleado-estado');
  if (estado) estado.textContent = tiene
    ? 'Tienes un PIN configurado. Puedes cambiarlo cuando quieras.'
    : 'Aún no has configurado tu PIN. Sin él no podrás fichar en el kiosco.';

  const inp = $('pin-empleado-input');
  const btn = $('pin-empleado-guardar');
  if (!inp || !btn) return;
  inp.value = '';
  btn.onclick = async () => {
    const pin = (inp.value || '').trim();
    if (!/^[0-9]{4,6}$/.test(pin)) { toast('El PIN debe tener entre 4 y 6 dígitos'); return; }
    btn.disabled = true;
    try {
      await ponerMiPin(ctx.business.id, pin);
      toast('PIN guardado');
      inp.value = '';
      if (estado) estado.textContent = 'Tienes un PIN configurado. Puedes cambiarlo cuando quieras.';
    } catch (err) { toast('No se pudo guardar: ' + err.message); }
    finally { btn.disabled = false; }
  };
}
