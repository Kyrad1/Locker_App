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


// =====================================================
// PRUEBA DE CONEXIÓN
// =====================================================

pool.query('SELECT NOW()', (err) => {

  if (err) {

    console.error(
      '❌ Error crítico al conectar a PostgreSQL:',
      err.message
    );

  } else {

    console.log(
      '✅ Conexión exitosa a la base de datos PostgreSQL'
    );

  }

});


// =====================================================
// CONSULTAR USUARIO POR RUT
// =====================================================

app.get('/api/usuarios/:rut', async (req, res) => {

  const { rut } = req.params;

  try {

    const resultado = await pool.query(
      `
        SELECT rut, nombre, locker, bolsa, candado
        FROM usuarios
        WHERE rut = $1
      `,
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
// ASIGNAR BOLSA Y/O CANDADO
// =====================================================
//
// Reglas:
//
// - Bolsa: 1 a 10 dígitos
// - Candado: 1 a 10 dígitos
// - Ambos se almacenan como VARCHAR
// - No pueden repetirse
// - Pueden ser NULL
// - Locker NO se asigna desde este endpoint
//
// =====================================================

app.put('/api/usuarios/:rut/asignar', async (req, res) => {

  const { rut } = req.params;

  let { bolsa, candado } = req.body;


  // ---------------------------------------------------
  // Limpiar valores recibidos
  // ---------------------------------------------------

  bolsa =
    bolsa !== undefined && bolsa !== null
      ? String(bolsa).trim()
      : null;

  candado =
    candado !== undefined && candado !== null
      ? String(candado).trim()
      : null;


  // ---------------------------------------------------
  // Validar que venga al menos uno
  // ---------------------------------------------------

  if (!bolsa && !candado) {

    return res.status(400).json({
      mensaje: 'Debes indicar una bolsa o un candado'
    });

  }


  // ---------------------------------------------------
  // Validar formato de bolsa
  // ---------------------------------------------------

  if (bolsa) {

    const formatoBolsa = /^\d{1,10}$/;

    if (!formatoBolsa.test(bolsa)) {

      return res.status(400).json({
        mensaje: 'La bolsa debe contener entre 1 y 10 dígitos'
      });

    }

  }


  // ---------------------------------------------------
  // Validar formato de candado
  // ---------------------------------------------------

  if (candado) {

    const formatoCandado = /^\d{1,10}$/;

    if (!formatoCandado.test(candado)) {

      return res.status(400).json({
        mensaje: 'El candado debe contener entre 1 y 10 dígitos'
      });

    }

  }


  const client = await pool.connect();


  try {

    await client.query('BEGIN');


    // -------------------------------------------------
    // Buscar y bloquear el usuario
    // -------------------------------------------------

    const usuario = await client.query(
      `
        SELECT *
        FROM usuarios
        WHERE rut = $1
        FOR UPDATE
      `,
      [rut]
    );


    if (usuario.rows.length === 0) {

      await client.query('ROLLBACK');

      return res.status(404).json({
        mensaje: 'Usuario no encontrado'
      });

    }


    // -------------------------------------------------
    // VALIDAR BOLSA
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
    // VALIDAR CANDADO
    // -------------------------------------------------

    if (candado) {

      const candadoOcupado = await client.query(
        `
          SELECT rut
          FROM usuarios
          WHERE candado = $1
            AND rut <> $2
        `,
        [candado, rut]
      );


      if (candadoOcupado.rows.length > 0) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          mensaje: `El candado ${candado} ya está asignado a otro RUT`
        });

      }

    }


    // -------------------------------------------------
    // CONSTRUIR UPDATE
    // -------------------------------------------------

    const campos = [];
    const valores = [];

    let posicion = 1;


    if (bolsa) {

      campos.push(`bolsa = $${posicion}`);
      valores.push(bolsa);

      posicion++;

    }


    if (candado) {

      campos.push(`candado = $${posicion}`);
      valores.push(candado);

      posicion++;

    }


    valores.push(rut);


    // -------------------------------------------------
    // ACTUALIZAR
    // -------------------------------------------------

    const resultado = await client.query(
      `
        UPDATE usuarios
        SET ${campos.join(', ')}
        WHERE rut = $${posicion}
        RETURNING rut, nombre, locker, bolsa, candado
      `,
      valores
    );


    await client.query('COMMIT');


    res.json({
      mensaje: 'Asignación realizada correctamente',
      usuario: resultado.rows[0]
    });


  } catch (error) {

    await client.query('ROLLBACK');

    console.error(error);


    // Error de UNIQUE
    if (error.code === '23505') {

      return res.status(409).json({
        mensaje: 'La bolsa o el candado ya está asignado a otro RUT'
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
//
// Locker no se asigna desde este endpoint.
// Si un usuario necesita locker, debe existir previamente
// en la base de datos con su locker asignado.
//
// Bolsa y candado son opcionales.
//
// =====================================================

app.post('/api/usuarios', async (req, res) => {

  let {
    rut,
    nombre,
    bolsa,
    candado
  } = req.body;


  // ---------------------------------------------------
  // Validar datos obligatorios
  // ---------------------------------------------------

  if (!rut || !nombre) {

    return res.status(400).json({
      mensaje: 'RUT y Nombre son obligatorios'
    });

  }


  rut = String(rut).trim();
  nombre = String(nombre).trim();


  // ---------------------------------------------------
  // Limpiar bolsa
  // ---------------------------------------------------

  bolsa =
    bolsa !== undefined && bolsa !== null
      ? String(bolsa).trim()
      : null;


  // ---------------------------------------------------
  // Limpiar candado
  // ---------------------------------------------------

  candado =
    candado !== undefined && candado !== null
      ? String(candado).trim()
      : null;


  // ---------------------------------------------------
  // Validar bolsa
  // ---------------------------------------------------

  if (bolsa) {

    const formatoBolsa = /^\d{1,10}$/;

    if (!formatoBolsa.test(bolsa)) {

      return res.status(400).json({
        mensaje: 'La bolsa debe contener entre 1 y 10 dígitos'
      });

    }

  }


  // ---------------------------------------------------
  // Validar candado
  // ---------------------------------------------------

  if (candado) {

    const formatoCandado = /^\d{1,10}$/;

    if (!formatoCandado.test(candado)) {

      return res.status(400).json({
        mensaje: 'El candado debe contener entre 1 y 10 dígitos'
      });

    }

  }


  try {

    // -------------------------------------------------
    // Comprobar bolsa
    // -------------------------------------------------

    if (bolsa) {

      const ocupada = await pool.query(
        `
          SELECT rut
          FROM usuarios
          WHERE bolsa = $1
        `,
        [bolsa]
      );


      if (ocupada.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Esa bolsa ya está asignada a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // Comprobar candado
    // -------------------------------------------------

    if (candado) {

      const ocupado = await pool.query(
        `
          SELECT rut
          FROM usuarios
          WHERE candado = $1
        `,
        [candado]
      );


      if (ocupado.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Ese candado ya está asignado a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // INSERT
    // -------------------------------------------------

    const resultado = await pool.query(
      `
        INSERT INTO usuarios
        (
          rut,
          nombre,
          locker,
          bolsa,
          candado
        )
        VALUES ($1, $2, NULL, $3, $4)
        RETURNING rut, nombre, locker, bolsa, candado
      `,
      [
        rut,
        nombre,
        bolsa || null,
        candado || null
      ]
    );


    res.status(201).json({
      mensaje: 'Usuario agregado con éxito',
      usuario: resultado.rows[0]
    });


  } catch (error) {

    console.error(error);


    if (error.code === '23505') {

      return res.status(409).json({
        mensaje: 'El RUT, la bolsa o el candado ya está asignado'
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