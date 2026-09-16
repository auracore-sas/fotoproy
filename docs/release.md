# FotoProy — distribución móvil (F4.6)

> Runbook para compilar, distribuir y actualizar la app (iOS + Android) con
> **EAS Build** y **EAS Update**.
>
> Estado: **configuración lista en el repo** (perfiles de build, versionado,
> `expo-updates`, `expo-dev-client`, scripts y comprobación de tamaño antes de
> subir). Falta ejecutarlo: **login en Expo/EAS** y las cuentas de tienda (§2).

---

## 1. Piezas y por qué

| Pieza                              | Para qué                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx eas-cli`                      | Compila en la nube (no hace falta Xcode/Android Studio local).                                                                                                     |
| **Dev client** (`expo-dev-client`) | Build propio con módulos nativos. Necesario el día que entre el visor PDF u otra librería que no esté en Expo Go.                                                  |
| **EAS Update** (`expo-updates`)    | Cambios de JavaScript (UI, lógica, textos) sin pasar por las tiendas.                                                                                              |
| `eas.json` (3 perfiles)            | `development` (dev client), `preview` (APK/IPA interno), `production` (tiendas).                                                                                   |
| `runtimeVersion` = `appVersion`    | Una OTA solo se aplica a binarios con el mismo `runtimeVersion`. Si cambia el código nativo, sube `version` y el binario anterior deja de recibir OTAs (correcto). |

---

## 2. Lo que hace falta de terceros

| Requisito                   | Coste        | Nota                                    |
| --------------------------- | ------------ | --------------------------------------- |
| Cuenta **Expo** (gratuita)  | 0            | Necesaria para EAS Build/Update.        |
| **Apple Developer Program** | 99 USD/año   | Solo para iOS (TestFlight y App Store). |
| **Google Play Console**     | 25 USD único | Solo para Android (Internal testing).   |

Sin las cuentas de tienda se puede compilar igual para Android (`preview`, APK
interno) y probar en un dispositivo real; iOS requiere Apple para instalar en
un iPhone (o un simulador en un Mac).

---

## 3. Configuración inicial (una vez)

```bash
cd apps/mobile

# 1. Autenticarse (abre el navegador).
npx eas-cli@latest login

# 2. Crear el proyecto en Expo y escribir `extra.eas.projectId` en app.json.
npx eas-cli@latest init

# 3. Añadir `updates.url` a app.json (habilita las OTAs).
npx eas-cli@latest update:configure

# 4. (Opcional) Revisar que todo cuadra con el SDK instalado.
npx expo-doctor
```

`eas init` y `update:configure` **modifican `app.json`**: revisa el diff y
commitéalo (el `projectId` no es un secreto, es el identificador público del
proyecto).

Credenciales de firma: EAS ofrece generarlas y custodiarlas
(`eas credentials`). Para iOS también se puede usar una cuenta de Apple ya
configurada; para Android, un keystore propio (si algún día se sube a Play, hay
que **conservar el keystore**: perderlo impide actualizar la app).

---

## 4. Día a día

| Objetivo                                        | Comando                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Desarrollo con **Expo Go** (solo JavaScript)    | `pnpm dev:mobile:go`                                               |
| Desarrollo con **dev client** (módulos nativos) | `cd apps/mobile && pnpm start:dev` tras un `pnpm build:dev`        |
| Build interno para probar en un teléfono        | `pnpm --filter @fotoproy/mobile build:preview`                     |
| Build de tiendas                                | `pnpm --filter @fotoproy/mobile build:prod`                        |
| OTA a los probadores (`preview`)                | `pnpm --filter @fotoproy/mobile update:preview`                    |
| OTA a producción                                | `pnpm --filter @fotoproy/mobile update:prod`                       |
| Subir a TestFlight / Play                       | `cd apps/mobile && npx eas-cli@latest submit --profile production` |

> Con `expo-dev-client` instalado, `expo start` arranca el dev client por
> defecto. Por eso `pnpm dev:mobile:go` usa `expo start --go`: mantiene el flujo
> actual con Expo Go para todo lo que no necesite código nativo.

### Variables de entorno y OTA

`EXPO_PUBLIC_API_URL` **se incrusta en el bundle JavaScript**. Consecuencias:

- Los perfiles `preview` y `production` de `eas.json` ya fijan
  `https://fotoproy.apx5.com`; `development` **no** la fija, así el dev client
  sigue hablando con la API de tu LAN (la de `apps/mobile/.env`).
- Cambiar la URL de la API en el futuro **no obliga a un binario nuevo**: se
  publica una OTA con el valor nuevo (`EXPO_PUBLIC_API_URL=... pnpm --filter
@fotoproy/mobile update:prod`), siempre que el `runtimeVersion` no cambie.

---

## 5. Versionado

| Qué                        | Dónde                                                      | Regla                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Versión visible (`0.1.0`)  | `app.json` → `version`                                     | Subirla en cada release con cambios relevantes (semver aproximado).                                                                          |
| Build iOS / Android        | `app.json` → `ios.buildNumber`, `android.versionCode`      | `autoIncrement: true` en los perfiles `preview`/`production`: EAS los incrementa en cada build. No hay que tocarlos a mano.                  |
| Runtime de OTA             | `app.json` → `runtimeVersion.policy = appVersion`          | Sube junto con `version`. Cambios nativos ⇒ subir `version`.                                                                                 |
| **Esquema local (SQLite)** | `apps/mobile/lib/db/migrations.ts` (`PRAGMA user_version`) | Añadir migración nueva (nunca editar una aplicada) y probar el **upgrade real**: instalar la versión anterior y actualizar sin perder datos. |

Antes de publicar un binario: `pnpm typecheck && pnpm lint && pnpm --filter
@fotoproy/mobile exec expo export --platform android` (valida el bundle).

---

## 6. Qué falta y depende de terceros

- [ ] `eas login` + `eas init` + `update:configure` (escribe `projectId` y
      `updates.url` en `app.json`).
- [ ] Cuenta **Apple Developer** y **Google Play Console**.
- [ ] Primer `build:preview` en un dispositivo real (APK interno).
- [ ] TestFlight (iOS) y Play Internal Testing (Android).
- [ ] Probar una **OTA** real: cambiar un texto, `update:preview`, ver el cambio
      sin reinstalar.
- [ ] Probar el **upgrade del esquema local** (instalar la versión previa y
      actualizar conservando fotos pendientes de sincronizar).

## 7. Limitaciones conocidas

- **Visor PDF** (F3.0): requiere código nativo ⇒ dev client, no Expo Go.
  Pendiente en el backlog.
- **Vídeos grandes**: el tope de la app es 200 MB, pero mientras
  `minio-api.apx5.com` esté detrás del proxy de Cloudflare, el plan gratuito
  corta las subidas a **100 MB**. Pon ese host en **DNS only** para subirlos
  (ver [deployment.md](deployment.md) §3.3).
- **EXIF en vídeos**: no se re-codifican (haría falta ffmpeg); las fotos sí se
  limpian ([deployment.md](deployment.md) §7).
