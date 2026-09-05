# FotoProy — Metadatos capturados por foto/video

> Referencia del producto: qué datos se registran por cada medio capturado,
> en qué momento, y dónde quedan almacenados (dispositivo / servidor).
> Estado: válido para la Fase 2 (M2). Se actualiza si cambia el modelo.

---

## Flujo de un medio (foto o video)

```
CAPTURA (móvil, offline-first)
  1. archivo (jpg/mp4)  → copiado a la app (solo dispositivo)
  2. metadatos          → tabla local `photos` (SQLite)
  3. cola               → `sync_queue` (pendiente)

SYNC (cuando hay red)
  4. storageKey (R2)    → asignado por la API (pre-signed PUT)
  5. metadatos          → POST /photos → tabla `photos` (PostgreSQL)
  6. estampa (foto)     → el servidor la QUEMA sobre la imagen (opcional)
  7. thumbnail JPEG     → el servidor lo genera (sharp)
```

---

## 1. Metadatos de captura (generados por el dispositivo)

Se guardan al instante en la BD local **antes** de sincronizar (append-only;
el registro se crea con su UUID de cliente y nunca se reescribe).

| Campo        | Origen                                   | Ejemplo                      | ¿Viaja al servidor? |
| ------------ | ---------------------------------------- | ---------------------------- | ------------------- |
| `id`         | UUID v4 del dispositivo                  | `9070b650-d168-48b1-…`       | Sí (clave)          |
| `projectId`  | Proyecto activo en la cámara             | `5864aaa5-85e0-…`            | Sí                  |
| `userId`     | Usuario de la sesión                     | `fd7749e3-d53b-…`            | Sí                  |
| `kind`       | `PHOTO` / `VIDEO`                        | `PHOTO`                      | Sí                  |
| `durationMs` | Solo videos (duración)                   | `12500`                      | Sí                  |
| `capturedAt` | Reloj del dispositivo (ISO UTC)          | `2026-09-05T13:20:01.123Z`   | Sí                  |
| `latitude`   | GPS satelital (opcional, puede ser null) | `-0.177234`                  | Sí                  |
| `longitude`  | GPS satelital (opcional)                 | `-78.489102`                 | Sí                  |
| `altitude`   | GPS (metros, opcional)                   | `2834`                       | Sí                  |
| `notes`      | Nota opcional del usuario                | `Muro norte, 3er piso`       | Sí                  |
| `localUri`   | Ruta del archivo en el dispositivo       | `file:///…/fotoproy/xxx.jpg` | **No**              |

> **GPS y offline:** el GPS es satelital — funciona sin internet. Si no hay
> señal al capturar, la foto se guarda con `null` y la estampa/ui lo indican.
> `capturedAt` usa el reloj del dispositivo: puede ir desfasado si el reloj
> está mal (no depende del servidor).

## 2. Estado de sincronización (solo dispositivo)

| Campo                        | Para qué                                           |
| ---------------------------- | -------------------------------------------------- |
| `photos.syncedAt`            | `null` = pendiente; fecha = el servidor confirmó   |
| `sync_queue.status`          | `PENDING` / `UPLOADING` / `FAILED`                 |
| `sync_queue.attempts`        | Intentos (backoff exponencial, máx. 6 automáticos) |
| `sync_queue.next_attempt_at` | Próximo reintento automático                       |
| `sync_queue.last_error`      | Último error (diagnóstico/UI)                      |

## 3. Metadatos del servidor (se agregan al sincronizar)

| Campo                       | Detalle                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `storageKey`                | Clave del objeto: `photos/{orgId}/{id}.jpg` (o `.mp4` videos)                        |
| `thumbnailStorageKey`       | Thumbnail JPEG ~480px: `thumbs/{orgId}/{id}.jpg` (solo fotos)                        |
| `syncedAt`                  | Sello del **servidor** (hora real de recepción)                                      |
| `imageUrl` / `thumbnailUrl` | URLs firmadas (expiran ~1 h; se regeneran al listar)                                 |
| Estampa quemada (foto)      | Texto (proyecto, fecha UTC, GPS, autor) **sobre** la imagen final (opcional, ver §5) |

## 4. Qué NO se registra (deliberado)

- **EXIF técnico** del archivo (marca/modelo de cámara, ISO, orientación, etc.): no se lee ni se propaga.
- **Autor con nombre** en las respuestas de la API (solo `userId`). Se agrega cuando la vista web/gallery lo necesite (F3+).
- **Hora local con zona horaria** de la obra (solo ISO UTC del dispositivo).
- **Edición posterior**: fotos/pines/comentarios son _append-only_ — tras sincronizar, la nota no se puede cambiar (solo antes de subir).

## 5. Estampa visual (opcional, controlada por el servidor)

El servidor puede **quemar una banda de texto sobre la imagen final** como
evidencia visual (foto): código de proyecto · fecha UTC de `capturedAt` ·
GPS (lat/lng/altitud) · autor · nota. Se activa con la env de la API:

```
STORAGE_STAMP_PHOTOS=true   # false = el original se guarda limpio
```

Notas:

- Se aplica al original almacenado (misma `storageKey`) al confirmar la foto; el thumbnail se genera sobre la imagen ya estampada.
- El preview/archivo local del celular muestra la imagen **sin** estampa hasta que sincroniza (la estampa se hace en el servidor para que sea consistente para todo el equipo).
- Videos no se estampan (sin decodificador en el procesador).
- Decisión de producto: si el original “limpio” es requisito de algún cliente, se agrega un flag por proyecto/org (backlog).
