# Librerías de terceros, alojadas aquí a propósito

Antes se pedían a un CDN en cada carga. Eso significaba que quien
comprometiera jsdelivr o esm.sh ejecutaba código con la sesión de todos los
usuarios de la app, y además la PWA no arrancaba sin conexión: el service
worker servía el HTML, pero el `import` al CDN fallaba.

## Qué hay y de dónde sale

| Archivo | Origen | Por qué esa variante |
|---|---|---|
| `supabase-js-2.45.4.umd.js` | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js` | **UMD, no ESM.** El `+esm` de Supabase son 6 KB de fachada que importan seis subpaquetes más del CDN: alojarlo no serviría de nada. El UMD viene entero (~110 KB) y deja `window.supabase`. |
| `jsqr-1.4.0.js` | `cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm` | Ese sí es autocontenido (~131 KB) y se importa como módulo normal. |
| `qrcode-1.5.4.js` | `cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm` | **Editado a mano**: su import de dijkstrajs apuntaba a `/npm/dijkstrajs@1.0.3/+esm` y se cambió a `./dijkstrajs-1.0.3.js`. Sin eso seguiría bajándose esa pieza del CDN. |
| `dijkstrajs-1.0.3.js` | `cdn.jsdelivr.net/npm/dijkstrajs@1.0.3/+esm` | Dependencia de qrcode, 1,8 KB, autocontenida. |

**Al actualizar `qrcode` hay que repetir la edición del import**, o volverá a
tirar del CDN sin avisar.

No se usa **esm.sh**: devuelve 125 bytes que solo reexportan desde otra URL
suya, así que alojarlo sería un placebo.

## Cómo actualizarlos

Descargar la versión nueva con el mismo nombre-versión, y **comprobar que no
quedan importaciones externas** antes de darla por buena:

    grep -oE "(from|import)[ (]*[\"'][^\"']*[\"']" js/vendor/*.js | grep -E "https?://|/npm/"

No debe imprimir nada. Si imprime algo, ese archivo sigue tirando del CDN.

Al cambiar de versión hay que tocar tres sitios: el nombre en `index.html`
(Supabase), el `import` de `js/ui/kiosco.js` (jsQR) y la lista `ARCHIVOS` de
`sw.js`.
