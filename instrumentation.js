// instrumentation.js
const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');

// Nuevas importaciones para logs
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new opentelemetry.NodeSDK({
  serviceName: 'liferay-nodejs-service',
  
  // Exportador de Trazas
  traceExporter: new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`
  }),
  
  // Nuevo: Procesador y Exportador de Logs
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: `${OTLP_ENDPOINT}/v1/logs`
    })
  ),
  
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();
console.log('OpenTelemetry SDK inicializado con soporte para logs.');