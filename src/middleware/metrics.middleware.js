const promBundle = require('express-prom-bundle');
const client = require('prom-client');

// Create a custom registry
const register = new client.Registry();

// Add default metrics to the registry
client.collectDefaultMetrics({ register });

// Create custom metrics
const serviceResponseTime = new client.Histogram({
  name: 'api_gateway_service_response_time',
  help: 'Response time of downstream services in seconds',
  labelNames: ['service', 'endpoint', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register]
});

const circuitBreakerState = new client.Gauge({
  name: 'api_gateway_circuit_breaker_state',
  help: 'State of circuit breakers (0: closed, 1: half-open, 2: open)',
  labelNames: ['service'],
  registers: [register]
});

const cacheHitRatio = new client.Gauge({
  name: 'api_gateway_cache_hit_ratio',
  help: 'Cache hit ratio for the API Gateway',
  labelNames: ['service'],
  registers: [register]
});

// Create the middleware
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  customLabels: { app: 'api-gateway' },
  promClient: { register },
  promRegistry: register,
  metricsPath: '/metrics',
  normalizePath: [
    ['^/api/user/.*', '/api/user/:id'],
    ['^/api/review/.*', '/api/review/:id'],
    ['^/api/watchlist/.*', '/api/watchlist/:id']
  ]
});

module.exports = {
  metricsMiddleware,
  register,
  metrics: {
    serviceResponseTime,
    circuitBreakerState,
    cacheHitRatio
  }
};
