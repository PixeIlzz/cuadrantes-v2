// Tablón de avisos del negocio. v18
import { sb } from '../supabase.js?v=18';
import { ctx } from '../auth.js?v=18';

/* Avisos visibles (RLS ya filtra activos y no caducados para el empleado) */
export async function avisosVisibles() {
  const { data, error } = await sb
    .from('announcements')
    .select('id, text, pinned, active, expires_at, created_at')
    .eq('business_id', ctx.business.id)
    .eq('active', true)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error('Avisos: ' + error.message);
  const hoy = new Date().toISOString().slice(0, 10);
  return (data || []).filter((a) => !a.expires_at || a.expires_at >= hoy);
}

/* Todos, incluidos los archivados: solo para el gestor */
export async function todosLosAvisos() {
  const { data, error } = await sb
    .from('announcements')
    .select('id, text, pinned, active, expires_at, created_at')
    .eq('business_id', ctx.business.id)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error('Avisos: ' + error.message);
  return data || [];
}

export async function crearAviso(texto, { pinned = false, expira = null } = {}) {
  const { data, error } = await sb
    .from('announcements')
    .insert({
      business_id: ctx.business.id,
      text: texto,
      pinned,
      expires_at: expira,
      created_by: ctx.user.id,
    })
    .select('id, text, pinned, active, expires_at, created_at')
    .single();
  if (error) throw new Error('No se pudo publicar el aviso: ' + error.message);
  return data;
}

export async function actualizarAviso(id, campos) {
  const { error } = await sb.from('announcements').update(campos).eq('id', id);
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

export async function borrarAviso(id) {
  const { error } = await sb.from('announcements').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar: ' + error.message);
}
