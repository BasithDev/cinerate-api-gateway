const { createClient } = require('redis');
const CircuitBreaker = require('opossum');

class RedisCache {
  constructor(options = {}) {
    this.ttl = options.ttl || 3600; // Default TTL: 1 hour
    this.prefix = options.prefix || 'api-gateway:';
    this.client = null;
    this.connected = false;
    this.circuitBreaker = null;
    this.redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    this.testMode = process.env.NODE_ENV === 'test';
    
    // Initialize circuit breaker for Redis operations
    this.initCircuitBreaker();
  }

  async connect() {
    if (this.connected) return;
    
    // Skip actual Redis connection in test mode
    if (this.testMode) {
      console.log('Running in test mode - skipping Redis connection');
      return;
    }

    try {
      this.client = createClient({
        url: this.redisUrl
      });

      // Set up event handlers
      this.client.on('error', (err) => {
        console.error('Redis error:', err);
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
      });

      this.client.on('reconnecting', () => {
        console.log('Reconnecting to Redis...');
      });

      // Connect to Redis (the 'connect' event will log the success)
      await this.client.connect();
      this.connected = true;

      // Promisify Redis methods
      this.getAsync = this.client.get.bind(this.client);
      this.setAsync = this.client.set.bind(this.client);
      this.delAsync = this.client.del.bind(this.client);
      this.expireAsync = this.client.expire.bind(this.client);
      this.flushAsync = this.client.flushAll.bind(this.client);
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.connected = false;
      throw error;
    }
  }

  initCircuitBreaker() {
    const options = {
      failureThreshold: 50,
      resetTimeout: 10000,
      timeout: 3000,
      errorThresholdPercentage: 50
    };

    this.circuitBreaker = new CircuitBreaker(async (operation) => {
      if (!this.connected) {
        await this.connect();
      }
      return await operation();
    }, options);

    this.circuitBreaker.on('open', () => {
      console.log('Redis circuit breaker opened');
    });

    this.circuitBreaker.on('close', () => {
      console.log('Redis circuit breaker closed');
    });

    this.circuitBreaker.on('halfOpen', () => {
      console.log('Redis circuit breaker half-open');
    });

    this.circuitBreaker.fallback(() => {
      console.log('Redis fallback triggered');
      return null; // Return null when Redis is unavailable
    });
  }

  getKey(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    if (this.testMode) return null;
    
    return this.circuitBreaker.fire(async () => {
      if (!this.connected || !this.client) return null;
      
      const value = await this.getAsync(this.getKey(key));
      if (value) {
        try {
          return JSON.parse(value);
        } catch (e) {
          return value; // Return as-is if not JSON
        }
      }
      return null;
    });
  }

  async set(key, value, ttl = this.ttl) {
    if (this.testMode) return 'OK';
    
    return this.circuitBreaker.fire(async () => {
      if (!this.connected || !this.client) return 'OK';
      
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await this.setAsync(this.getKey(key), stringValue, {
        EX: ttl
      });
    });
  }

  async del(key) {
    if (this.testMode) return 1;
    
    return this.circuitBreaker.fire(async () => {
      if (!this.connected || !this.client) return 1;
      
      return await this.delAsync(this.getKey(key));
    });
  }

  async flush() {
    if (this.testMode) return 'OK';
    
    return this.circuitBreaker.fire(async () => {
      if (!this.connected || !this.client) return 'OK';
      
      return await this.flushAsync();
    });
  }

  async close() {
    if (this.client && this.connected) {
      await this.client.quit();
      this.connected = false;
      // Let the shutdown handler log the closure
    }
  }

  // Cache middleware for Express routes
  cacheMiddleware(ttl = this.ttl) {
    return async (req, res, next) => {
      // Skip caching for non-GET requests or in test mode
      if (req.method !== 'GET' || this.testMode) {
        return next();
      }

      // Skip caching for authenticated routes that are user-specific
      if (req.user && req.user.id) {
        const key = `${req.user.id}:${req.originalUrl}`;
        try {
          const cachedData = await this.get(key);
          
          if (cachedData) {
            console.log(`Cache hit for ${key}`);
            res.setHeader('X-Cache', 'HIT');
            return res.json(cachedData);
          }

          console.log(`Cache miss for ${key}`);
          res.setHeader('X-Cache', 'MISS');

          // Store original res.json method
          const originalJson = res.json;

          // Override res.json method to cache the response
          res.json = async (data) => {
            // Cache the response data
            await this.set(key, data, ttl);
            
            // Call the original json method
            return originalJson.call(res, data);
          };

          next();
        } catch (error) {
          console.error('Cache middleware error:', error);
          next(); // Continue without caching on error
        }
      } else {
        // For public routes
        const key = `${req.originalUrl}`;
        
        try {
          const cachedData = await this.get(key);
          
          if (cachedData) {
            console.log(`Cache hit for ${key}`);
            res.setHeader('X-Cache', 'HIT');
            return res.json(cachedData);
          }

          console.log(`Cache miss for ${key}`);
          res.setHeader('X-Cache', 'MISS');

          // Store original res.json method
          const originalJson = res.json;

          // Override res.json method to cache the response
          res.json = async (data) => {
            // Cache the response data
            await this.set(key, data, ttl);
            
            // Call the original json method
            return originalJson.call(res, data);
          };

          next();
        } catch (error) {
          console.error('Cache middleware error:', error);
          next(); // Continue without caching on error
        }
      }
    };
  }

  // Helper to invalidate cache by pattern
  async invalidateByPattern(pattern) {
    if (this.testMode) return 0;
    
    return this.circuitBreaker.fire(async () => {
      if (!this.connected || !this.client) return 0;
      
      const keys = await this.client.keys(`${this.prefix}${pattern}`);
      if (keys.length > 0) {
        return await this.client.del(keys);
      }
      return 0;
    });
  }

  // Helper to invalidate user-specific cache
  async invalidateUserCache(userId) {
    if (this.testMode) return 0;
    return this.invalidateByPattern(`${userId}:*`);
  }
}

module.exports = RedisCache;
