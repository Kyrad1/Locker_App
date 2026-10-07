const { Pool } = require('pg');

// La URL de la base de datos viene de la variable de entorno BD (URL interna de Render)
const connectionString = process.env.BD || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ Falta la variable de entorno BD');
}

// La URL externa (…render.com) requiere SSL; la interna no.
const esExterna = /\.render\.com/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: esExterna ? { rejectUnauthorized: false } : false
});

module.exports = pool;
