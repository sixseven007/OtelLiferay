// app.js
const express = require('express');
const winston = require('winston');
const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');
const app = express();
const PORT = 3000;

// Configuración básica de Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new OpenTelemetryTransportV3()
  ],
});

app.get('/api/data', (req, res) => {
  // Este log será interceptado, se le inyectará el trace_id actual y se enviará a Dynatrace
  logger.info('Procesando solicitud de datos en Node.js', { endpoint: '/api/data' });
  
  res.json({ message: 'Datos obtenidos correctamente' });
});

app.listen(PORT, () => {
  logger.info(`Servidor Node.js escuchando en el puerto ${PORT}`);
});