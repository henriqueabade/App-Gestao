require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const { Pool } = require('pg');

let pool;

function createConfig(pin) {
  const useSSL = process.env.DB_USE_SSL === 'true';
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: pin ? parseInt(pin, 10) : process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    ssl: useSSL
      ? {
          rejectUnauthorized: false // Permite conectar com SSL mesmo sem certificado válido
        }
      : false
  };
}

function init(pin) {
  const required = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `Using default database configuration because environment variables ${missing.join(', ')} are not set.`
    );
  }
  pool = new Pool(createConfig(pin));
  pool.on('error', (err) => {
    console.error('Erro inesperado do cliente PostgreSQL:', err);
  });
  return pool;
}

function query(text, params) {
  if (!pool) init();
  return pool.query(text, params);
}

function connect() {
  if (!pool) init();
  return pool.connect();
}

// inicializa com variáveis de ambiente por padrão
init();

module.exports = { init, query, connect };
