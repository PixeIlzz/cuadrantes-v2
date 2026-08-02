// Activar/desactivar avisos push en este dispositivo.
import { sb } from '../supabase.js';
import { toast } from './toast.js';

// Clave pública VAPID (no es secreta; identifica la app ante el navegador)
const VAPID_PUBLIC = 'BP98f9s8S6MP1tp8ByZ53FHflCacOg8FquAydVConq_kzkrNvFXtjJopTKaf22InSqTrpc0F3XU_8C-4_40rG04';

const $ = (id) => document.getElementById(id);

function soportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/* Diagnóstico para el diálogo: qué mensaje mostrar según el dispositivo */
export function situacionPush() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    // iPhone en Safari sin instalar entra aquí: el push existe pero solo instalada
    if (esIOS() && !estaInstalada()) return 'ios-sin-instalar';
    return 'no-soportado';
  }
  if (esIOS() && !estaInstalada()) return 'ios-sin-instalar';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission === 'granted') return 'ya-activo';
  return 'disponible';
}

/* Convierte la clave de texto a bytes, como pide el navegador */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function registroSW() {
  return await navigator.serviceWorker.ready;
}

export async function estadoPush() {
  if (!soportado()) return 'no-soportado';
  const reg = await registroSW();
  const sub = await reg.pushManager.getSubscription();
  if (sub) return 'activo';
  if (Notification.permission === 'denied') return 'bloqueado';
  return 'inactivo';
}

export async function activarPush() {
  if (!soportado()) {
    toast('Este dispositivo no admite avisos. En iPhone, primero añade la app a la pantalla de inicio.');
    return false;
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast('No has dado permiso para los avisos.');
    return false;
  }
  const reg = await registroSW();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });
  const json = sub.toJSON();
  const { error } = await sb.rpc('guardar_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_ua: navigator.userAgent.slice(0, 200),
  });
  if (error) { toast('No se pudo activar: ' + error.message); return false; }
  toast('Avisos activados en este dispositivo');
  return true;
}

export async function desactivarPush() {
  const reg = await registroSW();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.rpc('borrar_push', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  toast('Avisos desactivados en este dispositivo');
  return true;
}

/* Monta el botón de un contenedor (gestor o empleado) */
export async function initPushUI(botonId) {
  const btn = $(botonId);
  if (!btn) return;

  async function refrescar() {
    const est = await estadoPush();
    btn.disabled = false;
    if (est === 'no-soportado') {
      btn.textContent = 'No disponible en este dispositivo';
      btn.disabled = true;
    } else if (est === 'bloqueado') {
      btn.textContent = 'Avisos bloqueados (revisa los permisos del navegador)';
      btn.disabled = true;
    } else if (est === 'activo') {
      btn.textContent = 'Desactivar avisos en este dispositivo';
      btn.dataset.estado = 'activo';
    } else {
      btn.textContent = 'Activar avisos en este dispositivo';
      btn.dataset.estado = 'inactivo';
    }
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (btn.dataset.estado === 'activo') await desactivarPush();
    else await activarPush();
    await refrescar();
  });

  await refrescar();
}
