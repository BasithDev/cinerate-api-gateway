# CineRate API Gateway

The API Gateway service for the CineRate microservices architecture. This service routes requests to the appropriate microservices, handles authentication, caching, and implements circuit breaker patterns for resilience.

## Architecture

This service follows the MVC (Model-View-Controller) architecture pattern:

- **Controllers**: Handle request processing and routing to microservices
- **Routes**: Define API endpoints
- **Middleware**: Handle cross-cutting concerns like authentication, rate limiting, and metrics
- **Utils**: Provide reusable functionality like Redis caching and circuit breakers
- **Config**: Store configuration values

## Features

- JWT Authentication
- Request routing to microservices
- Redis caching with circuit breaker pattern
- Rate limiting
- Prometheus metrics
- Graceful error handling and shutdown
- Logging with Winston

## Getting Started

### Prerequisites

- Node.js (v14+)
- Redis server
- Access to microservices (User, Review, Watchlist)

### Environment Variables

Create a `.env` file with the following variables:

```
PORT=3000
JWT_SECRET=your-jwt-secret
REDIS_URL=redis://localhost:6379
USER_SERVICE_URL=http://user-service:3001
REVIEW_SERVICE_URL=http://review-service:3002
WATCHLIST_SERVICE_URL=http://watchlist-service:3003
```

### Installation

```bash
npm install
```

### Running the Service

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

## API Endpoints

- `/health` - Health check endpoint
- `/health/details` - Detailed health check including microservices status
- `/api/user/*` - Routes to User Service
- `/api/review/*` - Routes to Review Service
- `/api/watchlist/*` - Routes to Watchlist Service

## Circuit Breaker Pattern

The API Gateway implements circuit breaker patterns for each microservice to prevent cascading failures. If a service is unavailable, the circuit breaker will "open" and return fallback responses.

## Caching

GET requests are cached in Redis with different TTLs based on the resource type:
- User data: 1 hour
- Reviews: 15 minutes
- Watchlists: 20 minutes

Cache is automatically invalidated on write operations (POST, PUT, DELETE).
