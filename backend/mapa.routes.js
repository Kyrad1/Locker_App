// npm install multer
//
// En tu server.js:
//   app.use('/api/mapa', require('./mapa.routes'));
//
// Ajusta la línea de abajo para importar tu conexión a PostgreSQL (el Pool de "pg").

const express = require('express');
const multer = require('multer');
const pool = require('./db'); // <-- tu pool de pg

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Crea la tabla si no existe (una sola fila: el mapa actual)
pool.query(`
    CREATE TABLE IF NOT EXISTS mapa (
        id INT PRIMARY KEY DEFAULT 1,
        tipo TEXT NOT NULL,
        datos BYTEA NOT NULL,
        actualizado TIMESTAMPTZ DEFAULT NOW()
    )
`);

// Ver el mapa (imagen o PDF)
router.get('/', async (req, res) => {

    const { rows } = await pool.query('SELECT tipo, datos FROM mapa WHERE id = 1');

    if (!rows.length) return res.sendStatus(404);

    res.set('Content-Type', rows[0].tipo);
    res.set('Cache-Control', 'no-cache');
    res.send(rows[0].datos);
});

// Protege la subida con una contraseña (variable de entorno CLAVE_MAPA)
function pedirClave(req, res, next) {

    const clave = process.env.CLAVE_MAPA;

    if (!clave || req.get('x-clave') !== clave) {
        return res.status(401).json({ mensaje: 'Contraseña incorrecta' });
    }

    next();
}

// Subir / reemplazar el mapa
router.post('/', pedirClave, upload.single('archivo'), async (req, res) => {

    if (!req.file) return res.sendStatus(400);

    await pool.query(
        `INSERT INTO mapa (id, tipo, datos, actualizado)
         VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE
         SET tipo = $1, datos = $2, actualizado = NOW()`,
        [req.file.mimetype, req.file.buffer]
    );

    res.sendStatus(200);
});

module.exports = router;
