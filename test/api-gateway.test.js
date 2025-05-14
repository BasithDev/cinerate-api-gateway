// Set NODE_ENV to 'test' before importing any modules
process.env.NODE_ENV = 'test';

// Mock express-jwt
jest.mock('express-jwt', () => ({
  expressjwt: () => {
    const mw = (req, res, next) => next();
    mw.unless = () => mw;
    return mw;
  }
}));

const request = require('supertest');
const createApp = require('../src/app');

// Create a test app instance
const app = createApp();

// Mock Redis connection
jest.mock('../src/utils/redis-cache', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(),
    connected: true,
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    close: jest.fn().mockResolvedValue(),
    invalidateByPattern: jest.fn().mockResolvedValue(0)
  }));
});

// Create a server for testing
let server;

beforeAll((done) => {
  server = app.listen(0, () => {
    done();
  });
});

afterAll((done) => {
  if (server) {
    server.close(done);
  } else {
    done();
  }
});

describe('API Gateway', () => {
  test('GET /health should confirm gateway is healthy', async () => {
    const res = await request(server).get('/health');
    expect(res.statusCode).toBe(200);
    
    // Check that the health check contains the expected fields
    expect(res.body).toHaveProperty('status', 'UP');
    expect(res.body).toHaveProperty('service', 'api-gateway');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('GET /api/unknown should return 404 for unknown service', async () => {
    const res = await request(server).get('/api/unknown');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error', 'Service not found');
  });
});
