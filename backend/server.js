// server.js

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Mapa (imagen o PDF)
app.use('/api/mapa', require('./mapa.routes'));


// =====================================================
// CONEXIÓN A POSTGRESQL (ver db.js)
// =====================================================

const pool = require('./db');


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


/* =====================================================
   CONSULTAR LOCKERS DISPONIBLES
===================================================== */

app.get('/api/lockers/disponibles', async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT l.codigo
      FROM lockers l
      WHERE l.estado_operativo = 'operativo'
        AND NOT EXISTS (
          SELECT 1
          FROM usuarios u
          CROSS JOIN LATERAL (
            VALUES
              (TRIM(u.locker)),
              (TRIM(u.locker2))
          ) AS asignacion(valor)
          WHERE asignacion.valor IS NOT NULL
            AND asignacion.valor <> ''
            AND RIGHT(asignacion.valor, 6) = l.codigo
        )
      ORDER BY l.codigo;
    `);

    res.json({
      total: resultado.rows.length,
      lockers: resultado.rows.map(fila => fila.codigo)
    });

  } catch (error) {
    console.error(
      'Error al consultar lockers disponibles:',
      error
    );

    res.status(500).json({
      mensaje: 'Error al consultar los lockers disponibles'
    });
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
        SELECT rut, nombre, locker,locker2, bolsa, candado
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
// CONSULTAR USUARIO POR LOCKER
// =====================================================

app.get('/api/usuarios/locker/:locker', async (req, res) => {

  const { locker } = req.params;

  try {

    const resultado = await pool.query(
      `
        SELECT rut, nombre, locker, bolsa, candado
        FROM usuarios
        WHERE locker = $1
      `,
      [locker]
    );

    if (resultado.rows.length === 0) {

      return res.status(404).json({
        mensaje: 'No se encontró ninguna persona con ese locker'
      });

    }

    res.json(resultado.rows[0]);

  } catch (error) {

    console.error('Error al consultar locker:', error);

    res.status(500).json({
      mensaje: 'Error en el servidor al consultar el locker'
    });

  }

});

// =====================================================
// CONSULTAR USUARIO POR BOLSA
// =====================================================

app.get('/api/usuarios/bolsa/:bolsa', async (req, res) => {

  const { bolsa } = req.params;

  try {

    const resultado = await pool.query(
      `
        SELECT rut, nombre, locker, bolsa, candado
        FROM usuarios
        WHERE bolsa = $1
      `,
      [bolsa]
    );

    if (resultado.rows.length === 0) {

      return res.status(404).json({
        mensaje: 'No se encontró ninguna persona con esa bolsa'
      });

    }

    res.json(resultado.rows[0]);

  } catch (error) {

    console.error('Error al consultar bolsa:', error);

    res.status(500).json({
      mensaje: 'Error en el servidor al consultar la bolsa'
    });

  }

});

// =====================================================
// CONSULTAR USUARIO POR CANDADO  
// =====================================================

app.get('/api/usuarios/candado/:candado', async (req, res) => {

  const { candado } = req.params;

  try {

    const resultado = await pool.query(
      `
        SELECT rut, nombre, locker, bolsa, candado
        FROM usuarios
        WHERE candado = $1
      `,
      [candado]
    );

    if (resultado.rows.length === 0) {

      return res.status(404).json({
        mensaje: 'No se encontró ninguna persona con ese candado'
      });

    }

    res.json(resultado.rows[0]);

  } catch (error) {

    console.error('Error al consultar el candado:', error);

    res.status(500).json({
      mensaje: 'Error en el servidor al consultar el candado'
    });

  }

});


// =====================================================
// LIBERAR LOCKER

app.put('/api/usuarios/:rut/liberar-locker', async (req, res) => {
  const { rut } = req.params;
  const campo = req.body?.campo || 'locker';

  // Solo permitimos liberar estos dos campos.
  if (!['locker', 'locker2'].includes(campo)) {
    return res.status(400).json({
      mensaje: 'Campo inválido. Debe ser locker o locker2.'
    });
  }

  try {
    const resultado = await pool.query(
      `
        UPDATE usuarios
        SET ${campo} = NULL
        WHERE rut = $1
        RETURNING rut, nombre, locker, locker2, bolsa, candado
      `,
      [rut]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensaje: 'Usuario no encontrado'
      });
    }

    return res.json({
      mensaje: campo === 'locker2'
        ? 'Segundo locker liberado correctamente'
        : 'Locker liberado correctamente',
      usuario: resultado.rows[0]
    });

  } catch (error) {
    console.error('Error al liberar locker:', error);

    return res.status(500).json({
      mensaje: 'Error interno del servidor al liberar el locker'
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

  let { locker, locker2, bolsa, candado } = req.body;


  // ---------------------------------------------------
  // Limpiar valores recibidos
  // ---------------------------------------------------
  locker2 =
  locker2 !== undefined && locker2 !== null
    ? String(locker2).trim()
    : null;
  locker =
  locker !== undefined && locker !== null
    ? String(locker).trim()
    : null;
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
  if (!locker && !locker2 && !bolsa && !candado) {
    return res.status(400).json({
        mensaje: 'Debes indicar un locker, una bolsa o un candado'
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
// VALIDAR LOCKER
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
// VALIDAR LOCKER2
// -------------------------------------------------

    if (locker2) {

        const lockerOcupado = await client.query(
            `
                SELECT rut
                FROM usuarios
                WHERE locker = $1
                AND rut <> $2
            `,
            [locker2, rut]
        );

        if (lockerOcupado.rows.length > 0) {

            await client.query('ROLLBACK');

            return res.status(409).json({
                mensaje: `El locker ${locker2} ya está asignado a otro RUT`
            });

        }
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
    
    if (locker) {

    campos.push(`locker = $${posicion}`);
    valores.push(locker);

    posicion++;

    }
    
    if (locker2 !== null && locker2 !== undefined) {
    campos.push(`locker2 = $${posicion}`);
    valores.push(locker2);
    posicion++;
    }



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
        RETURNING rut, nombre, locker,locker2, bolsa, candado
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
    locker,
    bolsa,
    candado
} = req.body;


  // ---------------------------------------------------
  // Validar datos obligatorios
  // ---------------------------------------------------

  if (!rut || !nombre || !locker) {
    return res.status(400).json({
        mensaje: 'RUT, Nombre y Locker son obligatorios'
    });
}


  rut = String(rut).trim();
  nombre = String(nombre).trim();
  locker = String(locker).trim();


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
        VALUES ($1, $2, $3, $4, $5)
        RETURNING rut, nombre, locker, bolsa, candado
      `,
        [
        rut,
        nombre,
        locker,
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

/* =========================================
   INVENTARIO COMPLETO PARA ADMINISTRACIÓN
========================================= */

app.get('/api/lockers/administracion', async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        l.codigo,
        l.estado_operativo,
        EXISTS (
          SELECT 1
          FROM usuarios u
          CROSS JOIN LATERAL (
            VALUES
              (TRIM(u.locker)),
              (TRIM(u.locker2))
          ) AS a(valor)
          WHERE a.valor IS NOT NULL
            AND a.valor <> ''
            AND RIGHT(a.valor, 6) = l.codigo
        ) AS asignado
      FROM lockers l
      ORDER BY l.codigo
    `);

    res.json({
      total: resultado.rows.length,
      lockers: resultado.rows
    });

  } catch (error) {
    console.error('Error al consultar inventario:', error);
    res.status(500).json({
      mensaje: 'Error al consultar el inventario de lockers'
    });
  }
});


/* =========================================
   CAMBIAR ESTADO OPERATIVO DE UN LOCKER
========================================= */

app.put('/api/lockers/:codigo/estado', async (req, res) => {
  const { codigo } = req.params;
  const { estado_operativo } = req.body;

  if (!['operativo', 'fuera_servicio'].includes(estado_operativo)) {
    return res.status(400).json({
      mensaje: 'Estado inválido'
    });
  }

  try {
    const resultado = await pool.query(
      `
        UPDATE lockers
        SET estado_operativo = $1
        WHERE codigo = $2
        RETURNING codigo, estado_operativo
      `,
      [estado_operativo, codigo]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensaje: 'No se encontró el locker indicado'
      });
    }

    res.json({
      mensaje: 'Estado del locker actualizado correctamente',
      locker: resultado.rows[0]
    });

  } catch (error) {
    console.error('Error al cambiar estado del locker:', error);
    res.status(500).json({
      mensaje: 'Error al actualizar el estado del locker'
    });
  }
});



// =====================================================

/* =====================================================
   CONSULTA MASIVA DE LOCKERS DESDE EXCEL
   Entrada: archivo Excel con columna RUT
   Salida: Excel con una fila por trabajador
===================================================== */

const multer = require('multer');
const XLSX = require('xlsx');

const cargaExcelRuts = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const nombre = (file.originalname || '').toLowerCase();
    const esExcel = nombre.endsWith('.xlsx') || nombre.endsWith('.xls');
    if (!esExcel) {
      return cb(new Error('Debes subir un archivo Excel .xlsx o .xls'));
    }
    cb(null, true);
  }
});

function normalizarRutMasivo(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]/g, '')
    .replace(/[^0-9K]/g, '');
}

app.post(
  '/api/usuarios/consulta-masiva',
  (req, res, next) => {
    cargaExcelRuts.single('archivo')(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          mensaje: error.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo supera el límite de 2 MB'
            : error.message || 'No se pudo procesar el archivo'
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          mensaje: 'Debes seleccionar un archivo Excel'
        });
      }

      let libro;
      try {
        libro = XLSX.read(req.file.buffer, {
          type: 'buffer',
          cellDates: false
        });
      } catch {
        return res.status(400).json({
          mensaje: 'El archivo no es un Excel válido o está dañado'
        });
      }

      const nombreHoja = libro.SheetNames[0];
      if (!nombreHoja) {
        return res.status(400).json({
          mensaje: 'El archivo Excel no contiene hojas'
        });
      }

      const hoja = libro.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, {
        header: 1,
        defval: '',
        raw: false
      });

      if (!filas.length) {
        return res.status(400).json({
          mensaje: 'La primera hoja del Excel está vacía'
        });
      }

      // Busca una columna llamada RUT; si no existe, utiliza la primera columna.
      const encabezados = filas[0].map(v => String(v || '').trim().toUpperCase());
      let indiceRut = encabezados.findIndex(v => v === 'RUT' || v === 'RUN');
      let inicioDatos = 0;

      if (indiceRut >= 0) {
        inicioDatos = 1;
      } else {
        indiceRut = 0;
        // Si la primera celda parece un encabezado, omitir la primera fila.
        if (['RUT', 'RUN', 'RUT TRABAJADOR', 'RUT DEL TRABAJADOR'].includes(encabezados[0])) {
          inicioDatos = 1;
        }
      }

      const rutsEntrada = filas
        .slice(inicioDatos)
        .map((fila, indice) => ({
          filaExcel: indice + inicioDatos + 1,
          rutOriginal: String(fila[indiceRut] ?? '').trim(),
          rutNormalizado: normalizarRutMasivo(fila[indiceRut])
        }))
        .filter(item => item.rutOriginal !== '');

      if (!rutsEntrada.length) {
        return res.status(400).json({
          mensaje: 'No se encontraron RUT en la primera columna o en la columna RUT'
        });
      }

      if (rutsEntrada.length > 500) {
        return res.status(400).json({
          mensaje: 'El archivo contiene más de 500 RUT. Divide la lista en archivos más pequeños.'
        });
      }

      const invalidos = rutsEntrada.filter(item =>
        !/^\d{7,8}[0-9K]$/.test(item.rutNormalizado)
      );

      if (invalidos.length) {
        return res.status(400).json({
          mensaje: `Hay ${invalidos.length} RUT con formato inválido. Revisa las filas: ${invalidos.slice(0, 10).map(x => x.filaExcel).join(', ')}${invalidos.length > 10 ? '…' : ''}.`
        });
      }

      const rutsUnicos = [...new Set(rutsEntrada.map(item => item.rutNormalizado))];

      const resultado = await pool.query(
        `
          SELECT rut, nombre, locker, locker2
          FROM usuarios
          WHERE REGEXP_REPLACE(UPPER(TRIM(rut)), '[^0-9K]', '', 'g') = ANY($1::text[])
        `,
        [rutsUnicos]
      );

      const usuariosPorRut = new Map();
      for (const usuario of resultado.rows) {
        usuariosPorRut.set(normalizarRutMasivo(usuario.rut), usuario);
      }

      const informe = rutsEntrada.map(item => {
        const usuario = usuariosPorRut.get(item.rutNormalizado);
        if (!usuario) {
          return {
            'RUT consultado': item.rutOriginal,
            'Nombre': '',
            'Locker 1': '',
            'Locker 2': '',
            'Estado': 'RUT no encontrado'
          };
        }

        const locker1 = String(usuario.locker || '').trim();
        const locker2 = String(usuario.locker2 || '').trim();
        const tieneLocker = Boolean(locker1 || locker2);

        return {
          'RUT consultado': item.rutOriginal,
          'Nombre': usuario.nombre || '',
          'Locker 1': locker1,
          'Locker 2': locker2,
          'Estado': tieneLocker ? 'Encontrado' : 'Sin locker'
        };
      });

      const hojaInforme = XLSX.utils.json_to_sheet(informe);
      hojaInforme['!cols'] = [
        { wch: 20 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 22 }
      ];

      const libroInforme = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libroInforme, hojaInforme, 'Consulta masiva');

      const excelSalida = XLSX.write(libroInforme, {
        type: 'buffer',
        bookType: 'xlsx'
      });

      const fecha = new Date().toISOString().slice(0, 10);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="informe_lockers_${fecha}.xlsx"`
      );
      res.setHeader('X-Total-Ruts', String(informe.length));
      res.send(excelSalida);
    } catch (error) {
      console.error('Error en consulta masiva de lockers:', error);
      res.status(500).json({
        mensaje: 'Ocurrió un error al generar el informe de consulta masiva'
      });
    }
  }
);

// Maneja errores de carga que no hayan sido procesados en la ruta.

// INICIAR SERVIDOR
// =====================================================

app.listen(3000, () => {

  console.log(
    'Servidor corriendo en el puerto 3000'
  );

});