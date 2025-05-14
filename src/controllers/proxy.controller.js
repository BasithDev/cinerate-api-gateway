const logger = require('../utils/logger');
const serviceRegistry = require('../config/service-registry');
const { metrics } = require('../middleware/metrics.middleware');

/**
 * Proxy Controller
 * Handles forwarding requests to appropriate microservices
 */
class ProxyController {
  constructor(circuitBreakers, redisCache) {
    this.circuitBreakers = circuitBreakers;
    this.redisCache = redisCache;
    this.serviceMap = serviceRegistry.serviceMap;
  }

  /**
   * Handle proxying a request to the appropriate microservice
   */
  async proxyRequest(req, res) {
    // Get the service type from the request (set by the router)
    let basePath = null;
    
    if (req.serviceType === 'user') {
      basePath = '/api/user';
    } else if (req.serviceType === 'review') {
      basePath = '/api/review';
    } else if (req.serviceType === 'watchlist') {
      basePath = '/api/watchlist';
    }
    
    const serviceURL = basePath ? this.serviceMap[basePath] : null;

    if (!serviceURL) {
      return res.status(404).json({ error: 'Service not found' });
    }

    try {
      // For GET requests, check cache first
      if (req.method === 'GET' && this.redisCache.connected) {
        // Skip caching for health endpoints
        if (req.path.includes('/health')) {
          // Forward directly to service without caching
          return await this.forwardRequest(req, res, serviceURL);
        }
        
        // Use different cache keys for authenticated vs non-authenticated requests
        const userId = req.user?.id || 'anonymous';
        const cacheKey = userId !== 'anonymous' ? `${userId}:${req.originalUrl}` : req.originalUrl;
        
        try {
          const cachedData = await this.redisCache.get(cacheKey);
          
          if (cachedData) {
            logger.info({
              type: 'cache',
              result: 'hit',
              path: req.originalUrl,
              userId: userId
            });
            res.setHeader('X-Cache', 'HIT');
            return res.json(cachedData);
          }
          
          logger.info({
            type: 'cache',
            result: 'miss',
            path: req.originalUrl,
            userId: userId
          });
          res.setHeader('X-Cache', 'MISS');
        } catch (cacheError) {
          logger.error({
            type: 'cache_error',
            error: cacheError.message,
            path: req.originalUrl
          });
          // Continue without caching if there's an error
        }
      }

      // Construct the URL for the microservice request
      // We need to preserve the path after the base path
      const pathSuffix = req.originalUrl.substring(basePath.length) || '/';
      const url = serviceURL + pathSuffix;
      const circuitBreaker = this.circuitBreakers[basePath];
      
      // Record start time for metrics
      const startTime = Date.now();
      
      const response = await circuitBreaker.fire(url, req.method, req.body);
      
      // Record response time for metrics
      const responseTime = (Date.now() - startTime) / 1000; // in seconds
      metrics.serviceResponseTime.observe(
        { service: basePath, endpoint: req.path, status_code: response.status },
        responseTime
      );
      
      if (response.data && response.data.fallback) {
        res.setHeader('X-Fallback-Response', 'true');
      }
      
      // Cache successful GET responses
      if (req.method === 'GET' && this.redisCache.connected && response.status >= 200 && response.status < 300) {
        const userId = req.user?.id || 'anonymous';
        const cacheKey = userId !== 'anonymous' ? `${userId}:${req.originalUrl}` : req.originalUrl;
        
        // Set cache TTL based on the type of data
        let cacheTTL = 1800; // Default 30 minutes
        
        // Different TTLs for different types of resources
        if (req.serviceType === 'user') {
          cacheTTL = 3600; // User data: 1 hour
        } else if (req.serviceType === 'review') {
          cacheTTL = 900; // Reviews: 15 minutes
        } else if (req.serviceType === 'watchlist') {
          cacheTTL = 1200; // Watchlists: 20 minutes
        }
        
        try {
          await this.redisCache.set(cacheKey, response.data, cacheTTL);
          logger.info({
            type: 'cache',
            action: 'store',
            path: req.originalUrl,
            ttl: cacheTTL
          });
        } catch (cacheError) {
          logger.error({
            type: 'cache_error',
            action: 'store',
            error: cacheError.message,
            path: req.originalUrl
          });
        }
      }
      
      // For write operations (POST, PUT, DELETE), invalidate related caches
      if (req.method !== 'GET' && this.redisCache.connected) {
        try {
          // Determine which cache pattern to invalidate based on the service type
          const userId = req.user?.id || 'anonymous';
          if (userId !== 'anonymous') {
            if (req.serviceType === 'user') {
              await this.redisCache.invalidateByPattern(`${userId}:*`);
            } else if (req.serviceType === 'review') {
              await this.redisCache.invalidateByPattern(`${userId}:*/api/review*`);
            } else if (req.serviceType === 'watchlist') {
              await this.redisCache.invalidateByPattern(`${userId}:*/api/watchlist*`);
            }
            
            logger.info({
              type: 'cache',
              action: 'invalidate',
              userId: userId,
              path: req.originalUrl
            });
          }
        } catch (invalidateError) {
          logger.error({
            type: 'cache_error',
            action: 'invalidate',
            error: invalidateError.message,
            path: req.originalUrl
          });
        }
      }
      
      return res.status(response.status).send(response.data);
    } catch (err) {
      if (err.type === 'open') {
        logger.error(`Service ${basePath} circuit is open, failing fast`);
        return res.status(503).json({ error: 'Service temporarily unavailable' });
      } else if (err.type === 'timeout') {
        logger.error(`Request to ${basePath} timed out`);
        return res.status(504).json({ error: 'Service request timed out' });
      }
      
      logger.error(`Error calling ${basePath}: ${err.message}`);
      return res.status(err.response?.status || 500).json(err.response?.data || { error: 'Internal Gateway Error' });
    }
  }
}

module.exports = ProxyController;
