// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors()); // Permite que el frontend se comunique con el backend
app.use(express.json());

// 💻 NUEVA CONFIGURACIÓN PARA LA NUBE
const pool = new Pool({
  // Cuando corra en Render, leerá la variable de entorno. Localmente usará tu URL entre comillas.
  connectionString: process.env.DATABASE_URL || 'postgresql://locker_app_web_user:bEjWRybK0BAJJ9ClZBNa1RUoe7bbOYr4@dpg-dapb71n40ujc739316ug-a.virginia-postgres.render.com/locker_app_web',
  ssl: {
    rejectUnauthorized: false // Requerido por Render para conexiones cifradas seguras
  }
});
// Prueba rápida de conexión al iniciar el servidor
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Error crítico al conectar a PostgreSQL:', err.message);
  } else {
    console.log('✅ Conexión exitosa a la base de datos PostgreSQL');
  }
});

// Ruta para consultar por RUT
app.get('/api/usuarios/:rut', async (req, res) => {
  const { rut } = req.params;

  try {
    // Consulta segura usando parámetros preparados para evitar SQL Injection
    const resultado = await pool.query('SELECT * FROM usuarios WHERE rut = $1', [rut]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json(resultado.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar la base de datos' });
  }
});

app.listen(3000, () => console.log('Servidor corriendo en el puerto 3000'));