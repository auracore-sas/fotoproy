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

> ✅ **Backend F1.1–F1.3 completado (2026-09-03)** — verificado por curl: register→org+ADMIN, login, me, roles, miembros, CRUD projects con org-scoping, 401/403/404/400/409 según caso. Pendiente: **móvil F1.4–F1.10** (M1).

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
- [x] **F1.9 (parcial)** **Captura local-first**: disparar → UUID cliente → archivo copiado a `documentDirectory/fotoproy/` (`lib/media.ts`) → `createLocalPhoto` en SQLite **siempre** → `enqueueSync('photo', …)` en cola. Pendiente: thumbnails locales y galería (F1.10).
- [ ] **F1.10** Galería local básica (grid) + detalle de foto con metadatos.

---

## Fase 2 — Backend de archivos + motor de sync + despliegue (semanas 4–6)

**DoD global F2 = M2.**

### Backend / infraestructura

- [ ] **F2.1** **Storage R2**: bucket(s) + credenciales; servicio que emite **pre-signed PUT URLs** (objeto original) y URLs de lectura; configuración de CORS del bucket.
- [ ] **F2.2** **Endpoint de fotos**: `POST /photos` (recibe metadatos + `storage_key` ya subido por el cliente; valida pertenencia a proyecto de la org); `GET /photos?projectId` (lista paginada con thumbnail); `GET /photos/:id`. Idempotencia por `id` de cliente (evita duplicados en reintentos).
- [ ] **F2.3** **Procesado de imágenes** (job): al confirmarse una foto, generar **thumbnail WebP** con `sharp` y guardar en R2 (path `/thumbs/…`). Cola simple BullMQ (Redis) o procesamiento inline si el volumen lo permite ⚠️.
- [ ] **F2.4** **Despliegue básico**: API contenedorizada + Postgres gestionado (Neon/RDS/VPS con docker) + bucket R2 + dominio/SSL + envs de producción + despliegue automatizado mínimo (script o CI). Entornos dev/staging/prod.

### Móvil — motor de sincronización

- [ ] **F2.5** **Detector de conectividad** (NetInfo/expo-network) + procesador de cola: procesa `sync_queue` en orden FIFO cuando hay red; al fallar, **backoff exponencial** y reintento automático.
- [ ] **F2.6** **Sync de fotos**: pedir pre-signed URL → subir archivo a R2 (PUT con el URI local, sin base64 gigante) → `POST /photos` con metadatos → marcar `DONE`. Reintentos idempotentes (mismo UUID cliente).
- [ ] **F2.7** **UI de estado**: indicador global de pendientes (ej. "3 fotos por subir"), acción "sincronizar ahora", estados por foto (local → subiendo → en línea / error).
- [ ] **F2.8** Descarga de metadatos/thumbnails para galería en línea (caché local de lo ya visto).

**DoD F2:** con el móvil en modo avión: capturar N fotos → todas aparecen "pendientes" → al quitar modo avión se suben solas en orden y el servidor las lista sin duplicados.

---

## Fase 3 — Planos, anclaje de pines, galería y comentarios (semanas 7–9)

**DoD global F3 = M3.**

- [ ] **F3.0** **Spike técnico (crítico)**: renderizar PDF multipágina en RN y obtener coordenadas de toque fiables. Opciones: `react-native-pdf` (requiere **dev client / EAS build**, no Expo Go) vs. WebView + pdf.js (exactitud de coordenadas). Entregable: decisión documentada + PoC con toque → (x%, y%) correctos por página. _Si el PDF resulta inviable en tiempo, el MVP soporta planos-imagen y el PDF queda como mejora_ ⚠️.
- [ ] **F3.1** **Plans API**: `POST /projects/:id/plans` (subida de archivo a R2 — reusar patrón F2.2 — + metadatos `title`, `page_count`, `plan_kind: IMAGE|PDF`); `GET` lista/uno; **reemplazo**: se crea un plan nuevo (los pins viejos siguen apuntando a su plan).
- [ ] **F3.2** **Plans móvil**: selector de archivos (`expo-image-picker`/`expo-document-picker`), subida con progreso, visor a pantalla completa (imagen multipágina: paginación swipe; PDF: según spike), lista de planos del proyecto (solo ADMIN/SUPERVISOR suben).
- [ ] **F3.3** **Pines API + móvil**: `POST /pins` (plan_id, photo_id, `page_number`, `x_percentage`, `y_percentage`). UX: en el visor, **tocar un punto** → opciones "usar foto existente" o "tomar foto ahora" → se coloca el pin y se abre la foto.
- [ ] **F3.4** **Navegación desde pins**: tocar un pin abre la foto (modal/hoja); ver todas las fotos de un plan en una lista; **filtros de galería** por usuario, fecha y plano.
- [ ] **F3.5** **Comentarios** (API + móvil, online y offline→cola): texto por foto; autor + fecha; permisos de lectura según rol.
- [ ] **F3.6** **Sync extendido**: pins y comentarios creados offline se sincronizan con la misma cola (F2.5); conflictos de pins no aplican (append-only).

---

## Fase 4 — Compartir, pulido, QA y distribución (semanas 10–12)

**DoD global F4 = M4.**

- [ ] **F4.1** **Enlaces de solo lectura**: el ADMIN crea un share token firmado (JWT/random) con `expires_at` configurable y opción de revocar; endpoint público `GET /s/:token` (sin auth) que devuelve el proyecto + fotos (metadatos) — con org-scoping implícito por token.
- [ ] **F4.2** **Vista web mínima** (server-rendered por la API, sin SPA): lista de fotos del proyecto con thumbnails desde R2, estampas y comentarios; página individual de foto; manejo de token vencido/revocado (mensaje claro).
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
