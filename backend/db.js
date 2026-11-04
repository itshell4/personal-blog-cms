const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10, // Keep up to 10 connections open in the pool
  idleTimeoutMillis: 30000, // Keep connections warm for 30 seconds
  connectionTimeoutMillis: 5000
});

// Pre-warm the database connection as soon as the server starts
pool.query('SELECT 1').then(() => console.log('⚡ Database connection pre-warmed and ready!'));

module.exports = pool;