// Notificaciones internas y sus preferencias.
import { sb } from '../supabase.js';
import { ctx } from '../auth.js';

/* Catálogo de tipos, con su etiqueta y a quién aplica.
   Sirve para pintar el centro de preferencias. */
export const TIPOS_GESTOR = [
  { id: 'request_new',   label: 'Nuevas solicitudes del equipo' },
];
export const TIPOS_EMPLEADO = [
  { id: 'request_resolved', label: 'Respuesta a mis solicitudes' },
  { id: 'week_published',   label: 'Nuevo cuadrante publicado' },
  { id: 'announcement',     label: 'Avisos destacados del negocio' },
];

export async function listarNotificaciones(limite = 30) {
  const { data, error } = await sb
    .from('notifications')
    .select('id, type, title, body, link_tab, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error('Notificaciones: ' + error.message);
  return data || [];
}

export async function contarNoLeidas() {
  const { count, error } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) return 0;
  return count || 0;
}

export async function marcarLeida(id) {
  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function marcarTodasLeidas() {
  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

/* Preferencias: qué tipos quiere el usuario */
export async function leerPreferencias() {
  const { data, error } = await sb
    .from('notification_prefs')
    .select('prefs, push_enabled')
    .eq('profile_id', ctx.user.id)
    .maybeSingle();
  if (error) return { prefs: {}, push_enabled: false };
  return data || { prefs: {}, push_enabled: false };
}

export async function guardarPreferencia(tipo, activo) {
  const actual = await leerPreferencias();
  const prefs = { ...(actual.prefs || {}), [tipo]: activo };
  const { error } = await sb
    .from('notification_prefs')
    .upsert({ profile_id: ctx.user.id, prefs, updated_at: new Date().toISOString() },
            { onConflict: 'profile_id' });
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}
