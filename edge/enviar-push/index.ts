// Edge Function: enviar-push
// Se llama cuando se crea una notificación. Lee sus datos, busca los
// dispositivos suscritos de ese usuario y les manda una notificación push.
//
// Desplegar desde el panel de Supabase: Edge Functions → Deploy a new
// function → Via Editor → nombre "enviar-push" → pegar todo esto.
//
// Necesita los secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// y PUSH_SECRET.
//
// PUSH_SECRET: esta función tiene "Verify JWT" desactivado, así que la llama
// cualquiera que sepa la URL. Antes no se comprobaba nada y bastaba con
// mandar un notification_id para disparar un push. Ahora exige la cabecera
// Authorization con este secreto, que es el mismo que guarda la base de datos
// en app_config.push_key (migración 39). Si no coincide, 401.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const PUSH_SECRET   = Deno.env.get('PUSH_SECRET') || '';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  try {
    // Solo el trigger de la base de datos puede llamar aquí. Se falla cerrado:
    // si PUSH_SECRET no está configurado, no se atiende a nadie.
    const cabecera = req.headers.get('Authorization') || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
    if (!PUSH_SECRET || token !== PUSH_SECRET) {
      return new Response('no autorizado', { status: 401 });
    }

    const { notification_id } = await req.json();
    if (!notification_id) {
      return new Response('falta notification_id', { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Leer la notificación
    const { data: notif, error: e1 } = await admin
      .from('notifications')
      .select('profile_id, title, body, link_tab')
      .eq('id', notification_id)
      .single();
    if (e1 || !notif) return new Response('notif no encontrada', { status: 404 });

    // 2) Buscar los dispositivos de ese usuario
    const { data: subs, error: e2 } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', notif.profile_id);
    if (e2) return new Response('error subs', { status: 500 });
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // 3) Enviar a cada dispositivo
    const payload = JSON.stringify({
      title: notif.title,
      body:  notif.body || '',
      tab:   notif.link_tab || '',
    });

    let enviados = 0;
    const caducados: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        enviados++;
      } catch (err: any) {
        // 404/410 = el dispositivo ya no acepta push: se borra
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          caducados.push(s.id);
        }
      }
    }

    if (caducados.length) {
      await admin.from('push_subscriptions').delete().in('id', caducados);
    }

    return new Response(JSON.stringify({ sent: enviados }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response('error: ' + err, { status: 500 });
  }
});
