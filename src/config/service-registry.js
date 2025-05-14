/**
 * Service Registry Configuration
 * Maps API endpoints to their respective microservice URLs
 */

const serviceRegistry = {
  // Map of API paths to service URLs
  serviceMap: {
    '/api/user': process.env.USER_SERVICE_URL || 'http://localhost:3001',
    '/api/review': process.env.REVIEW_SERVICE_URL || 'http://localhost:3002',
    '/api/watchlist': process.env.WATCHLIST_SERVICE_URL || 'http://localhost:3003'
  },
  
  // Get a service URL by its path
  getServiceUrl(path) {
    return this.serviceMap[path];
  },
  
  // Get all service paths
  getServicePaths() {
    return Object.keys(this.serviceMap);
  },
  
  // Add a new service to the registry
  addService(path, url) {
    this.serviceMap[path] = url;
    return this.serviceMap;
  },
  
  // Remove a service from the registry
  removeService(path) {
    if (this.serviceMap[path]) {
      delete this.serviceMap[path];
      return true;
    }
    return false;
  }
};

module.exports = serviceRegistry;
