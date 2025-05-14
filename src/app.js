const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { expressjwt: jwt } = require('express-jwt');
require('dotenv').config();

// Import utilities and middleware
const RedisCache = require('./utils/redis-cache');
const logger = require('./utils/logger');
const { createCircuitBreaker } = require('./utils/circuit-breaker');
const serviceRegistry = require('./config/service-registry');
const { authMiddleware, handleJwtError } = require('./middleware/auth.middleware');
const errorMiddleware = require('./middleware/error.middleware');
const { apiLimiter } = require('./middleware/rate-limit.middleware');
const { metricsMiddleware } = require('./middleware/metrics.middleware');

// Import controllers
const ProxyController = require('./controllers/proxy.controller');
const HealthController = require('./controllers/health.controller');

// Import routes
const initHealthRoutes = require('./routes/health.routes');
const initProxyRoutes = require('./routes/proxy.routes');

/**
 * Initialize the Express application
 */
function createApp() {
  const app = express();
  
  // Initialize Redis cache
  const redisCache = new RedisCache({
    prefix: 'api-gateway:',
    ttl: 3600 // 1 hour default TTL
  });
  
  // Initialize circuit breakers for each service
  const circuitBreakers = {};
  Object.keys(serviceRegistry.serviceMap).forEach(servicePath => {
    circuitBreakers[servicePath] = createCircuitBreaker(servicePath, logger);
  });
  
  // Initialize controllers
  const proxyController = new ProxyController(circuitBreakers, redisCache);
  const healthController = new HealthController(circuitBreakers);
  
  // Apply basic middleware first
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('combined', { stream: logger.stream }));
  
  // Apply metrics middleware (needs to be before rate limiting)
  app.use(metricsMiddleware);
  
  // Apply rate limiting
  app.use(apiLimiter);
  
  // Apply health routes (before auth so they're always accessible)
  app.use(initHealthRoutes(healthController));
  
  // Apply auth middleware
  app.use(authMiddleware);
  app.use(handleJwtError);
  
  // Apply proxy routes for API endpoints
  app.use(initProxyRoutes(proxyController));
  
  // Apply error middleware last
  app.use(errorMiddleware);
  
  // Attach Redis cache to app for server.js to access
  app.redisCache = redisCache;
  
  return app;
}

module.exports = createApp;
