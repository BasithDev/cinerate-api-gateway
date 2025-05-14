const express = require('express');
const router = express.Router();

/**
 * Initialize proxy routes with the proxy controller
 * @param {Object} proxyController - Instance of ProxyController
 * @returns {Router} Express router
 */
function initProxyRoutes(proxyController) {
  // Handle all requests to /api/user and forward to user service
  router.use('/api/user', (req, res) => {
    req.serviceType = 'user';
    proxyController.proxyRequest(req, res);
  });

  // Handle all requests to /api/review and forward to review service
  router.use('/api/review', (req, res) => {
    req.serviceType = 'review';
    proxyController.proxyRequest(req, res);
  });

  // Handle all requests to /api/watchlist and forward to watchlist service
  router.use('/api/watchlist', (req, res) => {
    req.serviceType = 'watchlist';
    proxyController.proxyRequest(req, res);
  });
  
  // Fallback route for any other API requests
  router.use('/api', (req, res) => {
    res.status(404).json({ error: 'Service not found' });
  });
  
  return router;
}

module.exports = initProxyRoutes;
