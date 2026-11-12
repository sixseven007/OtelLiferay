# Solución de Observabilidad: Liferay + Node.js + OpenTelemetry Collector + Dynatrace

Solución completa y contenerizada para la captura, procesamiento y exportación de trazas distribuidas, métricas y registros de logs estructurados hacia **Dynatrace SaaS** utilizando **OpenTelemetry**.

---

## 🏗️ Arquitectura del Sistema

```
[ Cliente / Browser ] ──(HTTP GET)──► [ Node.js App (:3000) ]
                                              │ (OTLP HTTP /v1/traces, /v1/logs)
                                              ▼
[ Liferay Portal (:8080) ]            [ OTel Collector (:4317/:4318) ]
                                              │ (HTTPS POST)
                                              ▼
                                      [ Dynatrace SaaS ]
```

---

## 📦 Contenido del Repositorio

- **`docker-compose.yml`**: Orquestación de servicios (`liferay`, `otel-collector`, `node-app`).
- **`app.js`**: Servidor API Express con logging estructurado Winston y puente a OpenTelemetry.
- **`instrumentation.js`**: Inicialización del SDK de OpenTelemetry con soporte híbrido para ejecución local y contenerizada.
- **`otel-collector-config.yaml`**: Configuración de pipelines, receptores OTLP, procesador batch y exportador a Dynatrace.
- **`CONFIGURACION_AMBIENTE.md`**: Manual técnico exhaustivo con bitácora de troubleshooting, variables de entorno y pruebas.
- **`.env.example`**: Plantilla de variables de entorno para configuración segura de credenciales de Dynatrace.

---

## 🚀 Inicio Rápido

### 1. Configurar Variables de Entorno
Copia la plantilla y configura tus credenciales de Dynatrace:
```bash
cp .env.example .env
```
Edita `.env` con el endpoint de tu tenant y tu token de API con permisos de ingesta (`openTelemetryTrace.ingest`, `logs.ingest`, `metrics.ingest`):
```env
DT_ENDPOINT=https://{your-environment-id}.live.dynatrace.com/api/v2/otlp
DT_API_TOKEN={your-dynatrace-api-token}
```

### 2. Desplegar la Solución con Docker Compose
```powershell
docker compose up -d
```

### 3. Verificar Servicios
```powershell
docker compose ps
```

### 4. Generar Telemetría de Prueba
```powershell
curl.exe http://localhost:3000/api/data
```

Revisa los logs del colector para confirmar la exportación a Dynatrace:
```powershell
docker compose logs --tail 30 otel-collector
```

---

## 📖 Documentación Detallada
Para consultar las especificaciones completas, bitácora de resolución de problemas e instrucciones paso a paso, consulta el archivo [CONFIGURACION_AMBIENTE.md](CONFIGURACION_AMBIENTE.md).
