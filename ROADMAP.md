# FotoProy — ROADMAP de Implementación

> **Fuente:** [docs/SPEC.md](docs/SPEC.md) v2.1 (decisiones de producto/stack cerradas).
> **Objetivo:** planificar **todo** lo que hay que implementar para llegar al MVP (móvil iOS + Android) y ordenar el backlog post-MVP.
> **Formato:** cada tarea tiene un ID (`F1.3`), estimación, dependencias y su "Definición de Terminado" (DoD). El orden propuesto es el del documento; se puede ejecutar fase por fase con un agente de código o manualmente.
> **Esquema de BD:** el DDL de la SPEC §5 es informativo; la fuente de verdad es el esquema Prisma (`packages/database`) que se define en F0.

---

## Leyenda y estado

- [ ] Pendiente · [x] Completado · 🔒 Bloqueada por otra tarea · ⚠️ Requiere decisión/validación
- Estimación: **días** de trabajo efectivo de 1 persona (referencial, no compromiso).
- Cada fase termina en un **Hito (M0–M4)** demostrable.

### Hitos

| Hito | Fase | Demo al terminar                                                                                                                            |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| M0   | F0   | Repo + workspace compilan; API `/health` responde; migración aplica en Postgres local.                                                      |
| M1   | F1   | Registro → login → crear proyecto → **tomar una foto con estampa (fecha/hora/GPS)** que queda en la galería local.                          |
| M2   | F2   | Con la app **sin red**: capturar foto → aparece como "pendiente" → al reconectar **se sincroniza sola** y se ve en el servidor (R2 + DB).   |
| M3   | F3   | Subir plano/imagen de obra → **tocar un punto y anclar una foto** → el pin persiste sincronizado; comentar una foto.                        |
| M4   | F4   | **Compartir enlace de solo lectura** (expira) → se abre en el navegador y muestra el proyecto; app distribuida en TestFlight/Play Internal. |

---

## Convenciones técnicas (aplicar desde el inicio)

- Monorepo **pnpm workspaces**, Node LTS (22+), TypeScript `strict`.
- Paquetes internos: `@fotoproy/shared`, `@fotoproy/database`; apps: `@fotoproy/mobile`, `@fotoproy/api`.
- **Regla de oro:** toda entidad creada en el móvil nace con **UUID v4 de cliente**; nunca se edita (append-only).
- Fechas en **ISO 8601 UTC**; la UI muestra hora local. `captured_at` lo genera el cliente (puede ir desfasado offline) y el servidor sella su propio `created_at`/`synced_at`.
- Validaciones de entrada con **zod** en `@fotoproy/shared`, reutilizadas por API y app.
- **Idioma (regla de codificación):** todo el código, comentarios, logs, mensajes de la API, esquema de BD (tablas/columnas/enums) y la estructura de carpetas/archivos en **inglés**. La documentación de `docs/` y los textos visibles de la UI (español, público LATAM) se manejan en capas separadas (i18n en F1+).
- En la API: todo query filtra por `organization_id` (org-scoping) — es requisito de seguridad, no opcional.
- Secretos solo en variables de entorno (`.env`, nunca en git).

---

## Fase 0 — Fundación del monorepo (≈2–3 días) ✅ Completada (M0) — 2026-09-02

**DoD global F0:** ✅ `pnpm install && pnpm -r build` funciona · ✅ `apps/api` responde `/health` (`{"status":"ok","db":"up"}`) · ✅ migración inicial aplicada en Postgres local con PostGIS.

- [x] **F0.1** `git init` + `.gitignore` + README/ROADMAP. Rama `main`.
- [x] **F0.2** Raíz pnpm: `package.json` (workspaces), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json`, ESLint (flat, 0 warnings) + Prettier, `.nvmrc` (26).
- [x] **F0.3** `packages/shared`: zod schemas del dominio (auth, proyectos, planos, fotos, pines, comentarios, shares, paginación) + tipos derivados.
- [x] **F0.4** `packages/database`: **schema.prisma v1** con las 7 entidades MVP + `enum Role/PlanKind`, primera migración aplicada. Decisión cerrada: **lat/lng como Decimal** (no `geometry`); PostGIS habilitado en la imagen local para uso futuro.
- [x] **F0.5** `docker-compose.yml`: `postgis/postgis:16-3.5` + volumen. ⚠️ Puerto host **55432** (5432/5433 ocupados por otros servicios de la máquina).
- [x] **F0.6** `apps/api` (NestJS **12**, ESM): bootstrap, ConfigModule por env, PrismaService, `GET /health` (chequea DB), CORS + Helmet, ValidationPipe global. ⚠️ Corre en puerto **4100** (el 3000 lo usa otro proyecto local).

---

## Fase 1 — Fundación: auth, proyectos, cámara y BD local (semanas 1–3)

**DoD global F1 = M1.**

> ✅ **Fase 1 COMPLETA — hito M1 logrado (2026-09-04)**: backend (auth/roles/miembros/projects) verificado por curl; móvil probado en dispositivo (captura ráfaga, estampa GPS, zoom pinch, linterna, aspecto, video con audio, galería local). Pendiente: **Fase 2** (R2 + sync engine).

### Backend (API)

- [x] **F1.1** Módulo **auth**: `POST /auth/register` (crea `organization` + primer usuario `ADMIN`), `POST /auth/login`, `GET /auth/me`. Hash con **bcryptjs** (sin binarios nativos). JWT access 7d. Implementado en `apps/api/src/auth` + guards globales.
- [x] **F1.2** **Roles y miembros**: guard global + decoradores `@Roles`/`@Public`/`@CurrentUser`; `POST /users` (ADMIN crea miembros con contraseña temporal) y `GET /users` (ADMIN/SUPERVISOR).
- [x] **F1.3** Módulo **projects** (CRUD + DELETE): `UNIQUE(organizationId, code)` (409); org-scoping estricto (404 cross-org); ADMIN/SUPERVISOR escriben, TECHNICIAN lee (403); validación zod con los schemas de `@fotoproy/shared` vía `ZodValidationPipe`.

### Móvil (Expo)

> ✅ **F1.4–F1.6 completado (2026-09-03)**: `apps/mobile` con Expo SDK 57 + expo-router; sesión en `expo-secure-store`; cliente HTTP con `EXPO_PUBLIC_API_URL` (`.env`); pantallas login/registro, lista de proyectos, detalle y nuevo proyecto (UI en español); **BD local SQLite (expo-sqlite + drizzle-orm) con espejo de entidades + `sync_queue`**. Validado: typecheck 0 y `expo export` compila el bundle Android. _Nota: la app usa tipos locales espejo de `@fotoproy/shared`; el consumo directo del paquete shared desde Metro se formalizará después (F2)._

- [x] **F1.4** Base app: Expo SDK 57 + TypeScript + expo-router (grupos `(auth)`/`(app)` con guards por sesión); navegación Login/Registro → Lista proyectos → Detalle (→ cámara/galería en F1.7+).
- [x] **F1.5** Sesión: token + usuario en `expo-secure-store` (`lib/auth.tsx`); cliente HTTP (`lib/api.ts`) con base URL por env; estado global por contexto; pantallas login/registro con errores legibles; logout.
- [x] **F1.6** **BD local** (`expo-sqlite` + `drizzle-orm`): `lib/db/schema.ts` (tablas espejo photos/photo_pins/photo_comments/project_plans/cached_projects + `sync_queue`), migraciones versionadas por `PRAGMA user_version` (`lib/db/migrations.ts`, v1) y repos (`lib/db/repos.ts`: photos local-first, enqueue/list/update `sync_queue`, contador pendientes). Inicialización en `app/_layout.tsx`.
- [x] **F1.7** **Cámara** (`expo-camera`): `app/(app)/capture.tsx` — preview pantalla completa, **flash 3 modos (OFF/AUTO/ON)**, **zoom por pellizco (pinch 2 dedos, PanResponder) + botones ＋/－**, permisos con estado denegado + abrir ajustes; **modo ráfaga** (guardado automático, cámara activa, toast por foto); sonido de obturador 🔊/🔇. (Enfoque al tocar: pendiente de soporte de la API de expo-camera.)
- [ ] **F1.8** **GPS/estampa**: `expo-location` (permiso opcional — si se niega, la foto se toma sin GPS, no bloquear). Capturar lat/lng/altitud al disparar. Overlay en vivo: fecha/hora, proyecto, usuario, coords si existen. _(No quemar la estampa en la imagen en MVP; es metadato + overlay. Revisar con producto.)_
- [x] **F1.9** **Captura local-first** (foto y video): disparar/grabar → UUID cliente → archivo copiado a `documentDirectory/fotoproy/` (`lib/media.ts`, jpg/mp4) → `createLocalPhoto` en SQLite **siempre** → `enqueueSync('photo', …)` con `kind`/`durationMs`. Thumbnails locales de video en la galería (F1.10).
- [x] **F1.10** **Galería local** (`app/(app)/gallery.tsx` + `media-viewer.tsx`): cuadrícula de fotos y videos del proyecto desde SQLite (se refresca al enfocar), thumbnails de video con `expo-video-thumbnails`, badge ▶ + duración; visor a pantalla completa con reproductor `expo-video` (controles nativos) y metadatos (fecha, GPS, duración). Acceso desde el detalle del proyecto con contador de medios locales.

---

## Fase 2 — Backend de archivos + motor de sync + despliegue (semanas 4–6)

**DoD global F2 = M2.**

> ✅ **Backend F2.1–F2.3 completado (2026-09-05)**: servicio de storage S3-compatible (mismo código para Cloudflare R2 en prod; **MinIO local** en docker-compose para dev, puertos 9000/9001) con pre-signed PUT/GET; migración `photos` → `storageKey`/`thumbnailStorageKey`; endpoints `POST /photos/presign`, `POST /photos` (idempotente por UUID cliente, valida clave esperada y org-scoping), `GET /photos?projectId` y `GET /photos/:id` (URLs firmadas cortas en la respuesta); thumbnails **WebP con sharp** (inline async + sweep cada 5 min, sin Redis — decisión F2.3 para el volumen MVP). Verificado E2E por script: subida directa a MinIO, thumbnail generado, idempotencia y 404 cross-org.

### Backend / infraestructura

- [x] **F2.1** **Storage R2**: bucket(s) + credenciales; servicio que emite **pre-signed PUT URLs** (objeto original) y URLs de lectura; configuración de CORS del bucket. (Dev: MinIO `docker compose up -d minio`; envs `STORAGE_*` en `apps/api/.env(.example)`. Para R2 real: endpoint/cuenta + credenciales + `STORAGE_FORCE_PATH_STYLE=false`.)
- [x] **F2.2** **Endpoint de fotos**: `POST /photos` (recibe metadatos + `storage_key` ya subido por el cliente; valida pertenencia a proyecto de la org); `GET /photos?projectId` (lista paginada con thumbnail); `GET /photos/:id`. Idempotencia por `id` de cliente (evita duplicados en reintentos).
- [x] **F2.3** **Procesado de imágenes** (job): al confirmarse una foto, generar **thumbnail WebP** con `sharp` y guardar en R2 (path `/thumbs/…`). ⚠️ Decisión: **inline asíncrono + sweep periódico** (sin BullMQ/Redis) — volumen MVP; migrar a cola si crece.
- [ ] **F2.4** **Despliegue básico**: API contenedorizada + Postgres gestionado (Neon/RDS/VPS con docker) + bucket R2 + dominio/SSL + envs de producción + despliegue automatizado mínimo (script o CI). Entornos dev/staging/prod.

### Móvil — motor de sincronización

> ✅ **F2.5–F2.8 implementado (2026-09-05)**: motor de sync offline-first (NetInfo + cola FIFO SQLite con backoff exponencial y reintento automático, estado superviviente a reinicios), subida directa del archivo local a storage vía pre-signed URL (sin base64 en memoria) → `POST /photos` idempotente → `DONE`; 401 pausa el motor con aviso; 409 se confirma por `GET /photos/:id` (cero duplicados). UI: barra global de pendientes + “Sincronizar ahora”, badges por foto (pendiente/subiendo/error) en la galería, y caché de la galería en línea del equipo (thumbnails descargados, visor con URL firmada fresca). _Pendiente: validación en dispositivo real del DoD M2 (modo avión → reconexión) y F2.4 (despliegue, requiere dominio/credenciales R2 reales)._

- [x] **F2.5** **Detector de conectividad** (NetInfo/expo-network) + procesador de cola: procesa `sync_queue` en orden FIFO cuando hay red; al fallar, **backoff exponencial** y reintento automático.
- [x] **F2.6** **Sync de fotos**: pedir pre-signed URL → subir archivo a R2 (PUT con el URI local, sin base64 gigante) → `POST /photos` con metadatos → marcar `DONE`. Reintentos idempotentes (mismo UUID cliente).
- [x] **F2.7** **UI de estado**: indicador global de pendientes (ej. “3 fotos por subir”), acción “sincronizar ahora”, estados por foto (local → subiendo → en línea / error).
- [x] **F2.8** Descarga de metadatos/thumbnails para galería en línea (caché local de lo ya visto).

**DoD F2:** con el móvil en modo avión: capturar N fotos → todas aparecen "pendientes" → al quitar modo avión se suben solas en orden y el servidor las lista sin duplicados.

---

## Fase 3 — Planos, anclaje de pines, galería y comentarios (semanas 7–9) ✅ Completada (M3) — 2026-09-10

**DoD global F3 = M3.** ✅ Cumplido: subir plano-imagen → tocar un punto y anclar una foto → el pin persiste sincronizado → comentar una foto; todo validado en dispositivo, incluidos comentarios y pines creados **sin conexión** que suben solos al reconectar.

> ✅ **Fase 3 CERRADA (M3) — 2026-09-10**: F3.1–F3.6 implementados y verificados (API por curl: 403/404/409/400; móvil en dispositivo: planos-imagen lista/subida/visor con zoom, toque→(x%,y%) y anclaje de pines, pines sobre el plano, grilla de fotos del plano, filtros de galería por autor/fecha/plano). **Comentarios y anclaje/comentarios offline validados en dispositivo el 2026-09-10**, junto con el endurecimiento del motor de sync (v1.24). Tag: `v0.2.0-m3`. Pendientes globales: **visor de PDF** (spike F3.0, opcional para el MVP — planos-imagen cubren M3), **F2.4 despliegue** (credenciales R2 + dominio) y **Fase 4**.

- [x] **F3.0** **Spike técnico** — Decisión (2026-09-05): **WebView + pdf.js para PDF multipágina** (funciona en Expo Go; `react-native-pdf` exige dev client/EAS → se re-evalúa en F4). El PoC de toque→(x%,y%) se entregó dentro del visor F3.2/F3.3 y funciona con planos-imagen; el visor PDF queda **opcional post-MVP**.
- [x] **F3.1** **Plans API**: `POST /plans/presign` + `POST /plans` (idempotente por UUID cliente, 409 si cambia la clave; roles ADMIN/SUPERVISOR; thumbnail JPEG async para IMAGE) y `GET /plans?projectId` / `GET /plans/:id` con URLs firmadas. **Reemplazo** = se crea un plan nuevo (los pins viejos siguen apuntando a su plan). Migración `plans_storage_keys` (storageKey/thumbnailStorageKey).
- [x] **F3.2** **Plans móvil**: lista de planos del proyecto (miniaturas firmadas; subir solo ADMIN/SUPERVISOR vía botón de cabecera), **subida con barra de progreso** (expo-image-picker + `createUploadTask` PUT) y **visor a pantalla completa** con zoom pellizco/doble-toque, arrastre y **toque→(x%,y%)** (anclaje en F3.3). Pendiente (opcional): PDF multipágina (spike F3.0).
- [x] **F3.3** **Pines API + móvil**: API ✅ + móvil ✅ — en el visor del plano, **tocar un punto** calcula (x%, y%) (con zoom/pan incluidos) → hoja con **"usar foto existente"** (grilla de fotos locales del proyecto) o **"tomar foto ahora"** (abre la cámara) → se crea el pin **local-first y se encola** (sube solo al reconectar; el motor de sync ya procesa `pin`, F3.6 parcial) con intento online inmediato; los pines se dibujan sobre el plano (sincronizados rojos, pendientes ámbar) y **tocar un pin abre la foto**.
- [x] **F3.4** **Navegación desde pins**: tocar un pin abre la foto ✅ · ver todas las fotos de un plan ✅ (pantalla plan-photos, grilla de pines sincronizados) · **filtros de galería** por autor (mías/equipo), fecha (7/30 días) y **plano** (ids de pines locales + servidor).
- [x] **F3.5** **Comentarios**: API ✅ + UI móvil ✅ — hoja de comentarios en el visor de la foto (lista con autor + hora relativa; los pendientes se marcan ⏫ “por subir”), compositor que funciona **offline** (local-first + cola; intento online inmediato) y merge servidor↔local por id.
- [x] **F3.6** **Sync extendido**: pins ✅ y **comentarios** ✅ creados offline se sincronizan con la misma cola (F2.5); conflictos no aplican (append-only; 409 = idempotencia = éxito).

---

## Fase 4 — Compartir, pulido, QA y distribución (semanas 10–12)

**DoD global F4 = M4.**

- [x] **F4.1** **Enlaces de solo lectura** ✅ (2026-09-11, rama `feat/f4.1-share-links`): modelo `Share` (migración `add_shares`) con **token aleatorio de 256 bits guardado hasheado** (SHA-256) y expiración 1–365 días (presets 7/30/90/365, default 30); endpoints privados `POST /shares` (ADMIN/SUPERVISOR, devuelve la URL **una sola vez**), `GET /shares?projectId`, `DELETE /shares/:id` (revocar, idempotente) y endpoint **público sin auth** `GET /s/:token` que devuelve el proyecto + fotos con URLs firmadas frescas (404 token inexistente, 410 con código estable `SHARE_EXPIRED`/`SHARE_REVOKED`; `Cache-Control: no-store`; contador de accesos). Org-scoping implícito por token + `PUBLIC_BASE_URL` (fallback al request). Móvil: pantalla **Compartir avance** (solo ADMIN/SUPERVISOR) con presets de validez, hoja nativa para compartir el enlace y revocación con confirmación. Spec y decisiones: [docs/shares.md](docs/shares.md). Verificado E2E por curl (29/29: 200/404/410/403, aislamiento cross-org, token nunca en BD).
- [x] **F4.2** **Vista web mínima** ✅ (2026-09-11, misma rama `feat/f4.1-share-links`): HTML server-rendered por la API sobre el mismo `GET /s/:token` (negociación por `Accept`: navegador → página, cliente API → JSON): **grilla de thumbnails** con la estampa ya quemada, cabecera con organización/proyecto/nº de fotos/vencimiento, descripción del proyecto, **página individual de foto** (`GET /s/:token/p/:photoId` con fecha, autor, GPS y nota) y **páginas de error** claras para enlace vencido/revocado/inexistente. Sin SPA ni build, HTML + CSS en línea, sin JavaScript, datos escapados, enlaces absolutos (`PUBLIC_BASE_URL` o el host del request), `no-store`. **Los medios se sirven por proxy de la API** (`GET /s/:token/media/:photoId?size=thumb|full`, streaming): el HTML no apunta al bucket — Chrome ascendía `http://IP:9000` a HTTPS y las miniaturas quedaban en gris — y el host de storage deja de exponerse. Verificado en navegador (39/39 miniaturas cargadas) + `pnpm smoke:shares` (41 checks).
- [ ] **F4.3** **Pulido UX/offline**: estados vacíos, errores legibles, reintento manual, consistencia del indicador de pendientes, manejo de permisos de cámara/ubicación negados, rendimiento de listas (FlatList + thumbnails).
- [ ] **F4.4** **QA**: matriz manual iOS + Android (offline real, permiso denegado, plano PDF multipágina, subida de fotos grandes, reintentos, compartir); **E2E mínimo** del flujo feliz (Maestro/Detox); arreglo de bugs; prueba de org-scoping (usuario A no ve datos de B).
- [ ] **F4.5** **Seguridad/robustez**: rate limiting, validación estricta zod en todos los endpoints, límite de tamaño de subida, borrado de metadatos EXIF antes de publicar, revisión de secrets.
- [ ] **F4.6** **Distribución**: EAS Build (dev client para features nativas tipo PDF), **EAS Update (OTA)**; TestFlight (iOS) + Play Console Internal Testing (Android); config de versionado (build number + versión de esquema local).
- [ ] **F4.7** **Observabilidad mínima** (opcional pero recomendado): Sentry (crash/errores) + eventos de analytics sin PII (fotos subidas, sync fallidos, shares creados).

### ✅ Criterios de lanzamiento del MVP (release checklist)

- [ ] Registro → login → crear proyecto → capturar foto con estampa (con y sin GPS).
- [ ] Captura offline → sync automático al reconectar → cero duplicados.
- [ ] Subir plano (imagen y PDF multipágina) → anclar foto → abrir desde pin.
- [ ] Comentarios en fotos (online y offline).
- [ ] Enlace de solo lectura con expiración → abre en navegador.
- [ ] 3 roles funcionando; org-scoping verificado; permisos denegados manejados.
- [ ] Build iOS y Android instalables (TestFlight / Play Internal) + OTA configurado.

---

## Backlog post-MVP (fase 2+) — implementar según demanda/prioridad de negocio

Orden sugerido (P0 = primero cuando se valide en campo):

| ID    | Ítem (de SPEC §4.2)                                                                     | Prioridad | Notas                                                                                           |
| ----- | --------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| P2.1  | **Web de gestión completa** (ver/organizar/comentar desde el navegador)                 | P0        | Base: F4.2; evolucionar a app React (react-native-web o React web) reusando `@fotoproy/shared`. |
| P2.2  | **Exportación de reporte PDF** (avance por proyecto/plano)                              | P0        | Headless Chromium/WeasyPrint en API; elegir plantilla.                                          |
| P2.3  | **Mapas por tiles en vivo + geofencing** (Google/MapLibre)                              | P1        | Reemplaza/convive con planos-imagen; `photos.location_geom` PostGIS cobra sentido aquí.         |
| P2.4  | **IA: OCR de placas/medidores + nota de voz → resumen técnico**                         | P1        | Pipeline Python/LLM + cola; campos `ai_*` llegan con migración (SPEC §5 original).              |
| P2.5  | **Login social (Google/Apple)** + **notificaciones push**                               | P1        | —                                                                                               |
| P2.6  | **Anotación vectorial sobre fotos** (flechas, círculos, texto)                          | P1        | Editor canvas; guardar como JSONB por versión de imagen.                                        |
| P2.7  | **Facturación SRI + pasarelas locales** (Payphone/Datafast) y modelos de plan (§7 SPEC) | P2        | Requiere decisión de negocio de precios primero.                                                |
| P2.8  | **API pública + integraciones** (n8n/Make/Zapier, Google Drive)                         | P2        | API keys por organización; webhooks.                                                            |
| P2.9  | **Capa eléctrica optativa** (fases R/S/T, unifilares, simbología)                       | P3        | Verticalización; solo si hay demanda del gremio.                                                |
| P2.10 | Permisos granulares por proyecto/plano; versionado fino de planos                       | P2        | —                                                                                               |

### No-hacer por ahora (non-goals)

- Video, timelapse, fotos 360° / realidad aumentada.
- Chat en tiempo real / mensajería interna.
- App de escritorio nativa.
- Multimoneda/pagos internacionales (foco LATAM/Ecuador).

---

## Riesgos técnicos y mitigaciones

| Riesgo                                                                  | Impacto                    | Mitigación                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Coordenadas de toque en PDF** imprecisas (escalado página ≠ pantalla) | Alto (feature estrella M3) | Spike F3.0 temprano; validar en dispositivo real; fallback: planos-imagen en MVP.                                        |
| Librerías nativas (PDF, mapas) rompen el flujo "solo Expo Go"           | Medio                      | Trabajar con **dev client + EAS build** desde F1; documentar en README del equipo.                                       |
| Reloj del dispositivo desfasado offline → orden incorrecto de fotos     | Medio                      | Ordenar por `captured_at` con `created_at` servidor como desempate; sello del servidor.                                  |
| Duplicados por reintentos de sync                                       | Medio                      | Idempotencia por UUID cliente (F2.2/F2.6); probar en QA con cortes de red forzados.                                      |
| Fuga de datos entre organizaciones (org-scoping incompleto)             | **Crítico**                | Filtrar `organization_id` en cada query + pruebas dedicadas (F4.4).                                                      |
| PostGIS en Postgres gestionado (Neon/RDS)                               | Bajo                       | Usar `postgis/postgis` en local; si el proveedor no soporta PostGIS, lat/lng numérica basta para el MVP (decisión F0.4). |
| Migraciones SQLite en la app ya distribuida                             | Medio                      | Versionar esquema local + migraciones controladas (F1.6); probar upgrade real en TestFlight.                             |
| Subida de archivos grandes con red mala                                 | Medio                      | WebP en origen, reintentos con backoff, indicador claro; límite de tamaño (F4.5).                                        |

---

## Registro de cambios

- **v1.27 (2026-09-11):** fix de la vista web de F4.2 — las miniaturas no cargaban (grilla en gris): Chrome asciende los subrecursos `http://IP:9000` del bucket a **HTTPS** y MinIO local es HTTP puro. Ahora la vista pública **proxea los medios por la API** (`GET /s/:token/media/:photoId?size=thumb|full`, streaming sin buffer, caché privada corta) y el HTML ya no apunta al host de storage; de paso el bucket deja de exponerse al cliente. El JSON de la API sigue entregando URLs firmadas. `pnpm smoke:shares` sube a 41 comprobaciones; verificado en navegador con 39/39 miniaturas cargadas.
- **v1.26 (2026-09-11):** **F4.2** — vista web mínima de los enlaces: el mismo `GET /s/:token` ahora negocia contenido (navegador → HTML, API → JSON). Grilla de thumbnails con la estampa de evidencia, cabecera con organización/proyecto/nº de fotos/vencimiento, página individual de foto (`/s/:token/p/:photoId`) con fecha, autor, GPS y nota, y páginas de error legibles para enlace vencido/revocado/inexistente. HTML + CSS en línea sin SPA ni JavaScript, contenido escapado, enlaces absolutos, `no-store` y medios solo por URLs firmadas. `pnpm smoke:shares` sube a **39 comprobaciones** (incluye HTML y páginas de error). Pendiente de F4.2 por decisión de MVP: planos/pines y comentarios en la vista web.
- **v1.25 (2026-09-11):** **F4.1** — enlaces de solo lectura implementados (backend + móvil, rama `feat/f4.1-share-links`): modelo `Share` con token de 256 bits **hasheado** (SHA-256) y expiración configurable (presets 7/30/90/365 días, default 30); `POST /shares` (ADMIN/SUPERVISOR; la URL se muestra una única vez), `GET /shares?projectId`, `DELETE /shares/:id` (revocar, idempotente) y público `GET /s/:token` con proyecto + fotos (URLs firmadas frescas, contador de accesos, 404/410 con códigos estables, `no-store`). Móvil: pantalla **Compartir avance** con presets, compartir por la hoja del sistema y revocar. Spec en `docs/shares.md`. Verificación E2E por curl: 29/29 (403 TECHNICIAN, 404 cross-org, 410 vencido/revocado, token nunca persistido en claro). Siguiente: F4.2 vista web mínima.
- **v1.24 (2026-09-10):** cierre de **M3** + endurecimiento del motor de sync tras prueba en dispositivo (tag `v0.2.0-m3`): los fallos **transitorios** (sin red / 5xx) ya no aparcan la cola —reintentan siempre con backoff exponencial, tope 60 s— y solo los 4xx reales esperan un reintento manual; **comentarios y pines ahora esperan** a que su foto exista en el servidor (antes un 404 los marcaba como fallo permanente) y se **reencolan solos** al arrancar la app y al terminar cada subida de foto; el error que muestra la barra siempre es el del último intento y el texto pasa a “N pendientes” (antes “medios”, contaba comentarios y pines). Validado en dispositivo: 4 comentarios creados offline subieron al reconectar. Diagnóstico de partida: backend apagado 3 días → cola aparcada por la política anterior de “6 intentos y abandona”.
- **v1.23 (2026-09-06):** cierre documental del avance — Fase 3 implementada (backend + móvil). AGENTS.md (estado + sección 8) y README actualizados al estado F1✅ M1 · F2✅ M2 · F3⏳ (pendiente: validar comentarios en dispositivo, visor PDF opcional, F2.4 despliegue, Fase 4).
- **v1.22 (2026-09-06):** F3.5/F3.6 — **comentarios en fotos**: hoja 💬 en el visor (lista autor + hora relativa, pendientes ⏫), compositor **offline-first** (local + cola, intento online inmediato; el motor de sync ya sube `comment` con 409=éxito) y merge servidor↔local por id. F3.6 cerrado para pins y comentarios (append-only, sin conflictos).
- **v1.21 (2026-09-06):** F3.4 — **fotos del plano**: grilla con todas las fotos ancladas (desde pines sincronizados, con coordenadas %) accesible con 📋 desde el visor; **filtros de galería** por autor (todas / mías / equipo), por fecha (últimos 7/30 días) y por plano (ids de pines locales + servidor). Estado vacío distinto cuando hay filtros activos.
- **v1.20 (2026-09-06):** F3.3 — **anclaje de fotos sobre el plano en el móvil**: toque → (x%, y%) exactos (respetando zoom/pellizco y pan) → “usar foto existente” (grilla de fotos locales del proyecto) o “tomar foto ahora” → el pin se crea **local-first** y se encola (motor de sync aprende `pin`: POST /pins idempotente con 409 como éxito) con intento online inmediato; pines dibujados sobre el plano (rojo sincronizado / ámbar pendiente ⏫) y tocar un pin abre la foto. Pins locales con `syncedAt` (append-only).
- **v1.19 (2026-09-05):** F3.2 móvil (parcial): **lista de planos** del proyecto con miniaturas y subida (solo ADMIN/SUPERVISOR), **subida con barra de progreso** (expo-image-picker + `createUploadTask` PUT binario) y **visor de plano a pantalla completa** con zoom (pellizco / doble toque) y arrastre. Botón “Planos del proyecto” en el detalle. Pendiente: PDF multipágina (spike F3.0) y toque para anclar (F3.3).
- **v1.18 (2026-09-05):** Fase 3 — backend de planos/pines/comentarios: Plans API (presign + create idempotente con 409 en conflicto de clave, roles ADMIN/SUPERVISOR, thumbnail de planos-imagen, URLs firmadas; migración `plans_storage_keys`), Pins API (`POST /pins` valida plan/foto del mismo proyecto y página ≤ pageCount; `GET /plans/:id/pins` con foto+thumbnail) y Comments API (authorName). F3.0 decidido: PDF vía WebView+pdf.js (Expo Go); `react-native-pdf` postergado a F4. Verificado E2E por curl (403/404/409/400 incluidos).
- **v1.17 (2026-09-05):** botones **💾 Guardar en galería** y **↗️ Compartir** en el visor de medios (expo-media-library/legacy + expo-sharing, ambos en Expo Go): si el medio ya sincronizó (o es del equipo), exporta el **original del servidor con estampa** (URL firmada fresca + descarga a caché); si está pendiente, exporta la copia local (aviso en UI). Permisos de galería con textos en español (plugin en app.json).
- **v1.16 (2026-09-05):** **firma profesional** del usuario: campo `signature` en `users` (migración `add_user_signature`), `PATCH /auth/me` para actualizar perfil (nombre/firma; null la borra), pantalla **Perfil** en la app (👤 en la lista de proyectos) con vista previa de la estampa, y la **estampa de la foto usa la firma** (con fallback al nombre completo). Verificado por curl (set/clear).
- **v1.15 (2026-09-05):** metadatos a fondo: doc `docs/metadata.md` (inventario de metadatos por foto/video), **visor de metadatos** en la app (ℹ️ Ver metadatos: UUID, proyecto, GPS, sync, archivo local…), **nota opcional editable** en la galería mientras la foto no ha sincronizado (append-only tras subir), y **estampa visual quemada en el servidor** (sharp: banda con proyecto · fecha UTC · GPS · autor · nota sobre el original; `STORAGE_STAMP_PHOTOS=true`, verificada E2E; thumbnails se generan sobre la imagen estampada).
- **v1.14 (2026-09-05):** UX offline corregido según prueba M2: la lista de proyectos y el detalle ahora caen a la **caché local** (`cached_projects`, migración local v5 con lat/lng/createdAt) cuando no hay red — sin error bloqueante, aviso azul “Sin conexión” y botones de cámara/galería operativos; la cámara muestra el nombre del proyecto vía params aunque esté offline.
- **v1.13 (2026-09-05):** Fase 2 backend + móvil implementados: storage S3-compatible (F2.1–F2.3: MinIO local dev / R2 prod, pre-signed URLs, `POST /photos` idempotente org-scoped, thumbnails JPEG con sharp) y motor de sync offline-first (F2.5–F2.8: cola FIFO + backoff, subida directa, UI de pendientes, galería en línea del equipo). Pendiente: validación M2 en dispositivo real y despliegue F2.4 (requiere credenciales R2/dominio).
- **v1.12 (2026-09-04):** cierre documental de la Fase 1 (M1): AGENTS.md y README actualizados al nuevo estado; tag `v0.1.0-m1`. Siguiente: Fase 2.
- **v1.11 (2026-09-04):** F1.10 completada — galería local con fotos+videos, thumbnails de video (expo-video-thumbnails), visor fullscreen con expo-video y metadatos. **M1 logrado: foto con estampa visible en galería local.**
- **v1.10 (2026-09-04):** ✅ pruebas en dispositivo Android: fotos en ráfaga, zoom por pellizco, linterna, relación de aspecto y **video con audio** funcionando (requiere permiso de micrófono; si se niega, graba sin audio).
- **v1.9 (2026-09-03):** **video en el MVP** (decisión SPEC v2.2 #7) + controles de cámara: linterna 🔦 (`enableTorch`), relación de aspecto 4:3/16:9/1:1 y **modo 🎥 Video** (grabar/parar, límite 3 min, timer REC, guardado automático local-first). Modelo: `MediaKind PHOTO/VIDEO` + `durationMs` en shared, schema Prisma (migración `add_media_kind`) y BD local (migración v2).
- **v1.8 (2026-09-03):** flujo de cámara en **modo ráfaga** según feedback: disparo → guardado automático local-first (sin confirmación ni navegación) → la cámara sigue activa para más fotos, con toast "✓ Foto guardada (N)". Sonido del obturador **parametrizable** (botón 🔊/🔇; iOS lo respeta, Android sigue el volumen del sistema). Confirmado: el GPS es opcional y nunca bloquea la captura.
- **v1.7 (2026-09-03):** mejoras cámara según pruebas del usuario: captura instantánea (el GPS ya no bloquea el disparo; refresco en segundo plano + calidad 0.7) y controles básicos de **zoom** y **flash OFF/AUTO/ON**.
- **v1.6 (2026-09-03):** F1.7–F1.9 parcial completadas — cámara con estampa en vivo (expo-camera + expo-location + expo-file-system), captura local-first que persiste en SQLite y encola sync. Botón "Tomar foto" en el detalle del proyecto. Plugins de permisos con textos en español en `app.json`.
- **v1.5 (2026-09-03):** F1.6 completada — BD local SQLite (expo-sqlite + drizzle-orm 0.45) con espejo de entidades, cola `sync_queue` y migraciones versionadas (`PRAGMA user_version`, SQL por versión en `lib/db/migrations.ts`; append-only: nunca editar migraciones aplicadas). Añadidos `expo-crypto` (UUID cliente) y helper `lib/id.ts`.
- **v1.4 (2026-09-03):** base móvil F1.4–F1.5: `apps/mobile` (Expo SDK 57 + expo-router) con sesión persistente (`expo-secure-store`), cliente HTTP (`EXPO_PUBLIC_API_URL`), pantallas login/registro/lista-proyectos/detalle/nuevo-proyecto. Pendiente F1.6 (SQLite+Drizzle+sync_queue) y F1.7+ (cámara/GPS).
- **v1.3 (2026-09-03):** Fase 1 backend completada (F1.1–F1.3): módulos `auth`, `users` y `projects`. Infra común nueva: guards globales `JwtAuthGuard`/`RolesGuard`, decoradores `@Public`/`@Roles`/`@CurrentUser`, `ZodValidationPipe` (valida con schemas de `@fotoproy/shared`). Envs: `JWT_SECRET`, `JWT_EXPIRES_IN`. Verificado por curl (401/403/404/400/409).
- **v1.2 (2026-09-02):** regla de codificación aplicada: código, comentarios, logs, mensajes de API, schema Prisma (comentarios) y descripciones de paquetes en inglés (identificadores y nombres de tablas ya lo estaban). La documentación (`docs/`, ROADMAP) y el copy de UI quedan en español/capa i18n.
- **v1.1 (2026-09-02):** Fase 0 completada (hito M0). Notas técnicas del stack efectivo:
  - **TypeScript 6.0.3** en todo el monorepo: TS 7.0.2 elimina `moduleResolution: node10` y el CLI de Nest exige la API de compilador que recién vuelve en 7.1.
  - **Resolución `module: node16`** en la base (CJS para `packages/*`, **ESM para `apps/api`** — NestJS 12 es ESM, requiere `"type": "module"` + extensiones `.js` en imports relativos).
  - **Prisma 6.19.3**: Prisma 7 (actual) exige driver adapters + `prisma.config.ts` y ya no acepta `url` en el schema — se migrará en una tarea dedicada más adelante.
  - Puertos locales: BD docker `55432`, API dev `4100`.
- **v1 (2025-09-02):** creación del ROADMAP alineado a SPEC v2.1. Decisiones cerradas: stack TS/Expo/NestJS, plano-imagen como "mapa" en MVP, enlaces de solo lectura, login email+contraseña, roles ADMIN/SUPERVISOR/TECHNICIAN, esquema BD solo informativo.
