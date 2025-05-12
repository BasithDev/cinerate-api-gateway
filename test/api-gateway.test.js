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
    expect(res.text).toBe('API Gateway is healthy');
  });

  test('GET /api/unknown should return 404 for unknown service', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('Service not found');
  });

});
