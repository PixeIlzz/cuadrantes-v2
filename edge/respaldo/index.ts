// Edge Function: respaldo
//
// Vuelca todas las empresas y guarda el JSON en un repositorio PRIVADO de
// GitHub, un archivo por fecha. La llama pg_cron los domingos a las 4:00
// (migración 50), y también se puede lanzar a mano con
// `select public.lanzar_respaldo();`.
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
// Secretos que necesita:
//   GITHUB_TOKEN     token fine-grained, SOLO ese repo, Contents R/W
//   GITHUB_REPO      usuario/staffpoint-respaldos
//   RESPALDO_SECRET  el mismo que app_config.respaldo_key
//   (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GITHUB_TOKEN   = Deno.env.get('GITHUB_TOKEN') || '';
const GITHUB_REPO    = Deno.env.get('GITHUB_REPO') || '';
const RESPALDO_SECRET = Deno.env.get('RESPALDO_SECRET') || '';

Deno.serve(async (req) => {
  try {
    // Se falla cerrado: sin secreto configurado no se atiende a nadie
    const cabecera = req.headers.get('Authorization') || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
    if (!RESPALDO_SECRET || token !== RESPALDO_SECRET) {
      return new Response('no autorizado', { status: 401 });
    }
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return new Response('faltan GITHUB_TOKEN o GITHUB_REPO', { status: 500 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Volcado completo
    const { data, error } = await admin.rpc('respaldo_completo');
    if (error) {
      return new Response('error al volcar: ' + error.message, { status: 500 });
    }

    const texto = JSON.stringify(data, null, 2);

    // 2) Ruta con fecha: un archivo por respaldo, y el historial lo da git
    const hoy = new Date().toISOString().slice(0, 10);      // YYYY-MM-DD
    const ruta = `respaldos/${hoy.slice(0, 4)}/${hoy}.json`;

    // 3) Si ya existe el de hoy (relanzado a mano), hace falta su sha
    let sha: string | undefined;
    const previo = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${ruta}`,
      { headers: cabecerasGitHub() },
    );
    if (previo.status === 200) {
      const j = await previo.json();
      sha = j.sha;
    }

    // 4) Subirlo. El contenido va en base64, como pide la API.
    const empresas = Array.isArray((data as any)?.empresas) ? (data as any).empresas.length : 0;
    const put = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${ruta}`,
      {
        method: 'PUT',
        headers: { ...cabecerasGitHub(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Respaldo ${hoy} · ${empresas} empresas · ${Math.round(texto.length / 1024)} KB`,
          content: base64(texto),
          ...(sha ? { sha } : {}),
        }),
      },
    );

    if (!put.ok) {
      const detalle = await put.text();
      return new Response('GitHub ' + put.status + ': ' + detalle, { status: 500 });
    }

    return new Response(JSON.stringify({
      ok: true, ruta, empresas, bytes: texto.length,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

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

/* btoa() solo entiende latin-1 y el volcado lleva acentos y eñes: hay que
   pasar por UTF-8 antes o los nombres salen rotos. */
function base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
