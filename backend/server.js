
// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// CONEXIÓN A POSTGRESQL
// =====================================================

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://locker_app_web_user:bEjWRybK0BAJJ9ClZBNa1RUoe7bbOYr4@dpg-dapb71n40ujc739316ug-a.virginia-postgres.render.com/locker_app_web',

  ssl: {
    rejectUnauthorized: false
  }
});

// Prueba de conexión
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error(
      '❌ Error crítico al conectar a PostgreSQL:',
      err.message
    );
  } else {
    console.log('✅ Conexión exitosa a PostgreSQL');
  }
});


// =====================================================
// CONSULTAR USUARIO POR RUT
// =====================================================

app.get('/api/usuarios/:rut', async (req, res) => {

  const { rut } = req.params;

  try {

    const resultado = await pool.query(
      'SELECT * FROM usuarios WHERE rut = $1',
      [rut]
    );

    if (resultado.rows.length === 0) {

      return res.status(404).json({
        mensaje: 'Usuario no encontrado'
      });

    }

    res.json(resultado.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      mensaje: 'Error en el servidor al consultar la base de datos'
    });

  }

});


// =====================================================
// OBTENER LOCKERS DISPONIBLES
// =====================================================
//
// IMPORTANTE:
// Esta ruta asume que tienes una tabla llamada "lockers"
// con una columna "numero".
//
// Ejemplo:
//
// lockers
// ├── numero
// └── activo
//
// Si NO tienes esa tabla, más abajo te explico cómo hacerlo
// usando solamente la tabla usuarios.
//

app.get('/api/lockers/disponibles', async (req, res) => {

  try {

    const resultado = await pool.query(`
      SELECT numero
      FROM lockers
      WHERE activo = true
        AND numero NOT IN (
          SELECT locker
          FROM usuarios
          WHERE locker IS NOT NULL
        )
      ORDER BY numero
    `);

    res.json(resultado.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      mensaje: 'Error al obtener lockers disponibles'
    });

  }

});


// =====================================================
// OBTENER BOLSAS DISPONIBLES
// =====================================================
//
// Esta ruta asume una tabla:
//
// bolsas
// ├── numero
// └── activo
//

app.get('/api/bolsas/disponibles', async (req, res) => {

  try {

    const resultado = await pool.query(`
      SELECT numero
      FROM bolsas
      WHERE activo = true
        AND numero NOT IN (
          SELECT bolsa
          FROM usuarios
          WHERE bolsa IS NOT NULL
        )
      ORDER BY numero
    `);

    res.json(resultado.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      mensaje: 'Error al obtener bolsas disponibles'
    });

  }

});


// =====================================================
// ASIGNAR LOCKER Y/O BOLSA A UN RUT
// =====================================================

app.put('/api/usuarios/:rut/asignar', async (req, res) => {

  const { rut } = req.params;

  const {
    locker,
    bolsa
  } = req.body;

  // ---------------------------------------------------
  // Validar que venga al menos uno
  // ---------------------------------------------------

  if (!locker && !bolsa) {

    return res.status(400).json({
      mensaje: 'Debes indicar un locker o una bolsa'
    });

  }

  const client = await pool.connect();

  try {

    // -------------------------------------------------
    // Iniciar transacción
    // -------------------------------------------------

    await client.query('BEGIN');


    // -------------------------------------------------
    // Verificar que el RUT exista
    // -------------------------------------------------

    const usuario = await client.query(
      'SELECT * FROM usuarios WHERE rut = $1 FOR UPDATE',
      [rut]
    );

    if (usuario.rows.length === 0) {

      await client.query('ROLLBACK');

      return res.status(404).json({
        mensaje: 'Usuario no encontrado'
      });

    }


    // -------------------------------------------------
    // Verificar LOCKER
    // -------------------------------------------------

    if (locker) {

      const lockerOcupado = await client.query(
        `
        SELECT rut
        FROM usuarios
        WHERE locker = $1
          AND rut <> $2
        `,
        [locker, rut]
      );

      if (lockerOcupado.rows.length > 0) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          mensaje: `El locker ${locker} ya está asignado a otro RUT`
        });

      }

    }


    // -------------------------------------------------
    // Verificar BOLSA
    // -------------------------------------------------

    if (bolsa) {

      const bolsaOcupada = await client.query(
        `
        SELECT rut
        FROM usuarios
        WHERE bolsa = $1
          AND rut <> $2
        `,
        [bolsa, rut]
      );

      if (bolsaOcupada.rows.length > 0) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          mensaje: `La bolsa ${bolsa} ya está asignada a otro RUT`
        });

      }

    }


    // -------------------------------------------------
    // Construir actualización
    // -------------------------------------------------

    const campos = [];
    const valores = [];
    let contador = 1;


    if (locker) {

      campos.push(`locker = $${contador}`);
      valores.push(locker);

      contador++;

    }


    if (bolsa) {

      campos.push(`bolsa = $${contador}`);
      valores.push(bolsa);

      contador++;

    }


    valores.push(rut);


    // -------------------------------------------------
    // Actualizar usuario
    // -------------------------------------------------

    const resultado = await client.query(
      `
      UPDATE usuarios
      SET ${campos.join(', ')}
      WHERE rut = $${contador}
      RETURNING *
      `,
      valores
    );


    // -------------------------------------------------
    // Confirmar transacción
    // -------------------------------------------------

    await client.query('COMMIT');


    res.json({
      mensaje: 'Asignación realizada correctamente',
      usuario: resultado.rows[0]
    });


  } catch (error) {

    await client.query('ROLLBACK');

    console.error(error);


    // Violación de UNIQUE
    if (error.code === '23505') {

      if (error.constraint === 'usuarios_locker_unique') {

        return res.status(409).json({
          mensaje: 'Ese locker acaba de ser asignado a otro RUT'
        });

      }

      if (error.constraint === 'usuarios_bolsa_unique') {

        return res.status(409).json({
          mensaje: 'Esa bolsa acaba de ser asignada a otro RUT'
        });

      }

      return res.status(409).json({
        mensaje: 'El recurso seleccionado ya está asignado'
      });

    }


    res.status(500).json({
      mensaje: 'Error al realizar la asignación'
    });

  } finally {

    client.release();

  }

});


// =====================================================
// AGREGAR NUEVO USUARIO
// =====================================================

app.post('/api/usuarios', async (req, res) => {

  const {
    rut,
    nombre,
    locker,
    bolsa
  } = req.body;


  if (!rut || !nombre) {

    return res.status(400).json({
      mensaje: 'RUT y Nombre son obligatorios'
    });

  }


  try {

    // -------------------------------------------------
    // Verificar locker si viene informado
    // -------------------------------------------------

    if (locker) {

      const lockerExiste = await pool.query(
        `
        SELECT rut
        FROM usuarios
        WHERE locker = $1
        `,
        [locker.trim()]
      );

      if (lockerExiste.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Ese locker ya está asignado a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // Verificar bolsa si viene informada
    // -------------------------------------------------

    if (bolsa) {

      const bolsaExiste = await pool.query(
        `
        SELECT rut
        FROM usuarios
        WHERE bolsa = $1
        `,
        [bolsa.trim()]
      );

      if (bolsaExiste.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Esa bolsa ya está asignada a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // Insertar
    // -------------------------------------------------

    const consulta = `
      INSERT INTO usuarios
      (rut, nombre, locker, bolsa)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;


    const valores = [
      rut.trim(),
      nombre.trim(),
      locker ? locker.trim() : null,
      bolsa ? bolsa.trim() : null
    ];


    const resultado = await pool.query(
      consulta,
      valores
    );


    res.status(201).json({
      mensaje: 'Usuario agregado con éxito',
      usuario: resultado.rows[0]
    });


  } catch (error) {

    console.error(error);


    if (error.code === '23505') {

      return res.status(409).json({
        mensaje: 'El RUT, locker o bolsa ya está asignado'
      });

    }


    res.status(500).json({
      mensaje: 'Error en el servidor al guardar el usuario'
    });

  }

});


// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(3000, () => {

  console.log(
    'Servidor corriendo en el puerto 3000'
  );

});
```
