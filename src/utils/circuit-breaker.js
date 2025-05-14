const CircuitBreaker = require('opossum');
const retry = require('async-retry');
const axios = require('axios');

/**
 * Creates a circuit breaker for a specific service path
 * @param {string} servicePath - The base path of the service (e.g., '/api/user')
 * @param {Object} logger - Logger instance
 * @returns {CircuitBreaker} - Configured circuit breaker instance
 */
function createCircuitBreaker(servicePath, logger) {
  // Default retry options
  const retryOptions = {
    retries: 3,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 5000,
    randomize: true,
    onRetry: (error, attempt) => {
      logger.warn(`Retry attempt ${attempt} for ${servicePath} due to: ${error.message}`);
    }
  };

  // Default circuit breaker options
  const circuitBreakerOptions = {
    timeout: 5000, // Time in ms before request is considered failed
    errorThresholdPercentage: 50, // When 50% of requests fail, open the circuit
    resetTimeout: 30000, // Time to wait before testing if service is available again
    rollingCountTimeout: 60000, // Time window for error rate calculation
    rollingCountBuckets: 10 // Number of buckets for error rate calculation
  };

  // Create the circuit breaker
  const breaker = new CircuitBreaker(
    async (url, method, data) => {
      return await retry(async (bail, attempt) => {
        try {
          logger.info(`Request attempt ${attempt} to ${url}`);
          const response = await axios({
            url,
            method,
            data,
            timeout: 2500
          });
          return response;
        } catch (err) {
          if (err.response && err.response.status >= 400 && err.response.status < 500) {
            bail(err);
            return;
          }
          throw err;
        }
      }, retryOptions);
    }, 
    circuitBreakerOptions
  );

  // Configure fallbacks based on service type
  if (servicePath === '/api/user') {
    breaker.fallback(() => {
      return {
        status: 503,
        data: { error: 'User service temporarily unavailable', fallback: true }
      };
    });
  } else if (servicePath === '/api/review') {
    breaker.fallback(() => {
      return {
        status: 503,
        data: { reviews: [], fallback: true, message: 'Review service temporarily unavailable' }
      };
    });
  } else if (servicePath === '/api/watchlist') {
    breaker.fallback(() => {
      return {
        status: 503,
        data: { watchlist: [], fallback: true, message: 'Watchlist service temporarily unavailable' }
      };
    });
  }

  // Set up event listeners
  breaker.on('open', () => {
    logger.warn(`Circuit breaker for ${servicePath} is now OPEN`);
  });

  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker for ${servicePath} is now HALF-OPEN`);
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker for ${servicePath} is now CLOSED`);
  });

  breaker.on('fallback', () => {
    logger.warn(`Fallback triggered for ${servicePath}`);
  });

  return breaker;
}

module.exports = { createCircuitBreaker };
