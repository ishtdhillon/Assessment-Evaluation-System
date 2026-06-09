const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 6543,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
  family:   4
});

pool.connect()
  .then(client => {
    console.log('✅  PostgreSQL connected to Supabase');
    client.release();
  })
  .catch(err => {
    console.error('❌  Supabase connection failed:', err.message);
    process.exit(1);
  });

const db = {
  query: (text, params) => pool.query(text, params)
    .then(res => [res.rows, res.fields])
};

module.exports = db;
