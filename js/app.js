// Arranque y enrutado básico. De momento: login + pantalla de bienvenida.
import { ctx, signIn, signOut, loadContext, getSession, onAuthChange } from './auth.js';

const $ = (id) => document.getElementById(id);

const vistaLogin = $('vista-login');
const vistaApp   = $('vista-app');
const formLogin  = $('form-login');
const errorLogin = $('login-error');
const btnEntrar  = $('btn-entrar');

/* ---------- Arranque ---------- */
arrancar();

async function arrancar() {
  try {
    const session = await getSession();
    if (session) {
      await entrarEnLaApp();
    } else {
      mostrarLogin();
    }
  } catch (err) {
    console.error(err);
    $('cargando').innerHTML =
      '<div class="tarjeta"><h2>No se pudo iniciar</h2>' +
      '<p class="error">' + (err.message || err) + '</p></div>';
    return;                 // deja el mensaje visible
  }
  $('cargando').hidden = true;
}

/* ---------- Login ---------- */
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorLogin.textContent = '';
  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Entrando…';
  try {
    await signIn($('email').value, $('password').value);
    await entrarEnLaApp();
  } catch (err) {
    errorLogin.textContent = err.message;
  } finally {
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Entrar';
  }
});

$('btn-salir').addEventListener('click', async () => {
  await signOut();
  location.reload();
});

/* ---------- Vistas ---------- */
function mostrarLogin() {
  vistaLogin.hidden = false;
  vistaApp.hidden = true;
}

async function entrarEnLaApp() {
  const ok = await loadContext();
  if (!ok) {
    errorLogin.textContent =
      'Tu cuenta no está asociada a ningún negocio. Pide un código de invitación al gestor.';
    await signOut();
    mostrarLogin();
    return;
  }

  vistaLogin.hidden = true;
  vistaApp.hidden = false;

  $('negocio-nombre').textContent = ctx.business.name;
  $('usuario-email').textContent = ctx.user.email;
  $('usuario-rol').textContent = ctx.role === 'manager' ? 'Gestor' : 'Empleado';

  // Comprobación de que la configuración viaja bien desde la base de datos
  const cfg = ctx.business.config || {};
  $('debug-dias').textContent   = (cfg.days  || []).map(d => d.label).join(' · ');
  $('debug-puestos').textContent = (cfg.roles || [])
    .map(r => `${r.label} (mín. ${r.min})`).join(' · ');
  const pub = cfg.publish || {};
  const nombresDia = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  $('debug-pub').textContent = `${nombresDia[pub.weekday ?? 0]} a las ${pub.time || '18:00'}`;
}

/* Si la sesión se cierra en otra pestaña, recargamos para no quedar en un estado raro. */
onAuthChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});
