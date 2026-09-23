
// server.js
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

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
  connectionString: process.env.DATABASE_URL
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
      SELECT rut, nombre, locker, bolsa
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
// OBTENER LOCKERS DISPONIBLES
// =====================================================
//
// Lockers:
//
// 1-1
// 1-2
// ...
// 1-15
// 2-1
// ...
// 137-15
//
// Total: 137 x 15 = 2055
//
// Si el locker ya aparece en usuarios.locker,
// se considera ocupado.
//
// =====================================================

app.get('/api/lockers/disponibles', async (req, res) => {

  try {

    const resultado = await pool.query(`
      SELECT locker
      FROM usuarios
      WHERE locker IS NOT NULL
    `);

    const ocupados = new Set(
      resultado.rows
        .map(row => row.locker)
        .filter(Boolean)
    );


    const disponibles = [];


    for (let flota = 1; flota <= 137; flota++) {

      for (let numero = 1; numero <= 15; numero++) {

        const locker = `${flota}-${numero}`;

        if (!ocupados.has(locker)) {

          disponibles.push(locker);

        }

      }

    }


    res.json(disponibles);

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
// verde-1 ... verde-1000
// amarillo-1 ... amarillo-1000
// rojo-1 ... rojo-1000
//
// =====================================================

app.get('/api/bolsas/disponibles', async (req, res) => {

  try {

    const resultado = await pool.query(`
      SELECT bolsa
      FROM usuarios
      WHERE bolsa IS NOT NULL
    `);


    const ocupadas = new Set(
      resultado.rows
        .map(row => row.bolsa)
        .filter(Boolean)
    );


    const colores = [
      'verde',
      'amarillo',
      'rojo'
    ];


    const disponibles = [];


    for (const color of colores) {

      for (let numero = 1; numero <= 1000; numero++) {

        const bolsa = `${color}-${numero}`;

        if (!ocupadas.has(bolsa)) {

          disponibles.push(bolsa);

        }

      }

    }


    res.json(disponibles);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      mensaje: 'Error al obtener bolsas disponibles'
    });

  }

});


// =====================================================
// ASIGNAR LOCKER Y/O BOLSA
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
    // VALIDAR LOCKER
    // -------------------------------------------------

    if (locker) {

      // Validar formato
      const formatoLocker = /^([1-9][0-9]?|1[0-2][0-9]|13[0-7])-(?:[1-9]|1[0-5])$/;

      if (!formatoLocker.test(locker)) {

        await client.query('ROLLBACK');

        return res.status(400).json({
          mensaje: 'Formato de locker inválido'
        });

      }


      // Comprobar que no esté asignado
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
    // VALIDAR BOLSA
    // -------------------------------------------------

    if (bolsa) {

      const formatoBolsa =
        /^(verde|amarillo|rojo)-(?:[1-9][0-9]{0,2}|1000)$/;


      if (!formatoBolsa.test(bolsa)) {

        await client.query('ROLLBACK');

        return res.status(400).json({
          mensaje: 'Formato de bolsa inválido'
        });

      }


      // Comprobar que no esté asignada
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
    // CONSTRUIR UPDATE
    // -------------------------------------------------

    const campos = [];
    const valores = [];

    let posicion = 1;


    if (locker) {

      campos.push(`locker = $${posicion}`);
      valores.push(locker);

      posicion++;

    }


    if (bolsa) {

      campos.push(`bolsa = $${posicion}`);
      valores.push(bolsa);

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
      RETURNING rut, nombre, locker, bolsa
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
        mensaje: 'El locker o la bolsa seleccionada ya fue asignada a otro RUT'
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
    // Validar locker
    // -------------------------------------------------

    if (locker) {

      const formatoLocker =
        /^([1-9][0-9]?|1[0-2][0-9]|13[0-7])-(?:[1-9]|1[0-5])$/;


      if (!formatoLocker.test(locker.trim())) {

        return res.status(400).json({
          mensaje: 'Formato de locker inválido'
        });

      }


      const ocupado = await pool.query(
        `
        SELECT rut
        FROM usuarios
        WHERE locker = $1
        `,
        [locker.trim()]
      );


      if (ocupado.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Ese locker ya está asignado a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // Validar bolsa
    // -------------------------------------------------

    if (bolsa) {

      const formatoBolsa =
        /^(verde|amarillo|rojo)-(?:[1-9][0-9]{0,2}|1000)$/;


      if (!formatoBolsa.test(bolsa.trim())) {

        return res.status(400).json({
          mensaje: 'Formato de bolsa inválido'
        });

      }


      const ocupada = await pool.query(
        `
        SELECT rut
        FROM usuarios
        WHERE bolsa = $1
        `,
        [bolsa.trim()]
      );


      if (ocupada.rows.length > 0) {

        return res.status(409).json({
          mensaje: 'Esa bolsa ya está asignada a otro RUT'
        });

      }

    }


    // -------------------------------------------------
    // INSERT
    // -------------------------------------------------

    const resultado = await pool.query(
      `
      INSERT INTO usuarios
      (rut, nombre, locker, bolsa)
      VALUES ($1, $2, $3, $4)
      RETURNING rut, nombre, locker, bolsa
      `,
      [
        rut.trim(),
        nombre.trim(),
        locker ? locker.trim() : null,
        bolsa ? bolsa.trim() : null
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

