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

## 6. APK local sin cuenta Expo (lo que se usó aquí)

Como alternativa a EAS Build, el APK se puede compilar en esta máquina. El
script `scripts/build-apk.sh` deja el toolchain preparado y usa ajustes
conservadores de memoria:

```bash
bash scripts/build-apk.sh                              # arm64 (recomendado)
ABIS="arm64-v8a,armeabi-v7a" bash scripts/build-apk.sh  # + equipos de 32 bits
PREPARE_ONLY=1 bash scripts/build-apk.sh               # solo verificar el toolchain
```

Salida: `~/fotoproy-builds/fotoproy-<versión>-<versionCode>.apk` y su log en la
misma carpeta (fuera de `/tmp`, para que un reinicio no lo borre).

Qué necesita (ya instalado en esta máquina, todo en carpetas de usuario, sin `sudo`):

| Pieza       | Ruta                              | Nota                                                           |
| ----------- | --------------------------------- | -------------------------------------------------------------- |
| JDK 17      | `~/tools/jdk17`                   | RN 0.86 **exige 17**; el JDK del sistema es 21/25 y falla.     |
| Android SDK | `~/Android/Sdk`                   | cmdline-tools + `platforms;android-36` + `build-tools;36.0.0`. |
| NDK         | `~/Android/Sdk/ndk/27.1.12297006` | Compilación C++ de la arquitectura nueva.                      |
| CMake       | `~/Android/Sdk/cmake/3.22.1`      | —                                                              |
| Cachés      | `~/.gradle` (≈3,6 GB)             | Ya descargadas: los siguientes builds son mucho más rápidos.   |

> ⚠️ **Por qué se colgó el primer intento**: no fue la CPU. Gradle por defecto
> lanza tantos workers como hilos tenga la máquina (**8** en este portátil) y
> CMake/Ninja compilan C++ en paralelo **por ABI**; yo lancé **4 ABIs** con un heap
> de Gradle de **3 GB** más el daemon de Kotlin, con solo ~5 GB libres y 2 GB de
> swap. El kernel empujó todo a swap, saturó el disco y la sesión dejó de
> responder. `kern.log` no registra ningún OOM-killer: no hubo un proceso
> sacrificado, hubo _thrashing_, que para la usabilidad es peor.

El script limita por defecto a **una ABI**, **2 workers**, heap **2 GB**,
`--no-daemon`, y añade **techos duros** verificados:

| Tope          | Cómo                                                        | Valor por defecto  |
| ------------- | ----------------------------------------------------------- | ------------------ |
| CPU           | `taskset -c 0-2` (la CPU siempre conserva 5 hilos libres)   | 3 hilos            |
| Memoria       | cgroup propio vía `systemd-run --user --scope -p MemoryMax` | 6 GB (swap 1 GB)   |
| Prioridad     | `nice -n 10` + `ionice -c2 -n7`                             | el escritorio gana |
| Paralelismo   | `--max-workers=2`                                           | 2 tareas           |
| Memoria libre | aborta antes de empezar si hay < 4 GB                       | —                  |

> Nota: en la sesión de usuario de este equipo el controlador de CPU **no está
> delegado** (`CPUQuota` se ignora), por eso el tope de CPU se aplica con
> `taskset`, que sí funciona. La memoria sí se limita por cgroup. Si el build se
> pasa de memoria, muere **dentro de su cgroup**: se pierde el build, no la
> sesión.

Ajustes: `CPUS=0-3`, `MEMORY_MAX=8G`, `MAX_WORKERS=4` (más rápido y más pesado) o
`ABIS=arm64-v8a MAX_WORKERS=1` (lo más ligero). `SANDBOX=0` quita los cgroup.

Verificaciones que hace el script al terminar: `aapt2 dump badging` (paquete,
`versionCode`, SDKs), `apksigner` (firma) y **comprobación de que
`EXPO_PUBLIC_API_URL` quedó dentro del bundle** — si el APK apunta a la IP de la
LAN, termina con error en vez de entregar un APK inservible.

### La trampa del bundle (ya resuelta en el script)

El bundle JS lo genera una tarea de Gradle cuyo _up-to-date check_ **no mira las
variables `EXPO_PUBLIC_*`**: si ya existía un bundle de un build anterior, se
reutiliza con la URL vieja. Pasó de verdad — el primer APK quedó apuntando a la
IP de la LAN — y solo se detectó porque el script ahora **busca la URL dentro del
APK** al terminar.

Por eso `scripts/build-apk.sh` borra el bundle generado antes de compilar y, al
final, verifica que `EXPO_PUBLIC_API_URL` esté dentro del APK (si no, termina con
error en lugar de entregar un APK inservible). Además `apps/mobile/lib/api.ts`
usa un valor por defecto distinto según el entorno: la LAN en desarrollo, el
dominio público en release.

Limitaciones del APK local:

- Va firmado con el **keystore de debug** del proyecto: sirve para sideload, no
  para publicar en Play (para eso, EAS con un keystore propio).
- Para iOS hace falta un Mac o EAS Build.
- El `versionCode` es el de `app.json`: **súbelo a mano** en cada entrega nueva
  (EAS lo incrementa solo con `autoIncrement`, el build local no).

---

## 7. Qué falta y depende de terceros

- [ ] `eas login` + `eas init` + `update:configure` (escribe `projectId` y
      `updates.url` en `app.json`).
- [ ] Cuenta **Apple Developer** y **Google Play Console**.
- [ ] Primer `build:preview` en un dispositivo real (APK interno).
- [ ] TestFlight (iOS) y Play Internal Testing (Android).
- [ ] Probar una **OTA** real: cambiar un texto, `update:preview`, ver el cambio
      sin reinstalar.
- [ ] Probar el **upgrade del esquema local** (instalar la versión previa y
      actualizar conservando fotos pendientes de sincronizar).

## 8. Limitaciones conocidas

- **Visor PDF** (F3.0): requiere código nativo ⇒ dev client, no Expo Go.
  Pendiente en el backlog.
- **Vídeos grandes**: el tope de la app es 200 MB, pero mientras
  `minio-api.apx5.com` esté detrás del proxy de Cloudflare, el plan gratuito
  corta las subidas a **100 MB**. Pon ese host en **DNS only** para subirlos
  (ver [deployment.md](deployment.md) §3.3).
- **EXIF en vídeos**: no se re-codifican (haría falta ffmpeg); las fotos sí se
  limpian ([deployment.md](deployment.md) §7).
