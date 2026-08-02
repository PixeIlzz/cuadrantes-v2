// Diálogo que ofrece activar los avisos, una sola vez tras iniciar sesión.
import { activarPush, situacionPush } from './push.js';

const VISTO = 'staffpoint-push-ofrecido';

function yaSeOfrecio() {
  try { return localStorage.getItem(VISTO) === '1'; } catch (_) { return false; }
}
function marcarOfrecido() {
  try { localStorage.setItem(VISTO, '1'); } catch (_) {}
}

/* Se llama al entrar. Muestra el diálogo solo la primera vez y solo si
   tiene sentido (no si ya están activos o el dispositivo no puede). */
export function ofrecerAvisos() {
  if (yaSeOfrecio()) return;

  const sit = situacionPush();
  // Si ya están activos o el navegador no soporta nada, no molestamos
  // (pero lo marcamos como ofrecido para no volver a evaluarlo).
  if (sit === 'ya-activo' || sit === 'no-soportado' || sit === 'bloqueado') {
    marcarOfrecido();
    return;
  }

  // Pequeño retraso para que no salte encima de la carga de la app
  setTimeout(() => mostrarDialogo(sit), 900);
}

function mostrarDialogo(sit) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg push-bienvenida-bg';

  const caja = document.createElement('div');
  caja.className = 'modal push-bienvenida';

  const icono = '<div class="pb-icono">🔔</div>';
  const titulo = '<h2 class="pb-tit">¿Quieres recibir avisos?</h2>';

  let cuerpo, botones;

  if (sit === 'ios-sin-instalar') {
    // iPhone que abre desde Safari sin haber instalado la app
    cuerpo = '<p class="pb-txt">Para recibir avisos en el iPhone, primero tienes que '
      + '<b>añadir la app a tu pantalla de inicio</b>:</p>'
      + '<ol class="pb-pasos">'
      + '<li>Toca el botón <b>Compartir</b> (el cuadrado con la flecha ↑).</li>'
      + '<li>Pulsa <b>«Añadir a pantalla de inicio»</b>.</li>'
      + '<li>Abre la app <b>desde el icono nuevo</b> y ya podrás activar los avisos.</li>'
      + '</ol>';
    botones = '<button class="btn primary" id="pb-ok" type="button">Entendido</button>';
  } else {
    // Caso normal: navegador con soporte
    cuerpo = '<p class="pb-txt">Te avisaremos en este dispositivo cuando ocurra algo importante, '
      + 'aunque no tengas la app abierta:</p>'
      + '<ul class="pb-lista">'
      + '<li>📅 Se publica un cuadrante nuevo</li>'
      + '<li>✅ Te responden una solicitud</li>'
      + '<li>📣 Hay un aviso importante del negocio</li>'
      + '</ul>'
      + '<p class="pb-nota">Podrás desactivarlos cuando quieras desde Ajustes.</p>';
    botones = '<button class="btn" id="pb-no" type="button">Ahora no</button>'
      + '<button class="btn primary" id="pb-si" type="button">Activar avisos</button>';
  }

  caja.innerHTML = icono + titulo + cuerpo + '<div class="pb-botones">' + botones + '</div>';
  bg.appendChild(caja);
  document.body.appendChild(bg);

  const cerrar = () => { marcarOfrecido(); bg.remove(); };

  const bOk = caja.querySelector('#pb-ok');
  if (bOk) bOk.addEventListener('click', cerrar);

  const bNo = caja.querySelector('#pb-no');
  if (bNo) bNo.addEventListener('click', cerrar);

  const bSi = caja.querySelector('#pb-si');
  if (bSi) bSi.addEventListener('click', async () => {
    bSi.disabled = true; bSi.textContent = 'Activando…';
    try { await activarPush(); } catch (_) {}
    cerrar();
  });

  // No se cierra tocando fuera: obligamos a elegir (pero solo esta vez)
}
