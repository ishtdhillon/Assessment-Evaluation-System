// This converts MySQL ? placeholders to PostgreSQL $1,$2... style
const db_raw = require('./db');

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  query: (sql, params) => db_raw.query(convertPlaceholders(sql), params)
};

module.exports = db;
