// Ajustes del empleado: sus datos, contraseña e instalación.
import { toast } from './toast.js';
import { ctx } from '../auth.js';
import { sb } from '../supabase.js';

const $ = (id) => document.getElementById(id);

export function initAjustesEmpleado() {
  $('btn-cambiar-pass').addEventListener('click', cambiarPass);
}

export async function abrirAjustesEmpleado() {
  $('emp-aj-email').textContent = ctx.user ? ctx.user.email : '—';
  $('emp-aj-negocio').textContent = ctx.business ? ctx.business.name : '—';

  if (!ctx.workerId) {
    $('emp-aj-nombre').textContent = '—';
    $('emp-aj-turnos').textContent = 'Cuenta sin ficha enlazada';
    return;
  }
  try {
    const { data, error } = await sb
      .from('workers')
      .select('name, weekly_shifts')
      .eq('id', ctx.workerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    $('emp-aj-nombre').textContent = data ? data.name : '—';
    $('emp-aj-turnos').textContent = data ? data.weekly_shifts + ' turnos' : '—';
  } catch (err) {
    toast('No se pudieron cargar tus datos: ' + err.message);
  }
}

async function cambiarPass() {
  const p1 = $('emp-pass1').value;
  const p2 = $('emp-pass2').value;
  if (p1.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return; }
  if (p1 !== p2) { toast('Las dos contraseñas no coinciden'); return; }

  const btn = $('btn-cambiar-pass');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw new Error(error.message);
    $('emp-pass1').value = ''; $('emp-pass2').value = '';
    toast('Contraseña cambiada');
  } catch (err) {
    toast('No se pudo cambiar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Cambiar contraseña';
  }
}
