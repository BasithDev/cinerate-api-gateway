const createApp = require('./app');
const logger = require('./utils/logger');

/**
 * Start the server and handle graceful shutdown
 */
async function startServer() {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  
  // Connect to Redis before starting the server
  try {
    await app.redisCache.connect();
    logger.info('Connected to Redis cache');
  } catch (error) {
    logger.warn(`Failed to connect to Redis: ${error.message}`);
    logger.info('API Gateway will operate without caching');
  }
  
  // Start the server
  const server = app.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);
  });
  
  // Handle graceful shutdown
  setupGracefulShutdown(server, app.redisCache);
  
  return server;
}

/**
 * Set up handlers for graceful shutdown
 */
function setupGracefulShutdown(server, redisCache) {
  // Handle SIGTERM
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await gracefulShutdown(server, redisCache);
  });
  
  // Handle SIGINT
  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await gracefulShutdown(server, redisCache);
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
    await gracefulShutdown(server, redisCache);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error(`Unhandled promise rejection: ${reason}`);
    await gracefulShutdown(server, redisCache);
  });
}

/**
 * Perform graceful shutdown
 */
async function gracefulShutdown(server, redisCache) {
  // Close the HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close Redis connection if it exists
  if (redisCache && redisCache.connected) {
    try {
      await redisCache.close();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error(`Error closing Redis connection: ${error.message}`);
    }
  }
  
  // Exit process
  process.exit(0);
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer().catch(error => {
    logger.error(`Failed to start server: ${error.message}`, { stack: error.stack });
    process.exit(1);
  });
}

module.exports = { startServer };
