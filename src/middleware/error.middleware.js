const logger = require('../utils/logger');

/**
 * Global error handling middleware
 * Catches all errors and returns appropriate response
 */
function errorMiddleware(err, req, res, next) {
  // Log the error
  logger.error({
    message: `Error processing request: ${err.message}`,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Send error response
  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: statusCode,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = errorMiddleware;
