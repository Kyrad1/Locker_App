// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors()); // Permite que el frontend se comunique con el backend
app.use(express.json());

// Configuración de la conexión a la base de datos
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'Locker_App',
  password: 'Acciona2026',
  port: 5432,
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