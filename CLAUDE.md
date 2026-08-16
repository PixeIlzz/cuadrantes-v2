# StaffPoint v2 — Estado del proyecto

> Documento vivo. Se carga automáticamente en cada sesión de Claude Code.
> **Actualizar al cerrar cada tanda de trabajo**: versiones, migración SQL, módulos
> tocados y la lista de pendientes.

**Última actualización:** 2026-08-16 · v68 (versión única visible en pantalla)

---

## 1. Qué es

PWA multi-tenant de **gestión de turnos y fichaje para hostelería**.

Desarrollo en solitario (Fran, dueño del Asadero Las Brasas, Gran Canaria): la misma
persona despliega, prueba y da soporte.

**La app está en producción y en uso real por la plantilla.** Consecuencia directa
sobre cómo se trabaja:

- Toda función nueva nace detrás del flag `soy_probador()` y solo se abre al resto
  cuando está validada en uso real.
- Ningún cambio puede romper lo que ya funciona. Ante la duda, se aísla.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | JavaScript vanilla, módulos ES nativos. **Sin framework ni build.** |
| Backend | Supabase (Frankfurt): Postgres + RLS, Edge Functions, Realtime, pg_cron, pgcrypto |
| Hosting | GitHub Pages (repo `cuadrantes-v2`) → `staffpoint.app` vía Cloudflare/Porkbun |
| Email | Resend |
| Push | Edge Function propia con VAPID |
| PWA | Service worker red-primero, con `VERSION` en `sw.js` |

---

## 3. Estructura

```
index.html          Toda la interfaz (secciones ocultas por pestaña)
app.css             Estilos — ver aviso de la CAPA FINAL más abajo
sw.js               Service worker. VERSION + lista de archivos cacheados
manifest.json       Instalación PWA
icon-*.png          Iconos

js/app.js           Arranque, enrutado por pestañas, wiring general
js/auth.js          Sesión y ctx (business, role, workerId, esProbador)
js/supabase.js      Cliente Supabase
js/pwa.js           Registro del SW, aviso de versión nueva, versionSW()
js/version.js       APP_VERSION — fuente única de la versión

js/data/*.js        Acceso a datos — una función por operación
js/ui/*.js          Interfaz por módulo

edge/enviar-push/   Edge Function de push (VAPID)
```

### Regla de separación (estricta)

- `js/data/` **no toca el DOM**.
- `js/ui/` **no hace consultas directas** a Supabase: llama a `data/`.

### Módulos actuales

`data/`: `avisos`, `empleado`, `equipo`, `fichaje`, `invitaciones`, `kiosco`,
`migracion`, `notificaciones`, `semanas`, `solicitudes`, `tareas`

`ui/`: `ajustes`, `ajustes-empleado`, `avisos`, `confirmar`, `cuadrante`, `empleado`,
`equipo`, `exportar`, `fichaje`, `hoy`, `kiosco`, `mi-registro`, `migracion`,
`notificaciones`, `privacidad`, `programadas`, `push`, `push-bienvenida`,
`registro-arbol`, `solicitudes`, `tareas`, `tema`, `toast`, `version`

---

## 4. Modelo de datos (Supabase)

| Tabla | Contenido |
|---|---|
| `businesses` | Negocio. `config` (jsonb): `roles` (puestos), `days` (columnas del cuadrante: `id`, `label`, `night`, y opcionalmente `desde`/`hasta`), `fichaje` (margen, avisos, tz), `legal` (razón social, CIF) |
| `workers` | Trabajadores. `profile_id` puede ser null (gente que ficha sin app). `nif`, `pin_hash`, `active`, `sort_order` |
| `weeks` + `assignments` | Cuadrante. Las semanas publicadas congelan `config_snapshot`. Asignaciones = día × puesto → trabajador, con `is_all` para turnos de toda la plantilla |
| `vacations` | Periodos de vacaciones por trabajador |
| `time_entries` | Fichajes: `tipo` (entrada/salida), `momento` (lo pone el servidor), `origen` (empleado/auto/gestor/kiosco), `estimado`, `ip`, `kiosco_id` |
| `time_entry_audit` | Auditoría automática por trigger de todo cambio en fichajes |
| `kioscos` | Tablets emparejadas: `device_token`, `ips_permitidas` |
| `notifications` + `notification_prefs` | Avisos. Insertar una notificación dispara el push por trigger |

Migraciones SQL numeradas secuencialmente.

---

## 5. Módulos completados

### Cuadrante
Rejilla días × puestos con arrastrar y soltar. Puestos y columnas configurables,
columnas nocturnas. Publicación con programación horaria y visibilidad manual.
Snapshot de config por semana. Exportación a PNG e impresión. Tablón de avisos.
Tareas diarias.

### Equipo
Alta/baja de trabajadores, turnos por semana, vacaciones, invitaciones por código,
NIF por diálogo modal.

### Empleado
Su cuadrante, "hoy", mis turnos, próximos turnos, solicitudes (cambios, vacaciones),
notificaciones push configurables.

### Fichaje — el módulo más reciente, completo (en beta tras flag)

- **Kiosco sin GPS.** Una tablet del local se empareja mostrando un QR que el gestor
  escanea desde la app (cámara in-app con jsQR). Guarda un `device_token`; sin él no
  se puede fichar. Opcionalmente se restringe por IP. El empleado toca su nombre en
  una rejilla y mete su PIN (bcrypt, bloqueo de 5 min tras 5 fallos). La Edge Function
  `fichar-kiosco` (Verify JWT **desactivado**) valida token + PIN + IP y llama a la RPC.
- **Estado en vivo.** Contadores HH:MM:SS; verde si está trabajando, rojo si fichó
  tarde o excede horas. En kiosco, lista del gestor, detalle del empleado y vista del
  empleado.
- **Realtime** sobre `time_entries`: al fichar en el kiosco, las vistas se actualizan
  solas.
- **Horario por turno.** Cada columna del cuadrante lleva su horario (botón 🕒 en
  Ajustes → Días y columnas). `turno_previsto(negocio, worker, día)` resuelve el turno
  real de cada persona desde el cuadrante publicado, con respaldo al horario general
  del negocio. **Las vacaciones anulan el turno.**
- **Registro en árbol.** Año → Mes → Semana → Día, desplegable. Cada nivel muestra
  horas totales, saldo (vs. previsto) y retraso acumulado. Gestor: botones PDF y CSV
  en cada nivel. Empleado: solo visual.
- **Exportación legal.** PDF imprimible y CSV con razón social, CIF, nombre, NIF,
  entradas/salidas y totales.
- **Avisos push.** Recordatorio de entrada no fichada (solo a quien tiene turno ese
  día y no está de vacaciones) y de salida no fichada. Umbrales configurables en
  horas/minutos/segundos. Cron cada 5 min.
- **Jornada nocturna.** `dia_laboral()` atribuye los fichajes de madrugada al día
  anterior si ese día tenía turno que cruza medianoche (viernes 20:00 → sábado 01:00
  cuenta como viernes).

---

## 6. Decisiones y aprendizajes (no repetir errores)

**Zona horaria.** Todo cálculo de fechas se hace en `Atlantic/Canary` **en el
servidor**. Comparar cadenas en UTC provocó un bug real de medianoche.

**RPC de Postgres.** Devolver los errores **como datos JSONB**, nunca con
`raise exception`: la excepción revierte la transacción y se pierden efectos que
deben persistir, como el contador de intentos de PIN.

**Cambiar el tipo de retorno de una función** exige `DROP FUNCTION` antes;
`CREATE OR REPLACE` falla.

**Tramos que cruzan medianoche.** `hasta - desde` da negativo: hay que sumar 1440
minutos.

**CSS.** `app.css` termina en una **CAPA FINAL autoritativa de layout**. No añadir
capas nuevas encima — hay que **editar esa capa**. Acumular bloques al final ya
provocó que reglas se pisaran y componentes enteros se vieran rotos.

**Despliegue en GitHub.** Arrastrar y soltar **no reemplaza subcarpetas**: hay que
borrar `js/` entera y subir la nueva, o quedan archivos viejos mezclados (causa
habitual de errores de "export no encontrado").

**Versión única.** `APP_VERSION` en `js/version.js` y `VERSION` en `sw.js` son **el
mismo número** y se suben **juntos**. Se pintan en la cabecera (chip junto al nombre
del negocio) y al pie de ambos Ajustes. Si divergen, el pie avisa: significa que el
navegador sirve código cacheado. `pwa.js → versionSW()` pregunta la versión al SW por
`MessageChannel`; `sw.js` responde al mensaje `'VERSION'`.

**Checklist de despliegue:**
1. Subir el número en **`js/version.js`** y en **`sw.js`** (el mismo).
2. Añadir a `sw.js` los archivos JS nuevos.
3. Borrar `js/` en GitHub y subir la carpeta completa.

**Fiscalidad.** El registro de jornada es obligatorio en España: conservación 4 años
y entrega a inspección. Hay pendiente una reforma que exigirá formato digital con
inmutabilidad y trazabilidad — de ahí `time_entry_audit`.

---

## 7. Estado actual

| Elemento | Versión |
|---|---|
| App (`js/version.js` → `APP_VERSION`) | v68 |
| Service worker (`sw.js` → `VERSION`) | v68 |
| Migración SQL | 32 |

Todo el módulo de fichaje está tras `soy_probador()` mientras se prueba en real.

> En v68 se unificaron las dos versiones (la app iba por v67 y el SW por v50) en un
> único número visible en pantalla. Antes la versión de app no constaba en ningún
> archivo del repo.

---

## 8. Pendiente

1. **Sacar el fichaje de beta** — quitar el flag de probador y activarlo para toda la
   plantilla, una vez validado en uso real.
2. **Correcciones de fichaje por el empleado** — que pueda proponer una corrección
   (reusando el módulo de solicitudes) y que el gestor la apruebe, quedando en la
   auditoría.
3. **Limpieza** — eliminar el respaldo de "horario general del negocio" cuando todas
   las semanas publicadas lleven horas por columna.
4. **Comandero** (futuro, arquitectura ya diseñada) — comandas desde el móvil del
   camarero, pantallas de cocina por estación (parrilla, cocina) y vista de caja no
   fiscal. Se mantiene como **herramienta interna**, emitiendo los tickets por el TPV
   existente, para no entrar en las obligaciones de VeriFactu (enero 2027 sociedades,
   julio 2027 autónomos).
5. **Comercial** — piloto gratuito con un negocio vecino antes de invertir en la
   migración multicliente.

---

## 9. Cómo trabajar en este repo

- Soluciones **limpias, escalables y mantenibles**. No parches.
- Decir claramente si algo está mal planteado y **proponer alternativa**.
- Avisar de riesgos de **arquitectura, rendimiento o multi-tenancy antes** de
  implementar, no a mitad.
- Directo, sin relleno.
- Al entregar código: decir **exactamente qué cambiar, qué borrar y qué añadir**, y
  **comprobar que las funciones importadas existen realmente** en su módulo de origen.
- Respetar la separación `data/` ↔ `ui/`.
- Mantener este archivo actualizado.
