const express = require('express');
const router = express.Router();

/**
 * Initialize health routes with the health controller
 * @param {Object} healthController - Instance of HealthController
 * @returns {Router} Express router
 */
function initHealthRoutes(healthController) {
  // Basic health check
  router.get('/health', (req, res) => healthController.getHealth(req, res));
  
  // Detailed health check that includes downstream services
  router.get('/health/details', (req, res) => healthController.getDetailedHealth(req, res));
  
  // Configuration test endpoint
  router.get('/health/config', (req, res) => healthController.getConfig(req, res));
  
  return router;
}

module.exports = initHealthRoutes;
