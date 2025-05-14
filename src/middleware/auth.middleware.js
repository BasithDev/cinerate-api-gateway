const { expressjwt } = require('express-jwt');
const logger = require('../utils/logger');

/**
 * Authentication middleware using JWT
 * Verifies the JWT token in the Authorization header
 */

// Function to extract token from request
const getToken = (req) => {
  // Get token from Authorization header
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
    return req.headers.authorization.split(' ')[1];
  }
  // Get token from query parameter
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
};

// Simple middleware to check if path should be excluded from auth
const authMiddleware = (req, res, next) => {
  // Define paths that don't require authentication
  const publicPaths = [
    '/health',
    '/health/details',
    '/health/config',
    '/metrics'
  ];
  
  // Check if the current path exactly matches a public path
  if (publicPaths.includes(req.path)) {
    return next();
  }
  
  // Check public path prefixes
  if (
    req.path === '/health' ||
    req.path.startsWith('/api/user/login') ||
    req.path.startsWith('/api/user/signup') ||
    req.path.startsWith('/api/user/test') ||
    req.path.startsWith('/api/watchlist/test') ||
    req.path.startsWith('/api/review/test')
  ) {
    return next();
  }
  
  // For protected paths, manually verify JWT
  const token = getToken(req);
  if (!token) {
    // No token provided, but we'll continue anyway (credentialsRequired: false behavior)
    return next();
  }
  
  // Create JWT verification middleware for this request only
  const jwtMiddleware = expressjwt({
    secret: process.env.JWT_SECRET || 'your-secret-key',
    algorithms: ['HS256']
  });
  
  // Apply JWT middleware
  jwtMiddleware(req, res, (err) => {
    if (err) {
      // Handle JWT error but don't block the request
      logger.warn(`JWT authentication error: ${err.message}`);
      // Continue without authentication
      return next();
    }
    next();
  });
};

// Handle JWT errors
const handleJwtError = (err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    logger.warn(`JWT authentication error: ${err.message}`);
    res.status(401).json({ error: 'Invalid token' });
  } else {
    next(err);
  }
};

module.exports = { authMiddleware, handleJwtError };
