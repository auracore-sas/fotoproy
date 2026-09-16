# FotoProy 📸🏗️

**Documenta cada paso del proceso de construcción con fotos del proyecto.**

FotoProy es una plataforma móvil (iOS + Android) para **capturar, almacenar, organizar y compartir fotos ilimitadas** de proyectos de construcción en un archivo seguro en línea. Está pensada para todos los perfiles de obra —ingenieros civiles, arquitectos, eléctricos, electrónicos, contratistas, fiscalizadores y clientes— y funciona **incluso en zonas sin cobertura de red** (offline-first).

> Captura desde cualquier dispositivo, organízalas fácilmente sobre un **mapa/plano del proyecto**, agrega anotaciones y comentarios, y comparte el avance con tu equipo para mantener a todos alineados.

---

## Estado del proyecto

| Estado            | Detalle                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📋 Especificación | ✅ **v2.1** — decisiones de producto y stack cerradas ([docs/SPEC.md](docs/SPEC.md))                                                                                                                                                                           |
| 🗺️ Planificación  | ✅ **ROADMAP creado** — 5 fases (F0–F4) hasta el MVP ([ROADMAP.md](ROADMAP.md))                                                                                                                                                                                |
| 💻 Código         | ✅ **F1 (M1)** · ✅ **F2 (M2)** · ✅ **F3 (M3)** · 🚧 **F4 en curso** — F4.1 enlaces de solo lectura ✅, F4.2 vista web ✅ (pendiente validar el enlace en el navegador del teléfono), F4.3 pulido UX/offline ✅ y F4.3.1 rediseño visual ✅; siguen F4.4–F4.7 |

> [!NOTE]
> Proyecto en desarrollo — Fases 0–3 completas (M0–M3) y Fase 4 en curso (F4.1 + F4.2 listos; pendiente la validación del enlace en el teléfono; F4.3 pulido UX/offline y F4.3.1 rediseño visual completados). Quedan F4.4–F4.7, el despliegue F2.4 y el visor PDF opcional. El estado por fases vive en el [ROADMAP](ROADMAP.md).

---

## Características principales (alcance MVP)

- 📷 **Cámara con estampa**: captura con sello en vivo (fecha/hora, proyecto, usuario y GPS cuando está disponible), en modo ráfaga, con zoom por pellizco, linterna y relación de aspecto.
- 🎥 **Fotos y videos de obra**: graba videos cortos con audio (hasta ~3 min) con el mismo flujo de captura.
- 🖼️ **Galería local offline**: todo lo capturado queda guardado en el dispositivo y se ve en la galería del proyecto aunque no haya red.
- 📍 **Anclaje sobre planos**: sube el mapa/plano de la obra (imagen o PDF multipágina) y **ancla cada foto tocando el punto** del plano donde se tomó (coordenadas relativas por página).
- 📁 **Archivo organizado por proyectos**: proyectos → planos → fotos ancladas, con galería y filtros por usuario/fecha/plano.
- 💬 **Comentarios**: alinea al equipo comentando directamente sobre cada foto.
- 📡 **Offline-first**: captura, ancla y comenta **sin conexión**; todo se sincroniza automáticamente al recuperar red (cola local con reintentos).
- 🔗 **Compartir con clientes**: enlaces de **solo lectura** con expiración configurable (sin necesidad de cuenta).
- 👥 **Roles por organización**: `ADMIN`, `SUPERVISOR` y `TECHNICIAN`.

_Fuera del MVP (backlog post-MVP en el [ROADMAP](ROADMAP.md)): web de gestión, reportes PDF, IA/OCR, facturación SRI, mapas en vivo, integraciones, entre otros._

---

## Stack tecnológico

| Capa                                      | Tecnología                                         |
| ----------------------------------------- | -------------------------------------------------- |
| **Móvil** (iOS + Android, un solo código) | React Native + **Expo** + TypeScript               |
| **Base local (offline)**                  | SQLite (`expo-sqlite`) + Drizzle ORM               |
| **Backend API**                           | **NestJS** (Node + TypeScript)                     |
| **Base de datos**                         | PostgreSQL 16 + PostGIS                            |
| **ORM backend**                           | Prisma                                             |
| **Almacenamiento**                        | Cloudflare R2 (subida directa con pre-signed URLs) |
| **Auth**                                  | JWT (email + contraseña)                           |
| **Monorepo**                              | pnpm workspaces                                    |

_El esquema de base de datos detallado en la SPEC es informativo; la fuente de verdad es el schema Prisma en [`packages/database`](packages/database/prisma/schema.prisma)._

---

## Estructura del repositorio

```
fotoproy/
├─ apps/
│  ├─ mobile/            # Expo 57 + RN + TS (iOS + Android) — F1 cámara/BD local · F2 sync · F3 planos/pines/comentarios
│  └─ api/               # NestJS 12 (ESM) + Prisma — API REST
├─ packages/
│  ├─ database/          # Schema Prisma (fuente de verdad) + migraciones SQL
│  └─ shared/            # zod schemas + tipos compartidos (app ⇄ API)
├─ docs/
│  ├─ SPEC.md            # Especificación técnica y de producto (v2.1)
│  └─ archive/           # Versiones anteriores de la especificación
├─ docker-compose.yml    # Postgres 16 + PostGIS local (puerto 55432)
├─ ROADMAP.md            # Plan de implementación completo
├─ AGENTS.md             # Reglas y flujos para agentes de código
└─ README.md             # Este archivo
```

---

## Documentación

| Documento                                  | Descripción                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)               | Especificación técnica y de producto **v2.1**: visión, alcance del MVP, stack, arquitectura, modelo de datos y decisiones cerradas. |
| [docs/development.md](docs/development.md) | Guía de desarrollo: cómo levantar el backend, la app en el celular con Expo Go, demo M2 offline y solución de problemas.            |
| [docs/metadata.md](docs/metadata.md)       | Referencia del producto: metadatos registrados por foto/video (captura, sync, estampa visual, servidor).                            |
| [docs/shares.md](docs/shares.md)           | Enlaces de solo lectura (F4.1): decisiones, modelo de datos, endpoints privados/públicos, seguridad y criterios de aceptación.      |
| [ROADMAP.md](ROADMAP.md)                   | Plan de implementación: fases F0–F4 con tareas, criterios de terminado, hitos, riesgos y backlog post-MVP.                          |
| [AGENTS.md](AGENTS.md)                     | Reglas y flujos de trabajo para agentes de código: idiomas, convenciones, comandos y trampas.                                       |
| [docs/archive/](docs/archive/)             | Historial de versiones (SPEC v1.0 original, foco eléctrico LATAM).                                                                  |

---

## Cómo empezar (desarrollo local)

> Guía completa con pasos y troubleshooting en [docs/development.md](docs/development.md).

```bash
# Requisitos: Node 26 (ver .nvmrc), pnpm, Docker

pnpm install              # primera vez: instala workspaces (genera Prisma Client)
pnpm db:migrate           # primera vez: aplica las migraciones Prisma

pnpm dev:up               # día a día: Docker (BD+MinIO) + API :4100 + envs con tu IP LAN
pnpm dev:mobile           # terminal 2: Metro/Expo Go (escanea el QR con el celular)
```

Verificar que la API está viva: `curl http://localhost:4100/health` → `{"status":"ok","db":"up",...}`.

Comandos útiles: `pnpm dev:stop` · `pnpm build` · `pnpm lint` · `pnpm format` · `pnpm db:studio` · `pnpm db:down`.

> 📌 **Puertos locales:** BD **55432** · MinIO **9000/9001** · API **4100** · Metro **8081** (5432/5433/3000 están ocupados por otros servicios de esta máquina).

---

## Licencia

Privado — uso interno del equipo de desarrollo. _(Definir modelo de negocio/licencia en fase posterior.)_
