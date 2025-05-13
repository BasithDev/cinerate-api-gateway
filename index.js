const express = require('express');
const winston = require('winston');
const {expressjwt: jwtMiddleware} = require('express-jwt');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv').config();
const axios = require('axios');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const CircuitBreaker = require('opossum');
const retry = require('async-retry');
const RedisCache = require('./redis-cache');
const app = express();

app.use(express.json());

// Initialize Redis cache
const redisCache = new RedisCache({
  prefix: 'api-gateway:',
  ttl: 1800 // 30 minutes default TTL
});

// Connect to Redis
redisCache.connect().catch(err => {
  console.warn('Warning: Could not connect to Redis:', err.message);
  console.warn('API Gateway will run without caching');
});

//CORS for local development
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3001',
  'http://localhost:3003',
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

app.use(cors(corsOptions));

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

const JWT_SECRET = process.env.JWT_SECRET;
app.use(jwtMiddleware({ secret: JWT_SECRET, algorithms: ['HS256'] }).unless({ 
  path: [
    '/api/health',
    /^\/api\/user\/login/,
    /^\/api\/user\/signup/,
    /^\/api\/user\/test/,
    /^\/api\/watchlist\/test/,
    /^\/api\/review\/test/,
  ]
}));

// Logging middleware
app.use((req, res, next) => {
  const parser = new UAParser(req.headers['user-agent']);
  const { os, browser, device } = parser.getResult();
  const userId = req?.user?.id || "guest";
  logger.info({
    type: 'request',
    service: 'api-gateway',
    method: req.method,
    path: req.originalUrl,
    userId: userId,
    ip: req.ip,
    userAgent: {
      os: `${os.name || 'Unknown'} ${os.version || 'Unknown'}`,
      browser: `${browser.name || 'Unknown'} ${browser.version || 'Unknown'}`,
      device: `${device.vendor || 'Unknown'} ${device.model || 'Unknown'}`
    }
  });
  next();
});

app.get('/api/health', async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    redisConnection: redisCache.connected ? 'connected' : 'disconnected'
  };

  // Check Redis connection
  if (!redisCache.connected) {
    try {
      await redisCache.connect();
      healthcheck.redisPing = 'successful';
    } catch (redisError) {
      healthcheck.redisPing = 'failed';
      healthcheck.redisError = redisError.message;
    }
  } else {
    healthcheck.redisPing = 'successful';
  }

  res.status(200).json(healthcheck);
});

const serviceMap = {
  '/api/user': process.env.USER_SERVICE_URL,
  '/api/watchlist': process.env.WATCHLIST_SERVICE_URL,
  '/api/review': process.env.REVIEW_SERVICE_URL
};

const circuitBreakerOptions = {
  failureThreshold: 50,
  resetTimeout: 10000,
  timeout: 3000,
  errorThresholdPercentage: 50,
  rollingCountTimeout: 60000,
  rollingCountBuckets: 10
};

const retryOptions = {
  retries: 3,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 5000,
  randomize: true,
  onRetry: (error, attempt) => {
    logger.warn(`Retry attempt ${attempt} for request due to error: ${error.message}`);
  }
};

const circuitBreakers = {};
Object.keys(serviceMap).forEach(servicePath => {
  circuitBreakers[servicePath] = new CircuitBreaker(
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
  
  const breaker = circuitBreakers[servicePath];
  
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
        status: 200,
        data: { reviews: [], fallback: true, message: 'Review service temporarily unavailable' }
      };
    });
  } else if (servicePath === '/api/watchlist') {
    breaker.fallback(() => {
      return {
        status: 200,
        data: { watchlist: [], fallback: true, message: 'Watchlist service temporarily unavailable' }
      };
    });
  }
  
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
});

app.use(async (req, res) => {
  const basePath = Object.keys(serviceMap).find((path) => req.originalUrl.startsWith(path));
  const serviceURL = serviceMap[basePath];

  if (!serviceURL) return res.status(404).send('Service not found');

  try {
    // For GET requests, check cache first
    if (req.method === 'GET' && redisCache.connected) {
      // Use different cache keys for authenticated vs non-authenticated requests
      const userId = req.user?.id || 'anonymous';
      const cacheKey = userId !== 'anonymous' ? `${userId}:${req.originalUrl}` : req.originalUrl;
      
      try {
        const cachedData = await redisCache.get(cacheKey);
        
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

    const url = serviceURL + req.originalUrl.replace(basePath, '') || '/';
    const circuitBreaker = circuitBreakers[basePath];
    
    const response = await circuitBreaker.fire(url, req.method, req.body);
    
    if (response.data && response.data.fallback) {
      res.setHeader('X-Fallback-Response', 'true');
    }
    
    // Cache successful GET responses
    if (req.method === 'GET' && redisCache.connected && response.status >= 200 && response.status < 300) {
      const userId = req.user?.id || 'anonymous';
      const cacheKey = userId !== 'anonymous' ? `${userId}:${req.originalUrl}` : req.originalUrl;
      
      // Set cache TTL based on the type of data
      let cacheTTL = 1800; // Default 30 minutes
      
      // Different TTLs for different types of resources
      if (req.originalUrl.includes('/api/user')) {
        cacheTTL = 3600; // User data: 1 hour
      } else if (req.originalUrl.includes('/api/review')) {
        cacheTTL = 900; // Reviews: 15 minutes
      } else if (req.originalUrl.includes('/api/watchlist')) {
        cacheTTL = 1200; // Watchlists: 20 minutes
      }
      
      try {
        await redisCache.set(cacheKey, response.data, cacheTTL);
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
    if (req.method !== 'GET' && redisCache.connected) {
      try {
        // Determine which cache pattern to invalidate based on the endpoint
        const userId = req.user?.id || 'anonymous';
        if (userId !== 'anonymous') {
          if (req.originalUrl.includes('/api/user')) {
            await redisCache.invalidateByPattern(`${userId}:*`);
          } else if (req.originalUrl.includes('/api/review')) {
            await redisCache.invalidateByPattern(`${userId}:*/api/review*`);
          } else if (req.originalUrl.includes('/api/watchlist')) {
            await redisCache.invalidateByPattern(`${userId}:*/api/watchlist*`);
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
    
    res.status(response.status).send(response.data);
  } catch (err) {
    if (err.type === 'open') {
      logger.error(`Service ${basePath} circuit is open, failing fast`);
      return res.status(503).send('Service temporarily unavailable');
    } else if (err.type === 'timeout') {
      logger.error(`Request to ${basePath} timed out`);
      return res.status(504).send('Service request timed out');
    }
    
    logger.error(`Error calling ${basePath}: ${err.message}`);
    res.status(err.response?.status || 500).send(err.response?.data || 'Internal Gateway Error');
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

// Handle application termination
process.on('SIGINT', async () => {
  if (redisCache.connected) {
    await redisCache.close();
    console.log('Redis connection closed');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (redisCache.connected) {
    await redisCache.close();
    console.log('Redis connection closed');
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
}

module.exports = app;