# Guía de Configuración, Despliegue, Pruebas y Troubleshooting del Ambiente

Este documento proporciona una referencia integral sobre la arquitectura, especificaciones del colector, variables de entorno, comandos de operación, procedimientos de prueba y la bitácora técnica de resolución de problemas (**troubleshooting**) para la solución de observabilidad (**Node.js + Liferay + OpenTelemetry Collector + Dynatrace**).

---

## 1. Arquitectura de la Solución

El ecosistema captura trazas distribuidas, métricas y registros de logs estructurados en formato JSON desde la aplicación Node.js y los canaliza a través de la red interna de Docker hacia el colector OpenTelemetry para su despacho seguro a la plataforma SaaS de Dynatrace.

```
[ Cliente / Browser / Scripts de Prueba ]
                   │
                   ▼ (HTTP GET /api/data)
   ┌───────────────────────────────────────────────┐
   │         Node.js App (Puerto Host 3000)        │
   │  - Framework: Express 5                       │
   │  - Autoinstrumentación: HTTP, Express         │
   │  - Logger: Winston 3                          │
   │  - Puente OTLP: OpenTelemetryTransportV3      │
   │  - SDK: NodeSDK (Traces + Logs OTLP)          │
   └───────────────────────┬───────────────────────┘
                           │ (OTLP HTTP /v1/traces & /v1/logs)
                           ▼
   ┌───────────────────────────────────────────────┐
   │    OTel Collector (Puertos Host 4317/4318)    │
   │  - Imagen: otel/opentelemetry-collector-contrib│
   │  - Receiver: otlp (gRPC :4317, HTTP :4318)    │
   │  - Processors: memory_limiter, batch          │
   │  - Exporters: otlphttp (Dynatrace),           │
   │               debug (Consola local Docker)    │
   └───────────────────────┬───────────────────────┘
                           │ (HTTPS POST /api/v2/otlp/v1/...)
                           ▼
   ┌───────────────────────────────────────────────┐
   │                Dynatrace SaaS                 │
   │  - Ingesta y correlación de Trazas (Spans)    │
   │  - Ingesta de Logs con TraceId / SpanId       │
   │  - Monitoreo de Métricas y Rendimiento        │
   └───────────────────────────────────────────────┘
```

---

## 2. Especificaciones Técnicas del OpenTelemetry Collector

| Parámetro | Detalle de Configuración | Justificación Técnica |
| :--- | :--- | :--- |
| **Imagen Base** | `otel/opentelemetry-collector-contrib:latest` | Distribución comunitaria enriquecida. A diferencia de la versión *Core*, la distribución *Contrib* incluye exportadores hacia proveedores externos (como Dynatrace) y receptores/procesadores avanzados. |
| **Versión del Binario** | `v0.165.0` | Versión activa compilada en Go que gestiona los canales de memoria y despacho HTTP. |
| **Puertos de Red** | • `4317/TCP`: Protocolo OTLP gRPC.<br>• `4318/TCP`: Protocolo OTLP HTTP. | `node-app` utiliza el puerto `4318` para transmitir trazas y logs serializados en Protobuf. |
| **Red de Contenedores** | `telemetry-net` (Driver `bridge`). | Aísla la comunicación entre contenedores; permite resolución de nombres interna por DNS (`otel-collector`). |

### 2.1. Anatomía del Pipeline (`otel-collector-config.yaml`)

- **Receptores (`receivers`):**
  - `otlp`: Expone endpoints en `0.0.0.0:4317` (gRPC) y `0.0.0.0:4318` (HTTP).
- **Procesadores (`processors`):**
  - `memory_limiter`: Limita el uso de memoria a `512 MiB` con verificación cada `1s` y búfer de amortiguación de picos de `102 MiB`. Evita bloqueos del contenedor por saturación de RAM.
  - `batch`: Agrupa lotes de hasta `1000` elementos o con ventana de tiempo de `10s` para optimizar las peticiones HTTPS y evitar estrangulamiento de tasa (rate limiting).
- **Exportadores (`exporters`):**
  - `otlphttp/dynatrace`: Endpoint `https://xvq25071.live.dynatrace.com/api/v2/otlp`. OpenTelemetry añade automáticamente `/v1/traces`, `/v1/logs` y `/v1/metrics`. Se configuró un parámetro explícito `timeout: 30s` para garantizar la estabilidad frente a la latencia de negociación TLS.
  - `debug`: Registra en los logs de Docker (`verbosity: basic`) el conteo de elementos recibidos y enviados, sirviendo como sonda de monitoreo local.
- **Pipelines de Servicio (`service.pipelines`):**
  - `traces`: `[otlp] -> [memory_limiter, batch] -> [otlphttp/dynatrace, debug]`
  - `logs`: `[otlp] -> [memory_limiter, batch] -> [otlphttp/dynatrace, debug]`
  - `metrics`: `[otlp] -> [memory_limiter, batch] -> [otlphttp/dynatrace, debug]`

---

## 3. Matriz de Variables de Entorno y Configuración

| Variable / Parámetro | Contexto Local (Windows) | Contexto Contenedor (Docker Compose) | Descripción y Propósito |
| :--- | :--- | :--- | :--- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | `http://otel-collector:4318` | **Variable de soporte híbrido.** Resuelta en `instrumentation.js`. Permite ejecutar la aplicación en el host o en Docker sin alterar código fuente. |
| `PORT` | `3000` | `3000` | Puerto TCP de escucha del servidor web Express. |
| `serviceName` | `liferay-nodejs-service` | `liferay-nodejs-service` | Nombre lógico del servicio reportado a Dynatrace para filtros de trazabilidad y logs. |
| `Authorization` | *(Definido en YAML)* | *(Definido en YAML)* | Encabezado `Api-Token` con permisos de ingesta (`openTelemetryTrace.ingest`, `logs.ingest`, `metrics.ingest`). |

> [!TIP]
> **Recomendación para entornos de producción:** En despliegues productivos, es conveniente externalizar las credenciales de Dynatrace utilizando la sintaxis de sustitución de variables del colector:
> ```yaml
> endpoint: "${env:DT_ENDPOINT}"
> headers:
>   Authorization: "Api-Token ${env:DT_API_TOKEN}"
> ```
> Dichos valores pueden cargarse automáticamente mediante un archivo `.env` en Docker Compose.

---

## 4. Bitácora Detallada de Troubleshooting (Diagnóstico y Solución)

Durante la fase de preparación y validación se presentaron fallas en diferentes capas del ambiente. A continuación se detalla la metodología de diagnóstico, causa raíz y solución aplicada a cada una:

### Incidente 1: Bloqueo de Scripts en PowerShell (`ExecutionPolicy`)
- **Síntoma:** Al invocar comandos de inicialización, PowerShell emitía el error:
  ```text
  npm : No se puede cargar el archivo C:\Program Files\nodejs\npm.ps1 porque la ejecución de scripts está deshabilitada en este sistema.
  ```
- **Diagnóstico:** Se ejecutó `Get-ExecutionPolicy -List`, evidenciando que las directivas `CurrentUser` y `LocalMachine` se encontraban en estado `Undefined` (que en sistemas Windows clientes equivale por defecto a `Restricted`).
- **Causa Raíz:** Por motivos de seguridad, Windows bloquea la ejecución de scripts `.ps1` no firmados digitalmente.
- **Solución:** Se ajustó la política para el ámbito del usuario actual (sin requerir privilegios de administrador del sistema):
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  ```
- **Validación:** Comprobación exitosa con `node -v` (`v26.13.0`) y `npm -v` (`11.20.0`).

---

### Incidente 2: Falta de Paquetes y Manifiesto de Dependencias
- **Síntoma:** El proyecto contaba con el código fuente (`app.js`, `instrumentation.js`), pero carecía de `package.json` y del directorio `node_modules`.
- **Causa Raíz:** El entorno aún no había sido inicializado como proyecto Node.js estructurado.
- **Solución:** 
  1. Se generó el manifiesto base con `npm init -y`.
  2. Se instalaron las dependencias esenciales:
     ```powershell
     npm install express winston @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-proto @opentelemetry/exporter-logs-otlp-proto @opentelemetry/sdk-logs
     ```
- **Validación:** Se generó `package-lock.json` y se verificó la sintaxis con `node --check app.js` e `instrumentation.js`.

---

### Incidente 3: Conflicto de Socket en el Puerto 3000 (`EADDRINUSE`)
- **Síntoma:** Al levantar Docker Compose, el contenedor `otelliferay-node-app-1` fallaba con:
  ```text
  Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:3000 -> 127.0.0.1:0: listen tcp 0.0.0.0:3000: bind: Solo se permite un uso de cada dirección de socket
  ```
- **Diagnóstico:** Se ejecutó un rastreo de conexiones activas con PowerShell:
  ```powershell
  Get-NetTCPConnection -LocalPort 3000
  ```
  El comando identificó el proceso `PID 9116` en estado `Listen`. Al inspeccionar la línea de comandos mediante `Get-CimInstance Win32_Process -Filter "ProcessId = 9116"`, se confirmó que correspondía a una instancia manual de `node.exe --require ./instrumentation.js app.js` ejecutada directamente en Windows.
- **Causa Raíz:** Al correr en la máquina host, el proceso tomó el puerto 3000 de Windows, impidiendo que el motor de Docker enlazara el puerto del contenedor.
- **Solución:** Se detuvo el proceso local conflictivo:
  ```powershell
  Stop-Process -Id 9116 -Force
  ```
- **Validación:** El puerto quedó libre y Docker Compose pudo enlazar `0.0.0.0:3000` sin errores.

---

### Incidente 4: Falla de Resolución de Nombres de Dominio en el Host (DNS)
- **Síntoma:** La ejecución local del script intentaba conectarse a `http://otel-collector:4318`, fallando con errores de tipo `ENOTFOUND` o timeout.
- **Causa Raíz:** `otel-collector` es un nombre de host resoluble únicamente por el servidor DNS interno de la red Docker (`telemetry-net`). El sistema operativo Windows desconoce dicho nombre.
- **Solución:** Se actualizó `instrumentation.js` para desacoplar el endpoint:
  ```javascript
  const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  ```
  Y en `docker-compose.yml` se inyectó la variable correspondiente al contenedor:
  ```yaml
  environment:
    - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
  ```
- **Validación:** La aplicación ahora funciona tanto dentro del contenedor como fuera de él sin alterar el código fuente.

---

### Incidente 5: Pérdida Silenciosa de Logs en Winston (Falta de Transporte OTLP)
- **Síntoma:** El usuario reportó que no se visualizaban logs en Dynatrace a pesar de que la consola mostraba la inyección de `trace_id`.
- **Diagnóstico:** Se analizó `app.js` y se constató que Winston únicamente contenía el transporte `new winston.transports.Console()`.
- **Causa Raíz:** El paquete `@opentelemetry/auto-instrumentations-node` incluye `@opentelemetry/instrumentation-winston`, el cual **únicamente inyecta** las etiquetas `trace_id` y `span_id` en el objeto que Winston imprime en pantalla. En ningún momento desvía o emite esos registros hacia el `LogRecordProcessor` de OpenTelemetry.
- **Solución:**
  1. Se instaló el transporte oficial de OpenTelemetry para Winston:
     ```powershell
     npm install @opentelemetry/winston-transport
     ```
  2. En `app.js` se integró el transporte al crear el logger:
     ```javascript
     const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');

     const logger = winston.createLogger({
       level: 'info',
       format: winston.format.json(),
       transports: [
         new winston.transports.Console(),
         new OpenTelemetryTransportV3() // Emite directamente al SDK de OpenTelemetry
       ],
     });
     ```
- **Validación:** En cuanto se efectuaron peticiones, el colector comenzó a recibir lotes de logs (`signal: logs, log records: 8`).

---

### Incidente 6: Timeout en la Exportación HTTPS hacia Dynatrace
- **Síntoma:** Los logs del colector (`docker logs otelliferay-otel-collector-1`) reportaban fallas repetitivas:
  ```text
  Exporting failed. Will retry the request after interval. {"otelcol.component.id": "otlphttp/dynatrace", "error": "failed to make an HTTP request: Post \"https://xvq25071.live.dynatrace.com/api/v2/otlp/v1/traces\": net/http: TLS handshake timeout"}
  ```
- **Diagnóstico:** Las pruebas de conectividad desde el contenedor (`wget` y `https.get`) indicaron que el establecimiento de la sesión TLS tomaba entre 2.5 y 3 segundos en redes puente (bridge) bajo entornos virtualizados (WSL2 / Docker Desktop). El tiempo de espera predeterminado del colector cerraba la conexión prematuramente.
- **Causa Raíz:** Ausencia de un parámetro explícito de `timeout` en la definición del exportador `otlphttp`.
- **Solución:** En `otel-collector-config.yaml`, se extendió el tiempo de espera y se añadió el exportador `debug`:
  ```yaml
  exporters:
    otlphttp/dynatrace:
      endpoint: "https://xvq25071.live.dynatrace.com/api/v2/otlp"
      headers:
        Authorization: "Api-Token dt0s16.TOVMRJEO..."
      timeout: 30s
    debug:
      verbosity: basic
  ```
- **Validación:** Se reiniciaron los servicios y los reintentos cesaron. Los logs confirmaron el envío limpio de trazas, métricas y logs a Dynatrace sin demoras ni errores.

---

## 5. Estructura Final del Repositorio

```
C:\Users\PC01\OtelLiferay\
├── app.js                      # API Express con logging Winston + OpenTelemetryTransportV3
├── instrumentation.js          # Pre-carga del SDK OpenTelemetry (Traces y Logs desacoplados)
├── otel-collector-config.yaml  # Configuración del Collector (Dynatrace + Debug)
├── docker-compose.yml          # Orquestación de servicios (liferay, otel-collector, node-app)
├── package.json                # Manifiesto de dependencias npm
├── package-lock.json           # Registro de versiones fijadas
├── node_modules/               # Módulos instalados localmente
├── Info.txt                    # Comandos de referencia rápida
└── CONFIGURACION_AMBIENTE.md   # Este documento maestro
```

---

## 6. Procedimiento de Despliegue en Docker

Ejecuta estos comandos en tu consola PowerShell ubicándote en la raíz del proyecto (`C:\Users\PC01\OtelLiferay`):

### 6.1. Levantar los Contenedores
```powershell
docker compose up -d
```

### 6.2. Verificar el Estado de los Servicios
```powershell
docker compose ps
```
Los tres servicios deben encontrarse en estado `Up`:
- `otelliferay-node-app-1` (puerto `3000:3000`)
- `otelliferay-otel-collector-1` (puertos `4317:4317`, `4318:4318`)
- `otelliferay-liferay-1` (puerto `8080:8080`)

### 6.3. Monitorear los Registros en Vivo
- **Logs de la aplicación Node.js:**
  ```powershell
  docker compose logs -f node-app
  ```
- **Logs del colector OpenTelemetry:**
  ```powershell
  docker compose logs -f otel-collector
  ```

### 6.4. Detener o Reiniciar la Infraestructura
- **Reiniciar servicios tras cambios de configuración:**
  ```powershell
  docker compose restart node-app otel-collector
  ```
- **Apagar la solución completa:**
  ```powershell
  docker compose down
  ```

---

## 7. Procedimiento de Pruebas y Generación de Telemetría

Para validar la ingesta continua hacia Dynatrace, es necesario enviar tráfico al endpoint expuesto:

### 7.1. Prueba Unitaria Simple
```powershell
curl.exe http://localhost:3000/api/data
```
O mediante PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/data" -Method Get
```
Respuesta esperada:
```json
{"message":"Datos obtenidos correctamente"}
```

### 7.2. Generación de Lote de Tráfico (10 Peticiones)
```powershell
1..10 | ForEach-Object { 
    curl.exe -s http://localhost:3000/api/data 
    Write-Output "Peticion #$_ enviada exitosamente"
    Start-Sleep -Milliseconds 500
}
```

### 7.3. Generador Continuo de Telemetría (Prueba de Carga Ligera)
Ideal para observar la aparición de datos en tiempo real en la consola de Dynatrace:
```powershell
while ($true) { 
    curl.exe -s http://localhost:3000/api/data > $null
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 2 
}
# Presiona Ctrl + C en la consola para detener el envío
```

---

## 8. Verificación y Consulta en Dynatrace

### 8.1. En la Consola Docker (Confirmación Local)
Ejecuta:
```powershell
docker compose logs --tail 25 otel-collector
```
Debes observar confirmaciones del exportador `debug` con conteos incrementales:
```text
info    Logs    {"otelcol.component.id": "debug", "otelcol.signal": "logs", "log records": 8}
info    Traces  {"otelcol.component.id": "debug", "otelcol.signal": "traces", "spans": 12}
info    Metrics {"otelcol.component.id": "debug", "otelcol.signal": "metrics", "data points": 62}
```

### 8.2. En la Interfaz Web de Dynatrace
1. **Trazas Distribuidas (Distributed Tracing / Traces):**
   - Accede a **Distributed Tracing**.
   - Filtra por **Service**: `liferay-nodejs-service` o busca el endpoint `/api/data`.
   - Podrás ver el span raíz de Express y el tiempo de respuesta detallado.
2. **Visor de Logs (Logs & Events):**
   - Accede a la sección **Logs**.
   - Aplica el filtro:
     ```
     service.name = "liferay-nodejs-service"
     ```
   - Verás el mensaje: `"Procesando solicitud de datos en Node.js"`.
   - Al abrir el log, observarás las propiedades `trace_id` y `span_id`. Al hacer clic sobre el botón **"View Trace"**, Dynatrace te llevará directamente a la traza correlacionada.

---

## 9. Modo de Depuración Local (Opcional en Windows)

Si requieres depurar la aplicación en Visual Studio Code o en consola Windows sin el contenedor `node-app`:

1. Detén el contenedor de Node para liberar el puerto 3000:
   ```powershell
   docker compose stop node-app
   ```
2. Asegúrate de que el colector siga activo en Docker:
   ```powershell
   docker compose up -d otel-collector
   ```
3. Ejecuta la aplicación en tu consola local:
   ```powershell
   node --require ./instrumentation.js app.js
   ```
   *(El SDK detectará automáticamente `http://localhost:4318` y despachará la telemetría al colector de Docker, el cual continuará enviándola a Dynatrace).*
