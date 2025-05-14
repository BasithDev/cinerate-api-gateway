const logger = require('../utils/logger');
const serviceRegistry = require('../config/service-registry');
const axios = require('axios');

/**
 * Health Controller
 * Provides health check endpoints for the API Gateway and downstream services
 */
class HealthController {
  constructor(circuitBreakers) {
    this.circuitBreakers = circuitBreakers;
    this.serviceMap = serviceRegistry.serviceMap;
  }

  /**
   * Simple health check for the API Gateway
   */
  getHealth(req, res) {
    res.status(200).json({
      status: 'UP',
      service: 'api-gateway',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Detailed health check that includes status of all downstream services
   */
  async getDetailedHealth(req, res) {
    const serviceStatuses = {};
    const servicePaths = Object.keys(this.serviceMap);
    
    // Check each service's health endpoint
    await Promise.all(servicePaths.map(async (path) => {
      const serviceUrl = this.serviceMap[path];
      const serviceName = path.replace('/api/', '');
      
      try {
        // Use circuit breaker to call service health endpoint
        const response = await this.circuitBreakers[path].fire(
          `${serviceUrl}/health`,
          'GET'
        );
        
        serviceStatuses[serviceName] = {
          status: response.status === 200 ? 'UP' : 'DOWN',
          details: response.data
        };
      } catch (error) {
        logger.error(`Health check failed for ${serviceName}: ${error.message}`);
        serviceStatuses[serviceName] = {
          status: 'DOWN',
          error: error.message
        };
      }
    }));
    
    // Determine overall status
    const allServicesUp = Object.values(serviceStatuses)
      .every(service => service.status === 'UP');
    
    res.status(200).json({
      status: allServicesUp ? 'UP' : 'DEGRADED',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      services: serviceStatuses
    });
  }
  
  /**
   * Test endpoint that returns the current configuration
   */
  getConfig(req, res) {
    res.status(200).json({
      services: this.serviceMap,
      circuitBreakers: Object.keys(this.circuitBreakers).map(key => ({
        path: key,
        status: this.circuitBreakers[key].status
      }))
    });
  }
}

module.exports = HealthController;
