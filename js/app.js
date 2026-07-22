// Arranque y enrutado básico. Versión con diagnóstico visible.
import { ctx, signIn, signOut, loadContext, getSession, onAuthChange } from './auth.js';
import { sb } from './supabase.js';

const $ = (id) => document.getElementById(id);

const vistaLogin = $('vista-login');
const vistaApp   = $('vista-app');
const formLogin  = $('form-login');
const errorLogin = $('login-error');
const btnEntrar  = $('btn-entrar');

function paso(txt) {
  console.log('[paso]', txt);
  errorLogin.style.color = '#9aa4c7';
  errorLogin.textContent = txt;
}
function fallo(txt) {
  console.error('[fallo]', txt);
  errorLogin.style.color = '#d9534f';
  errorLogin.textContent = txt;
}

/* ---------- Arranque ---------- */
arrancar();

async function arrancar() {
  try {
    paso('Comprobando sesión…');
    const session = await getSession();
    if (session) {
      await entrarEnLaApp(session);
    } else {
      mostrarLogin();
      errorLogin.textContent = '';
    }
  } catch (err) {
    fallo('Arranque: ' + (err.message || err));
    mostrarLogin();
  }
  $('cargando').hidden = true;
}

/* ---------- Login ---------- */
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Entrando…';
  try {
    paso('Autenticando…');
    await signIn($('email').value, $('password').value);
    const session = await getSession();
    await entrarEnLaApp(session);
  } catch (err) {
    fallo(err.message || String(err));
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

async function entrarEnLaApp(session) {
  paso('Sesión correcta. Buscando tu negocio…');

  const { data: mem, error: e1 } = await sb
    .from('memberships')
    .select('role, business_id');

  if (e1) throw new Error('Al leer memberships: ' + e1.message);
  if (!mem || mem.length === 0) {
    throw new Error('Tu cuenta no está asociada a ningún negocio (0 memberships).');
  }

  paso('Membresía encontrada (' + mem[0].role + '). Cargando negocio…');

  const { data: biz, error: e2 } = await sb
    .from('businesses')
    .select('id, name, config')
    .eq('id', mem[0].business_id)
    .maybeSingle();

  if (e2) throw new Error('Al leer businesses: ' + e2.message);
  if (!biz) throw new Error('El negocio no se pudo cargar (RLS o id inexistente).');

  // Usamos el usuario de la sesión que ya tenemos en memoria.
  // (Evitamos sb.auth.getUser(), que puede quedarse colgado.)
  ctx.role = mem[0].role;
  ctx.business = biz;
  ctx.user = session.user;

  errorLogin.textContent = '';
  vistaLogin.hidden = true;
  vistaApp.hidden = false;

  $('negocio-nombre').textContent = biz.name;
  $('usuario-email').textContent = ctx.user.email;
  $('usuario-rol').textContent = ctx.role === 'manager' ? 'Gestor' : 'Empleado';

  const cfg = biz.config || {};
  $('debug-dias').textContent    = (cfg.days  || []).map(d => d.label).join(' · ');
  $('debug-puestos').textContent = (cfg.roles || []).map(r => `${r.label} (mín. ${r.min})`).join(' · ');
  const pub = cfg.publish || {};
  const nombresDia = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  $('debug-pub').textContent = `${nombresDia[pub.weekday ?? 0]} a las ${pub.time || '18:00'}`;
}

onAuthChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});
