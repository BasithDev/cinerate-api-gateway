// Set NODE_ENV to 'test' before importing any modules
process.env.NODE_ENV = 'test';

jest.mock('express-jwt', () => ({
  expressjwt: () => {
    const mw = (req, res, next) => next();
    mw.unless = () => mw;
    return mw;
  }
}));
const request = require('supertest');
const app = require('../index');

describe('API Gateway', () => {
  test('GET /api/health should confirm gateway is healthy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    
    // Parse the response body as JSON
    const healthData = JSON.parse(res.text);
    
    // Check that the health check contains the expected fields
    expect(healthData).toHaveProperty('uptime');
    expect(healthData).toHaveProperty('message', 'OK');
    expect(healthData).toHaveProperty('timestamp');
    expect(healthData).toHaveProperty('redisConnection');
    expect(healthData).toHaveProperty('redisPing');
  });

  test('GET /api/unknown should return 404 for unknown service', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('Service not found');
  });

});
