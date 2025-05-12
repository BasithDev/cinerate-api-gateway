const express = require('express');
const winston = require('winston');
const {expressjwt: jwtMiddleware} = require('express-jwt');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv').config();
const axios = require('axios');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const app = express();

app.use(express.json());

console.log('testing pipelines')

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

app.get('/api/health', (req, res) => {
  res.status(200).send('API Gateway is healthy');
});

const serviceMap = {
  '/api/user': process.env.USER_SERVICE_URL,
  '/api/watchlist': process.env.WATCHLIST_SERVICE_URL,
  '/api/review': process.env.REVIEW_SERVICE_URL
};

app.use(async (req, res, next) => {
    const basePath = Object.keys(serviceMap).find((path) => req.originalUrl.startsWith(path));
    const serviceURL = serviceMap[basePath];
  
    if (!serviceURL) return res.status(404).send('Service not found');
  
    try {
      const url = serviceURL + req.originalUrl.replace(basePath, '') || '/';
      const response = await axios({
        url,
        method: req.method,
        data: req.body
      });
      res.status(response.status).send(response.data);
    } catch (err) {
      logger.error(err.message);
      console.log(err)
      res.status(err.response?.status || 500).send(err.response?.data || 'Internal Gateway Error');
    }
  });

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
  });
}

module.exports = app;