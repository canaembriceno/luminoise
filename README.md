# Luminoise · Mobile

Versión móvil de Luminoise. Sube una imagen, se le aplica el filtro base
**lumini** y el resultado entra al motor óptico original de Luminoise
(fuente → espectro → haces → propagación → exposición), con audio generativo y
regeneración automática de parámetros activos por defecto.

## Ejecutar

Requiere Python 3 (solo para servir por HTTP; los módulos ES no cargan desde
`file://`).

```bat
abrir.bat
```

Abre `http://127.0.0.1:8766/`. También sirve cualquier servidor estático:

```bash
python -m http.server 8766
```

## Controles

| Botón | Acción |
|-------|--------|
| **Subir** | Carga una imagen (png/jpeg/webp/gif, máx 10 MB). Se le aplica lumini y se reconstruye el motor. |
| **Pausa / Play** | Pausa a la vez la propagación de haces, el audio y la regeneración automática. Reanudar reactiva los tres. Arranca activo. |
| **Arcade / Anterior** | Cambia entre las dos formas de audio. |
| **Secuencia** | Salta a la siguiente secuencia (cambia de modo + sistema de parámetros aleatorios al instante). |
| **PNG** | Descarga el lienzo 960×720 como imagen PNG. |

## Cómo funciona

- Al cargar se usa `assets/photon.png` como imagen de referencia y se aplica
  `paintLumini` una sola vez (base estática).
- Ese canvas alimenta el motor real: `buildSpectrum → extractBeams →
  createOptics → bucle(propagate + expose)`.
- Modos reales: `continuous`, `glass`, `diffraction`, `grain`, con halos,
  streaks y sombras.
- Cada 333 s el motor randomiza parámetros (density, dispersion, gridW, kColors, sat, focus, step, halos, streaks, sombras, seed) con los rangos originales del Luminoise, y cada 33 s cambia solo la `seed` y reconstruye los haces. El modo (`continuous`, `glass`, `diffraction`, `grain`) solo cambia cuando pulsas **Secuencia**; el auto nunca lo altera.
- El audio mapea la paleta del espectro a notas (Web Audio API).
- Los navegadores móviles bloquean el audio hasta el primer toque: el primer
  toque en pantalla lo desbloquea.

## Secuencias

`Continuous · Glass · Diffraction · Grain · Dense · Sparse · Chaos · Mono`

Cada una fija un modo de exposición y un rango de aleatorización distinto.

## Seguridad

Proyecto 100 % del lado del cliente: **el JavaScript es público por definición**
al publicarse en GitHub / GitHub Pages. No hay secretos ni claves en el código.

- **CSP** estricta por cabecera HTTP (`servidor.py`) y por `<meta>`
  (`index.html`): bloquea scripts inline, eval, orígenes externos y frames.
- **Validación de subida**: solo `image/*`, máx 10 MB, `revokeObjectURL`.
- **Sin `eval` / `new Function`**; `innerHTML` solo con números calculados.
- **Cabeceras**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP.
- **`.gitignore`** excluye `.env*`, claves, certificados y credenciales.

GitHub Pages no permite cabeceras HTTP personalizadas; ahí la CSP efectiva es
la del `<meta>`. Para cabeceras reales usa Netlify, Vercel, Cloudflare Pages o
un servidor propio.

## Estructura

```
luminoise-mobile/
├── index.html
├── servidor.py          # servidor local con cabeceras de seguridad
├── abrir.bat
├── styles/
│   ├── sisifo/          # identidad SISIFO original
│   ├── fonts/           # Playfair Display + Courier Prime
│   └── mobile.css       # layout móvil
├── src/
│   ├── app-mobile.js    # orquestación: pipeline, auto, controles
│   ├── source.js        # buildSpectrum (motor original)
│   ├── beams.js         # extractBeams
│   ├── optics.js        # createOptics / propagate
│   ├── expose.js        # modos de exposición, halos, streaks, sombras
│   ├── audio.js         # motor de audio generativo
│   ├── lumini.js        # filtro base lumini
│   └── color.js         # utilidades de color
└── assets/
    ├── photon.png       # imagen de referencia
    └── demo.jpg
```
