# FotoProy — Especificación Técnica y de Producto

> **Producto:** FotoProy — Documentación fotográfica de proyectos de construcción
> **Versión:** 2.1 (decisiones cerradas)
> **Estado:** Lista como base de arranque del MVP. Decisiones de producto/stack cerradas (§10); solo quedan pendientes de negocio (precios), que no bloquean el desarrollo.
> **Historial:** v1.0 (archivada en `docs/archive/SPEC-v1.0-raw.md`) tenía foco en ingeniería eléctrica LATAM (FieldElectro/ElectroField). v2.0 redefinió el producto: **multi-perfil de construcción**, nombre **FotoProy**, móvil iOS+Android con un único código, offline-first. v2.1 cierra las decisiones abiertas.
> **Importante:** el esquema de base de datos de la §5 es **informativo / de referencia** — puede reutilizarse o cambiarse por completo; la fuente de verdad será el esquema Prisma al momento de implementar.

---

## 1. Resumen Ejecutivo y Visión

**FotoProy** es una plataforma móvil (iOS + Android) para **documentar el proceso de construcción con fotos**: capturar, almacenar, organizar y compartir fotos ilimitadas de un proyecto en un archivo seguro en línea.

**Propuesta de valor central:** permitir que cualquier equipo de obra —ingenieros civiles, arquitectos, eléctricos, electrónicos, constructores, fiscalizadores, supervisores— capture evidencias fotográficas de avance desde cualquier dispositivo, **las ancle sobre un mapa o plano del proyecto**, agregue anotaciones y comentarios, y comparta todo con su equipo, **incluso en zonas sin cobertura de red** (offline-first).

### Frase de producto (elevator pitch)

> "Documenta cada paso del proceso de construcción con fotos del proyecto. Captura, almacena y comparte fotos ilimitadas en un archivo seguro en línea. Cárgalas desde cualquier dispositivo, organízalas fácilmente y agrega anotaciones y comentarios para alinear a tu equipo."

### Perfiles objetivo (todos los perfiles de la construcción)

| Perfil                              | Caso de uso principal                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Ingeniero civil / residente de obra | Evidencia de avance por frentes de trabajo, bitácora visual            |
| Arquitecto                          | Registro de acabados, control de calidad, seguimiento de observaciones |
| Ingeniero eléctrico / electrónico   | Registro de instalaciones, tableros, tendido, inspecciones             |
| Contratista / maestro de obra       | Reporte de avance al cliente, control de subcontratistas               |
| Fiscalizador / inspector            | Evidencia de cumplimiento, reportes de no-conformidades                |
| Dueño de proyecto / cliente         | Seguimiento remoto del avance físico de la obra                        |

**Mercado objetivo:** Ecuador y América Latina (modelo de precio accesible por equipo). El producto no está restringido a un gremio: la **verticalización por especialidad (símbolos eléctricos, OCR de placas, etc.) se agrega después del MVP** como capas optativas.

---

## 2. Problema y Diferenciación

**Problema:** la documentación fotográfica de obra es desordenada (fotos en galerías personales, WhatsApp, sin contexto), no tiene trazabilidad espacial (¿dónde se tomó?, ¿qué avance representa?), y el equipo pierde tiempo armando reportes manuales.

**Diferenciación frente a competidores (CompanyCam, SiteCam, Solocator, SafetyCulture):**

| Criterio            | FotoProy (diferenciador)                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Alcance de perfiles | Multi-perfil construcción (no solo un gremio)                                                |
| Anclaje espacial    | **Fotos ancladas sobre mapa o plano del proyecto** (imagen o PDF, por página, coordenadas %) |
| Sincronización      | **Offline-first estricto**: captura sin red, cola local con reintentos                       |
| Modelo de precio    | Por **cuadrilla/equipo** (no por usuario individual)                                         |
| Facturación local   | Factura SRI Ecuador (fase posterior)                                                         |
| Organización        | Proyectos → planos/mapas → fotos ancladas + comentarios                                      |

---

## 3. Decisiones de Stack (recomendación)

> El requisito clave del stack: **un único código base para iOS y Android**, con capacidad de crecer (web de visualización, backend robusto, offline).

### 3.1 Decisión general: TypeScript full-stack

| Capa                 | Recomendación                                                                                         | Alternativa             | Por qué                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Móvil**            | **React Native + Expo (último SDK estable)** + TypeScript                                             | Flutter (Dart)          | Un solo código iOS/Android; **mismo lenguaje que el backend**; Expo es hoy el camino oficial recomendado por RN (SDK 57 / RN 0.86+); actualizaciones OTA sin pasar por la App Store (clave para cuadrillas en campo); ecosistema enorme de librerías (cámara, mapas, PDF). Permite sumar web más adelante (`react-native-web`). |
| **Base local móvil** | SQLite (`expo-sqlite`) + **Drizzle ORM**                                                              | WatermelonDB / Drift    | Offline-first con tabla de cola de sincronización simple y control total; Drizzle es liviano y tipado.                                                                                                                                                                                                                          |
| **Backend API**      | **NestJS (Node + TypeScript)**                                                                        | Go (Gin/Fiber), Fastify | Modular, escalable, tipado con el mismo lenguaje del móvil; facilita compartir tipos/DTOs.                                                                                                                                                                                                                                      |
| **Base de datos**    | **PostgreSQL 16** + extensión **PostGIS** (geométrica lista desde el día 1 aunque el MVP la use poco) | —                       | Madura, geoespacial, JSONB para metadatos futuros.                                                                                                                                                                                                                                                                              |
| **ORM backend**      | **Prisma**                                                                                            | Drizzle                 | DX, migraciones, tipos generados.                                                                                                                                                                                                                                                                                               |
| **Almacenamiento**   | **Cloudflare R2** (S3-compatible, sin costo de egress) con **subida directa vía pre-signed URLs**     | AWS S3                  | Libera al backend de manejar bytes pesados; thumbnails WebP generados en el backend (sharp).                                                                                                                                                                                                                                    |
| **Autenticación**    | JWT (email + contraseña) + roles                                                                      | Supabase Auth           | Simplicidad; revisar si conviene delegar auth a Supabase en fase 2.                                                                                                                                                                                                                                                             |
| **Monorepo**         | pnpm workspaces                                                                                       | —                       | Código compartido entre apps (tipos, validaciones).                                                                                                                                                                                                                                                                             |

### 3.2 Por qué React Native/Expo y no Flutter (resumen)

- **Un solo lenguaje en todo el proyecto** (TypeScript): compartimos tipos de datos, validaciones y lógica entre app, API y (futura) web → menos bugs de contrato entre cliente y servidor.
- **Expo elimina la fricción nativa** (builds en la nube con EAS, config plugins), y es la recomendación oficial del equipo de React Native para apps nuevas en producción.
- **Actualizaciones OTA (EAS Update):** una cuadrilla en obra actualiza la app sin depender de la App Store — ventaja operativa enorme para este producto.
- Flutter es una opción válida (gran rendimiento de UI), pero se descarta para mantener TypeScript en todo el stack. ✅ **Decisión cerrada (v2.1): TypeScript full-stack — Expo/React Native (móvil) + NestJS/Prisma (backend) + PostgreSQL/PostGIS + Cloudflare R2 + monorepo pnpm.**

### 3.3 Arquitectura de alto nivel

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  APP MÓVIL (Expo + RN + TS) │        │  BACKEND API (NestJS)         │
│  iOS + Android              │  HTTPS │  - REST /auth /projects /...  │
│  - Cámara + estampa         │◄──────►│  - Genera pre-signed URLs R2  │
│  - Visor de planos/mapas    │        │  - Procesa imágenes (sharp)   │
│  - SQLite local (offline)   │        │  - Cola de jobs (BullMQ)      │
│  - Cola de sincronización   │        └──────┬───────────────┬────────┘
└────────────┬────────────────┘               │               │
             │ subida directa                 ▼               ▼
             ▼                    ┌────────────────────┐ ┌─────────────┐
      ┌──────────────┐            │ PostgreSQL 16 +    │ │ Cloudflare  │
      │ Cloudflare R2│◄───────────│ PostGIS (Prisma)   │ │ R2          │
      │ (fotos/WebP) │  presigned │                    │ │ (originales)│
      └──────────────┘            └────────────────────┘ └─────────────┘
```

**Flujo de captura offline:** la app guarda la foto comprimida (WebP) + metadatos en SQLite con UUID cliente → crea tarea en la cola (`PENDING`) → cuando detecta red, pide una pre-signed URL al backend y sube el archivo directo a R2 → notifica al backend para registrar/confirmar la entidad. Todo es **append-only e inmutable** (una foto o pin no se edita, se crea), por lo que no hay conflictos de escritura.

---

## 4. Alcance del MVP

**Plataforma MVP:** móvil iOS + Android (un solo código). **Web de visualización** de enlaces compartidos en fase 2.

**Alcance confirmado (v2.1):** el "mapa" del proyecto es el **plano/imagen subido por el equipo** (imagen o PDF multipágina) — los mapas por tiles en vivo quedan en fase 2 · compartir = **enlaces de solo lectura** con expiración (sin PDF en el MVP) · login **email + contraseña** · roles **ADMIN / SUPERVISOR / TECHNICIAN**.

### 4.1 Dentro del alcance (MVP)

| #   | Módulo                                         | Descripción funcional                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cuentas y roles**                            | Registro/login email+contraseña. Organización (empresa). Roles: `ADMIN` (invita, gestiona), `SUPERVISOR` (gestiona proyectos y planos), `TECHNICIAN` (captura fotos, comenta).                                                                                                                                                                                                                                                |
| 2   | **Proyectos (obras)**                          | CRUD: código, nombre, cliente, descripción, ubicación opcional (GPS del punto central). Lista de proyectos por organización.                                                                                                                                                                                                                                                                                                  |
| 3   | **Cámara con estampa**                         | Captura nativa con enfoque al tocar y flash. Sello/estampa en vivo: fecha/hora, proyecto, usuario, y **GPS cuando esté disponible** (sin red también funciona con GPS del dispositivo). La foto se guarda local SIEMPRE primero.                                                                                                                                                                                              |
| 4   | **Mapa / plano de obra + anclaje de fotos** ⭐ | Subir **imagen o PDF** como "mapa/plano" del proyecto (varios por proyecto; PDF multipágina). Visor a pantalla completa. **Tocar un punto del plano → colocar/adjuntar una foto anclada** (coordenada relativa x%, y% por página). Ver las fotos ancladas sobre el plano; tocar un pin abre la foto. _Nota: "mapa" en MVP = plano/imagen subido por el equipo. Mapas por tiles en vivo (Google/MapLibre) quedan para fase 2._ |
| 5   | **Galería de fotos**                           | Grid de fotos del proyecto con filtros (por usuario, fecha, plano/pin). Vista detalle con metadatos (fecha, autor, GPS si existe) y comentarios.                                                                                                                                                                                                                                                                              |
| 6   | **Comentarios**                                | Comentarios de texto por foto para alinear al equipo (notificaciones básicas en fase 2).                                                                                                                                                                                                                                                                                                                                      |
| 7   | **Offline-first**                              | Captura, anclaje y comentarios **sin conexión**. Cola local de sincronización con reintentos y backoff; indicador visual de pendientes.                                                                                                                                                                                                                                                                                       |
| 8   | **Compartir**                                  | Enlace de solo lectura (sin login) con expiración configurable por el ADMIN para compartir el avance con clientes. _(vista web mínima servida por el backend)_                                                                                                                                                                                                                                                                |
| 9   | **Almacenamiento seguro**                      | Fotos ilimitadas por proyecto; original comprimido (WebP/JPEG) + thumbnail; acceso autenticado por rol.                                                                                                                                                                                                                                                                                                                       |

### 4.2 Fuera del alcance del MVP (roadmap fase 2+)

- Anotación vectorial (dibujo de flechas, círculos, texto sobre la foto).
- IA: OCR de placas, lectura de medidores, nota de voz → resumen técnico (Whisper + LLM).
- Capa eléctrica: fases R/S/T, simbología en planos, diagramas unifilares (verticalización optativa).
- Facturación SRI Ecuador y pasarelas de pago locales.
- Mapas en vivo con tiles, geofencing, modo realidad aumentada.
- App web completa de gestión + vista de reportes.
- Reportes PDF generados (headless Chromium/WeasyPrint).
- Integraciones (n8n, Make, Zapier, Google Drive) y API pública.
- Permisos granulares por proyecto/plan; versionado fino de planos (en MVP se permite reemplazar un plano).

---

## 5. Modelo de Datos (PostgreSQL + PostGIS)

DDL base para el MVP (los campos espaciales ya existen para no migrar después). Los campos de IA/eléctrica **no se incluyen todavía** (se agregan con migraciones en fase 2).

> ⚠️ **Esquema informativo / de referencia:** sirve para entender el dominio y como punto de partida. Puede reutilizarse tal cual, ajustarse o rediseñarse por completo al crear el esquema Prisma. No hay compromiso de implementación con estas tablas.

```sql
-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. ORGANIZACIONES / EMPRESAS
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tax_id VARCHAR(20) UNIQUE,                 -- RUC/NIT/RFC (opcional en MVP)
  legal_name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. USUARIOS Y ROLES
CREATE TYPE user_role AS ENUM ('ADMIN','SUPERVISOR','TECHNICIAN');
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'TECHNICIAN',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. PROYECTOS / OBRAS
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  client_name VARCHAR(255),
  location_geom GEOMETRY(Point, 4326),        -- ubicación central (opcional)
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

-- 4. MAPAS / PLANOS DEL PROYECTO (imagen o PDF, multipágina)
CREATE TABLE project_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  page_count INT DEFAULT 1,
  plan_kind VARCHAR(20) DEFAULT 'IMAGE',       -- 'IMAGE' | 'PDF'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. FOTOGRAFÍAS
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  latitude NUMERIC(10,7),                     -- GPS (opcional)
  longitude NUMERIC(10,7),
  altitude NUMERIC(8,2),                      -- (opcional, si el dispositivo lo da)
  notes TEXT,
  captured_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. PINES: foto anclada sobre un plano (posición relativa por página)
CREATE TABLE photo_pins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID REFERENCES project_plans(id) ON DELETE CASCADE,
  photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
  page_number INT DEFAULT 1,
  x_percentage NUMERIC(5,2) NOT NULL,         -- 0.00 a 100.00
  y_percentage NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. COMENTARIOS EN FOTOS
CREATE TABLE photo_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_photos_geom ON photos USING GIST(
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
) WHERE latitude IS NOT NULL;
CREATE INDEX idx_photos_project ON photos(project_id);
CREATE INDEX idx_pins_plan ON photo_pins(plan_id);
CREATE INDEX idx_comments_photo ON photo_comments(photo_id);
```

> **Nota de diseño:** para anclaje en mapas reales (fase 2) se agregará a `photos` un campo `location_geom GEOMETRY(Point,4326)`; en el MVP la posición se expresa con lat/long numérica y la anclaje visual se hace sobre planos (pines %).

### Base local móvil (SQLite)

Espejo de las entidades anteriores (solo lo que necesita el técnico offline) + tabla de cola:

```sql
-- Cola de sincronización (cliente)
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,                -- UUID cliente
  entity_type TEXT NOT NULL,          -- 'photo' | 'pin' | 'comment' | 'plan'
  entity_id TEXT NOT NULL,            -- UUID cliente de la entidad
  payload TEXT NOT NULL,              -- JSON
  status TEXT DEFAULT 'PENDING',      -- PENDING | UPLOADING | DONE | FAILED
  attempts INT DEFAULT 0,
  created_at TEXT NOT NULL
);
```

---

## 6. Motor de Sincronización Offline-First (resumen de diseño)

1. **Captura inmutable local:** toda foto/pin/comentario nace con UUID v4 de cliente y se persiste en SQLite; nunca se edita, solo se crea → sin conflictos de escritura.
2. **Cola de sincronización:** al crear entidad con red, se sincroniza de inmediato; sin red, queda `PENDING` y la cola reintenta con backoff exponencial cuando detecta conectividad.
3. **Subida resiliente:** los archivos pesados suben directo a R2 con pre-signed URLs (chunks si es necesario); el backend recibe solo los metadatos.
4. **Estado de pendientes visible** en la UI (cuántas fotos faltan por subir) para dar confianza al técnico.
5. **Append-only + timestamps atómicos** del lado del servidor para ordenar eventos (`captured_at` del cliente + `created_at`/`synced_at` del servidor).

---

## 7. Estrategia Comercial (borrador — pendiente de decisión de negocio, no bloquea el MVP)

| Plan                        | Inclusión (borrador)                                                        | Precio sugerido |
| --------------------------- | --------------------------------------------------------------------------- | --------------- |
| Starter (cuadrilla pequeña) | Hasta 3 usuarios, 5 proyectos activos, fotos ilimitadas, plano + anclaje    | ~$19.99/mes     |
| Pro (contratista)           | Hasta 10 usuarios, proyectos ilimitados, planos PDF + compartir con cliente | ~$39.99/mes     |
| Enterprise                  | Usuarios ilimitados, API, servidor dedicado, integraciones                  | Personalizado   |

_Facturación electrónica SRI Ecuador en fase 2._

---

## 8. Roadmap (12 semanas para MVP)

| Fase                        | Semanas | Entregables                                                                                                                                                                                     |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1 — Fundación móvil**    | 1–3     | Monorepo (pnpm): `apps/mobile`, `apps/api`, `packages/shared`, `packages/database`. Auth + organización + roles. CRUD proyectos. Cámara con estampa (fecha/hora/GPS). SQLite local con Drizzle. |
| **F2 — Backend + sync**     | 4–6     | API NestJS + Prisma + PostgreSQL. Migración DDL. R2 con pre-signed URLs. **Motor de sync offline** (cola, backoff, indicador de pendientes). Despliegue básico (API + R2 + DB).                 |
| **F3 — Planos y anclaje**   | 7–9     | Subida de imagen/PDF de planos (multipágina). Visor + **toque para anclar foto (x%, y%)** + pines. Galería con filtros. Comentarios.                                                            |
| **F4 — Compartir y pulido** | 10–12   | Enlaces de solo lectura con expiración (vista web mínima). Thumbnails/optimización. QA E2E en iOS+Android. Distribución interna (TestFlight / Play Internal). Métricas básicas.                 |

---

## 9. Estructura del Repositorio (propuesta)

```
fotoproy/
├─ apps/
│  ├─ mobile/            # Expo + React Native + TypeScript (iOS + Android)
│  └─ api/               # NestJS + Prisma
├─ packages/
│  ├─ database/          # Esquema Prisma + migraciones SQL
│  └─ shared/            # Tipos/DTOs/validación compartidos (zod)
├─ docs/
│  ├─ SPEC.md            # Este documento
│  └─ archive/           # Versiones anteriores
└─ package.json          # pnpm workspace
```

---

## 10. Decisiones de Producto y Técnicas

### ✅ Cerradas (v2.1)

| #   | Decisión                 | Resolución                                                                                                                                                                   |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lenguaje / stack         | **TypeScript full-stack**: React Native + Expo (móvil iOS/Android con un único código), NestJS + Prisma + PostgreSQL 16/PostGIS, Cloudflare R2, monorepo pnpm.               |
| 2   | "Mapa" en el MVP         | Es el **plano/imagen subido por el equipo** (imagen o PDF multipágina), con anclaje de fotos en coordenadas relativas (x%, y%) por página. Mapas por tiles en vivo → fase 2. |
| 3   | Compartir con clientes   | **Enlaces de solo lectura** (sin login, con expiración configurable). Sin exportación PDF en el MVP.                                                                         |
| 4   | Autenticación            | **Email + contraseña** (JWT). Login social (Google/Apple) se evalúa en fase 2.                                                                                               |
| 5   | Roles                    | **ADMIN / SUPERVISOR / TECHNICIAN** (enum `user_role`).                                                                                                                      |
| 6   | Esquema de base de datos | El DDL de la §5 es **solo informativo / de referencia**: puede reutilizarse o cambiarse por completo. La fuente de verdad será el esquema Prisma al implementar.             |

### ⏳ Pendientes (decisión de negocio, no bloquean el MVP técnico)

- **Modelo de precios/monetización** (§7): validar planes por cuadrilla ($19.99 / $39.99 / personalizado) y facturación SRI para fase 2.
- **Identidad visual / branding** de FotoProy (logo, colores) — se puede trabajar en paralelo.
