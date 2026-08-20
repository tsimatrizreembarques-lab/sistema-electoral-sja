# Sistema Electoral SJA

Sistema de control de asistencia y movilización electoral para San José de los
Arroyos. Registra el paso de cada votante por el **Puesto de Comando** y por
la **Mesa de votación**, evitando el doble conteo, y da a cada **concejal**
un dashboard en vivo de su propia lista. **No registra voto ni intención de
voto.**

Funciona **100% offline** en cada dispositivo de campo (comando/mesa) y
sincroniza automáticamente contra la nube apenas hay señal — no depende de
red local ni de que otros dispositivos estén conectados.

---

## 1. Requisitos previos

- Un proyecto de Google Cloud (podés usar el mismo que ya tenés para
  `sistema-turnos-pro`, o uno nuevo).
- Firestore **habilitado** en ese proyecto (modo nativo).
- Una cuenta de servicio con permisos de **Cloud Datastore User** (Firestore)
  y, si querés el respaldo en Sheets, también con la **Google Sheets API**
  habilitada y compartida en la planilla de respaldo.
- Node.js instalado si vas a probar localmente antes de desplegar.

---

## 2. Preparar Firestore y la cuenta de servicio

1. En Google Cloud Console → Firestore → crear base de datos (modo nativo,
   la región que uses en tus otros proyectos, ej. `southamerica-east1`).
2. IAM y administración → Cuentas de servicio → crear una nueva (o reusar la
   de `sistema-turnos-pro`) con el rol **Cloud Datastore User**.
3. Generar una clave JSON de esa cuenta de servicio — el contenido completo
   de ese archivo va a la variable `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT`.
4. (Opcional, para el respaldo) Crear una Google Sheet nueva, compartirla con
   el email de la cuenta de servicio (permiso de Editor), y copiar su ID
   (el que aparece en la URL) a `GOOGLE_SHEET_ID_BACKUP`.

---

## 3. Desplegar en Cloud Run (desde Cloud Shell, sin GitHub)

```bash
# 1. Subí la carpeta del proyecto a tu Cloud Shell (arrastrar y soltar,
#    o gcloud cloud-shell scp si preferís)

cd sistema-electoral-sja

# 2. Desplegar directamente desde el código fuente
gcloud run deploy sistema-electoral-sja \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --set-env-vars JWT_SECRET="TU_SECRETO_LARGO_Y_ALEATORIO" \
  --set-env-vars GOOGLE_SHEET_ID_BACKUP="TU_SHEET_ID"

# 3. Cargar el JSON de la cuenta de servicio como variable de entorno
#    (mejor como secreto, pero tambien podes pasarlo directo si preferis
#    replicar el patron de sistema-turnos-pro):
gcloud run services update sistema-electoral-sja \
  --region southamerica-east1 \
  --update-env-vars GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT="$(cat ruta/a/tu-credencial.json | tr -d '\n')"
```

Al terminar, Cloud Run te da una URL pública (`https://sistema-electoral-sja-xxxxx.run.app`).
Esa es la URL que vas a abrir desde los celulares y PCs de campo.

---

## 4. Cargar los datos (una sola vez, antes del día de la elección)

Estos scripts corren **localmente** (en tu Cloud Shell o tu PC), apuntando
directo a Firestore — no hace falta que el servicio esté corriendo.

```bash
# Necesitas las mismas variables de entorno en tu terminal local:
export GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT="$(cat ruta/a/tu-credencial.json)"

npm install

# 1. Padron general (columnas: CEDULA, ORDEN, NOMBRES_APELLIDOS, MESA, LOCAL)
npm run import:padron -- /ruta/al/padron.xlsx

# 2. Concejales (columnas: NOMBRE_CONCEJAL, LISTA)
npm run import:concejales -- /ruta/al/concejales.xlsx

# 3. Listas de votantes por concejal (columnas: CEDULA, NOMBRE_CONCEJAL, LISTA)
#    Esto imprime un reporte de cuantas cedulas quedaron duplicadas entre
#    concejales — es normal, se resuelven en vivo el dia de la eleccion.
npm run import:votantes-concejal -- /ruta/al/votantes_concejal.xlsx
```

---

## 5. Crear los usuarios (uno por puesto de trabajo)

```bash
# Comando (uno por local)
node scripts/create-user.js comando comando-esc49 "clave-segura-1" "ESC.NRO.49"
node scripts/create-user.js comando comando-sanantonio "clave-segura-2" "ESC.GRDA.NRO.1014 SAN ANTONIO"
node scripts/create-user.js comando comando-yhaca "clave-segura-3" "LIC.NACIONAL DE YHACA"

# Mesa (una por cada mesa que se abra — repetir para cada una)
node scripts/create-user.js mesa mesa-esc49-1 "clave-mesa" "ESC.NRO.49" 1
node scripts/create-user.js mesa mesa-esc49-2 "clave-mesa" "ESC.NRO.49" 2
# ... etc, una por cada mesa de los 3 locales

# Concejal (uno por concejal, el nombre debe coincidir EXACTO con el de la
# tabla de concejales cargada)
node scripts/create-user.js concejal concejal-carlos "clave-concejal" "" "" "CARLOS CESAR VELAZQUEZ APURIL"

# Administrador (vos)
node scripts/create-user.js admin admin "tu-clave-de-admin"
```

---

## 6. Instalar la app en cada dispositivo (antes del día de la elección, CON internet)

1. Abrir la URL de Cloud Run en Chrome (Android) o el navegador que uses.
2. Iniciar sesión con el usuario/clave de ese puesto (comando, mesa o
   concejal). Al loguearse por primera vez, la app descarga automáticamente
   todo lo que necesita para funcionar sin conexión.
3. Menú del navegador → **"Agregar a pantalla de inicio"** (o el navegador va
   a sugerirlo solo). Queda instalada como una app normal.
4. **Importante**: probar el modo offline ANTES del día de la elección —
   activar modo avión, buscar una cédula de prueba, registrarla, y verificar
   que al reconectar se sincroniza sola (el indicador de arriba dice "Todo
   sincronizado").

---

## 7. El día de la elección

- Cada dispositivo funciona de forma independiente, con su propia señal de
  datos (o sin señal, guardando localmente).
- El puesto de comando busca la cédula → el sistema indica local + mesa (y
  resuelve en el momento si hay más de un concejal preasignado) → el
  operador dirige verbalmente al votante.
- El veedor de cada mesa confirma cuando la persona efectivamente pasa.
- Vos (admin) podés ver el avance en vivo en `/` con tu usuario de admin,
  desde cualquier dispositivo con conexión.
- Cada concejal ve su propio avance desde su usuario, en vivo.

---

## Estructura del proyecto

```
server.js                  Servidor Express
src/lib/                   Firestore, autenticacion, respaldo en Sheets, utils
src/routes/                Endpoints de la API (auth, votantes, dashboard)
scripts/                   Importacion de datos y creacion de usuarios
public/                    La PWA (HTML/CSS/JS + service worker + manifest)
public/js/db-local.js      Almacenamiento offline en cada dispositivo (IndexedDB)
public/js/sync.js          Sincronizacion automatica de la cola offline
```
