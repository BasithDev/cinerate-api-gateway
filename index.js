
const { startServer } = require('./src/server');

startServer().catch(error => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
