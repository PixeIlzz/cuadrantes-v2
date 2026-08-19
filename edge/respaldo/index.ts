// Edge Function: respaldo
//
// Vuelca cada empresa en SU PROPIA carpeta dentro de un repositorio privado
// de GitHub:  respaldos/<empresa>/<año>/<fecha>.json
// La llama pg_cron los domingos a las 4:00 (migración 50), y a mano con
// `select public.lanzar_respaldo();`.
//
// Un archivo por empresa y no uno grande: así el historial de git enseña
// qué cambió en cada cliente, y para entregarle sus datos a uno basta con
// darle su carpeta.
//
// Por qué GitHub y no correo: el volcado lleva el NIF y el número de la
// Seguridad Social de cada trabajador. Mandar eso por email sin cifrar,
// cada semana, es una mala práctica con datos personales que no son
// nuestros. Y por qué no Supabase Storage: vive en el mismo proyecto, así
// que no cubre el escenario de perder el proyecto, que es justo del que
// queremos cubrirnos.
//
// Desplegar desde el panel: Edge Functions → Deploy → Via Editor →
// nombre "respaldo" → pegar todo esto. Con Verify JWT DESACTIVADO.
//
// Secretos: GITHUB_TOKEN (fine-grained, SOLO ese repo, Contents R/W),
//           GITHUB_REPO (usuario/repositorio), RESPALDO_SECRET.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GITHUB_TOKEN    = Deno.env.get('GITHUB_TOKEN') || '';
const GITHUB_REPO     = (Deno.env.get('GITHUB_REPO') || '').trim();
const RESPALDO_SECRET = Deno.env.get('RESPALDO_SECRET') || '';

Deno.serve(async (req) => {
  try {
    const cabecera = req.headers.get('Authorization') || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
    if (!RESPALDO_SECRET || token !== RESPALDO_SECRET) {
      return new Response('no autorizado', { status: 401 });
    }
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return new Response('faltan GITHUB_TOKEN o GITHUB_REPO', { status: 500 });
    }
    // Errores de copiar y pegar que producen un 404 idéntico al de "no existe"
    if (!/^[^/\s]+\/[^/\s]+$/.test(GITHUB_REPO)) {
      return new Response(
        `GITHUB_REPO debe ser "usuario/repositorio", sin URL ni .git. Visto: "${GITHUB_REPO}"`,
        { status: 500 },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await admin.rpc('respaldo_completo');
    if (error) {
      return new Response('error al volcar: ' + error.message, { status: 500 });
    }

    const empresas = Array.isArray((data as any)?.empresas) ? (data as any).empresas : [];
    if (empresas.length === 0) {
      return new Response('no hay empresas que respaldar', { status: 500 });
    }

    const hoy = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const anio = hoy.slice(0, 4);
    const hechas: unknown[] = [];
    const fallos: string[] = [];

    // Secuencial a propósito: cada PUT es un commit, y en paralelo
    // chocarían entre ellos por escribir sobre la misma rama.
    for (const emp of empresas) {
      const nombre = emp?.negocio?.nombre || 'sin-nombre';
      const ruta = `respaldos/${carpeta(nombre)}/${anio}/${hoy}.json`;
      const texto = JSON.stringify(emp, null, 2);

      try {
        // Si ya existe el de hoy (relanzado a mano) hace falta su sha
        let sha: string | undefined;
        const previo = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${ruta}`,
          { headers: cabecerasGitHub() },
        );
        if (previo.status === 200) sha = (await previo.json()).sha;

        const fichajes = Array.isArray(emp?.fichajes) ? emp.fichajes.length : 0;
        const put = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${ruta}`,
          {
            method: 'PUT',
            headers: { ...cabecerasGitHub(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `${nombre} · ${hoy} · ${fichajes} fichajes · ${Math.round(texto.length / 1024)} KB`,
              content: base64(texto),
              ...(sha ? { sha } : {}),
            }),
          },
        );

        if (!put.ok) {
          const detalle = await put.text();
          // GitHub responde 404 tanto si el repo no existe como si el token
          // no tiene permiso: en los privados no distingue, para no filtrar
          // que existe. Pasó de verdad con una I mayúscula por una l.
          const pista = put.status === 404
            ? ' (revisa GITHUB_REPO, que el token tenga ESE repo seleccionado'
              + ' y su permiso Contents en Read and write)'
            : (put.status === 403 ? ' (falta permiso Contents: Read and write)' : '');
          fallos.push(`${nombre}: GitHub ${put.status}${pista} — ${detalle.slice(0, 200)}`);
        } else {
          hechas.push({ empresa: nombre, ruta, fichajes, bytes: texto.length });
        }
      } catch (e) {
        fallos.push(`${nombre}: ${e}`);
      }
    }

    const cuerpo = JSON.stringify({ ok: fallos.length === 0, hechas, fallos }, null, 2);
    return new Response(cuerpo, {
      status: fallos.length ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response('error: ' + err, { status: 500 });
  }
});

function cabecerasGitHub() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'staffpoint-respaldo',
  };
}

/* Nombre de carpeta a partir del nombre del negocio: sin acentos, sin
   espacios ni signos. "Asadero Las Brasas" → "asadero-las-brasas".
   Los acentos y eñes en rutas de git dan problemas según el sistema donde
   se clone, así que se normalizan. Si se renombra una empresa aparecerá una
   carpeta nueva: el id real va dentro del archivo, en negocio.id. */
function carpeta(nombre: string): string {
  const s = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'empresa';
}

/* btoa() solo entiende latin-1 y el volcado lleva acentos y eñes: hay que
   pasar por UTF-8 antes o los nombres salen rotos. */
function base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
