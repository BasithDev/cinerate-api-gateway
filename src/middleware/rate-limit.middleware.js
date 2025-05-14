const rateLimit = require('express-rate-limit');
const UAParser = require('ua-parser-js');
const logger = require('../utils/logger');

/**
 * Rate limiting middleware
 * Limits the number of requests from a single IP
 */
const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again later',
    skip: (req) => false, // No skipping by default
  };

  // Merge default options with provided options
  const limiterOptions = { ...defaultOptions, ...options };

  // Add custom handler to log rate limit hits
  limiterOptions.handler = (req, res, next, options) => {
    const parser = new UAParser(req.headers['user-agent']);
    const userAgent = parser.getResult();
    
    logger.warn({
      message: 'Rate limit exceeded',
      ip: req.ip,
      path: req.originalUrl,
      userAgent: {
        browser: userAgent.browser.name,
        os: userAgent.os.name,
        device: userAgent.device.type || 'desktop'
      }
    });
    
    res.status(429).json({
      error: {
        message: options.message,
        status: 429,
        timestamp: new Date().toISOString()
      }
    });
  };

  return rateLimit(limiterOptions);
};

// Create different rate limiters for different endpoints
const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
});

// More strict limiter for authentication endpoints
const authLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour
});

module.exports = {
  apiLimiter,
  authLimiter,
  createRateLimiter
};
