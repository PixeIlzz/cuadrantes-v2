// Estado de las guías de bienvenida.
//
// La del gestor vive en businesses.config.onboarding, porque es del
// negocio: si mañana entra otro socio como gestor, el negocio ya está
// configurado y no tiene sentido volver a pedírselo.
//
// La del empleado vive en profiles.onboarding, porque es de la persona.
// Y en el perfil, no en el navegador: si no, se le repetiría cada vez que
// cambia de móvil o borra los datos del sitio (migración 51).
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* ---------- Gestor ---------- */

export function guiaGestorVista() {
  const ob = (ctx.business && ctx.business.config && ctx.business.config.onboarding) || {};
  return !!ob.hecha;
}

/* Se guarda también el paso por el que iba, para poder retomarla */
export async function guardarGuiaGestor(estado) {
  const cfg = { ...(ctx.business.config || {}), onboarding: estado };
  const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
  ctx.business.config = cfg;
}

export function estadoGuiaGestor() {
  return (ctx.business && ctx.business.config && ctx.business.config.onboarding) || {};
}

/* ---------- Empleado ---------- */

export async function guiaEmpleadoVista() {
  const { data, error } = await sb
    .from('profiles').select('onboarding').eq('id', ctx.user.id).maybeSingle();
  if (error) return true;          // ante la duda no molestamos
  return !!(data && data.onboarding && data.onboarding.empleado);
}

export async function marcarGuiaEmpleado() {
  const valor = { empleado: new Date().toISOString().slice(0, 10) };
  const { error } = await sb
    .from('profiles').update({ onboarding: valor }).eq('id', ctx.user.id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

/* ---------- Negocios del usuario, para el selector ---------- */

/* Todos los negocios donde esta cuenta tiene ficha o gestión. `memberships`
   siempre fue de muchos a muchos; lo que faltaba era enseñarlos. */
export async function misNegocios() {
  const { data: mem, error } = await sb
    .from('memberships').select('role, business_id');
  if (error || !mem || mem.length === 0) return [];

  const ids = mem.map((m) => m.business_id);
  const { data: bizs } = await sb
    .from('businesses').select('id, name').in('id', ids);

  const nombre = {};
  for (const b of (bizs || [])) nombre[b.id] = b.name;

  return mem
    .map((m) => ({ id: m.business_id, rol: m.role, nombre: nombre[m.business_id] || '—' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}
