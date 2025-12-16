const express = require('express');
const Firebird = require('node-firebird');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = socketIo(server);

const dbOptions = {
  host: '127.0.0.1',
  port: 3050,
  database: 'C:/GDOOR Sistemas/GDOOR PRO/DATAGES.FDB',
  user: 'SYSDBA',
  password: 'masterkey',
  lowercase_keys: false,
  pageSize: 4096
};

function buscarPedidos(callback) {
  Firebird.attach(dbOptions, function(err, db) {
    if (err) {
      console.error('Erro ao conectar no Firebird:', err.message);
      return callback(err);
    }

    const sql = `
      SELECT
        di.IDDAV,
        di.ITEM,
        di.QT,
        di.UN,
        di.STATUS,
        COALESCE(di.KDS_PRONTO, 0) AS KDS_PRONTO,
        e.DESCRICAO,
        CAST(d.DATA_EMISSAO || ' ' || d.HORA_EMISSAO AS TIMESTAMP) AS DATA_HORA_EMISSAO,
        CASE
          WHEN COALESCE(d.NUMERO, 0) > 0 THEN 'Mesa ' || CAST(d.NUMERO AS VARCHAR(10))
          ELSE 'Balcão'
        END AS MESA,
        d.OBS AS OBSERVACAO,
        COALESCE(v2.NOME, 'Não informado') AS ATENDENTE_PEDIDO,
        COALESCE(v.NOME, 'Não informado') AS VENDEDOR_ITEM
      FROM DAVS_ITENS di
      JOIN ESTOQUE e ON di.IDPRODUTO = e.CODIGO
      JOIN DAVS d ON di.IDDAV = d.ID
      LEFT JOIN VENDEDOR v ON di.IDVENDEDOR_ITEM = v.ID
      LEFT JOIN VENDEDOR v2 ON d.IDVENDEDOR = v2.ID
      -- FILTRO: Apenas produtos cujo grupo está na tabela GRUPO_KDS
      INNER JOIN GRUPO_KDS gk ON UPPER(TRIM(e.GRUPO)) = UPPER(TRIM(gk.NOME_GRUPO))
      WHERE di.STATUS = 0
        AND COALESCE(di.KDS_PRONTO, 0) = 0
        AND d.IDSTATUS IN (1, 2)
        AND EXISTS (
          SELECT 1 FROM DAVS_ITENS di2
          JOIN ESTOQUE e2 ON di2.IDPRODUTO = e2.CODIGO
          WHERE di2.IDDAV = di.IDDAV
            AND di2.STATUS = 0
            AND COALESCE(di2.KDS_PRONTO, 0) = 0
            AND EXISTS (
              SELECT 1 FROM GRUPO_KDS gk2 
              WHERE UPPER(TRIM(e2.GRUPO)) = UPPER(TRIM(gk2.NOME_GRUPO))
            )
        )
      ORDER BY DATA_HORA_EMISSAO ASC, di.IDDAV, di.ITEM
    `;

    db.query(sql, function(err, rows) {
      db.detach();
      if (err) {
        console.error('Erro na consulta de pedidos:', err.message);
        return callback(err);
      }
      callback(null, rows);
    });
  });
}

app.get('/api/pedidos', (req, res) => {
  buscarPedidos((err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Falha ao conectar ao banco de dados' });
    }
    res.json(rows);
  });
});

app.post('/api/item/pronto', (req, res) => {
  const { idDav, item } = req.body;

  if (!idDav || !item) {
    return res.status(400).json({ sucesso: false, error: 'Parâmetros inválidos' });
  }

  Firebird.attach(dbOptions, (err, db) => {
    if (err) return res.status(500).json({ sucesso: false, error: err.message });

    db.query(
      'UPDATE DAVS_ITENS SET KDS_PRONTO = 1 WHERE IDDAV = ? AND ITEM = ?',
      [idDav, item],
      (err) => {
        db.detach();
        if (err) {
          console.error('Erro ao marcar item como pronto:', err);
          return res.status(500).json({ sucesso: false, error: err.message });
        }
        res.json({ sucesso: true });
      }
    );
  });
});

app.post('/api/pedido/pronto', (req, res) => {
  const { idDav } = req.body;

  if (!idDav) {
    return res.status(400).json({ sucesso: false, error: 'ID do pedido inválido' });
  }

  Firebird.attach(dbOptions, (err, db) => {
    if (err) {
      console.error('Erro ao conectar:', err);
      return res.status(500).json({ sucesso: false, error: err.message });
    }

    const sqlDados = `
      SELECT 
        d.ID,
        CASE WHEN COALESCE(d.NUMERO, 0) > 0 THEN 'Mesa ' || CAST(d.NUMERO AS VARCHAR(10)) ELSE 'Balcão' END AS MESA,
        CAST(d.DATA_EMISSAO || ' ' || d.HORA_EMISSAO AS TIMESTAMP) AS DATA_HORA_EMISSAO,
        d.OBS,
        COALESCE(v.NOME, 'Não informado') AS ATENDENTE,
        di.QT,
        e.DESCRICAO
      FROM DAVS d
      LEFT JOIN VENDEDOR v ON d.IDVENDEDOR = v.ID
      JOIN DAVS_ITENS di ON di.IDDAV = d.ID
      JOIN ESTOQUE e ON di.IDPRODUTO = e.CODIGO
      WHERE d.ID = ?
        AND d.IDSTATUS IN (1, 2)
      ORDER BY di.ITEM
    `;

    db.query(sqlDados, [idDav], (err, rows) => {
      if (err) {
        db.detach();
        console.error('Erro na consulta SQL para impressão:', err);
        return res.status(500).json({ sucesso: false, error: 'Erro ao buscar dados do pedido' });
      }

      if (rows.length === 0) {
        db.detach();
        return res.status(404).json({ sucesso: false, error: 'Pedido não encontrado ou já concluído/cancelado' });
      }

      const agora = new Date();
      const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dataEmissao = new Date(rows[0].DATA_HORA_EMISSAO);
      const diffMs = agora - dataEmissao;
      const diffMin = Math.floor(diffMs / 60000);

      const tempoProducao = diffMin < 60 
        ? `${diffMin} min`
        : `${Math.floor(diffMin / 60)}h ${diffMin % 60}min`.trim();

      const mesa = rows[0].MESA.trim();
      const observacao = rows[0].OBS ? rows[0].OBS.trim() : '';
      const atendente = rows[0].ATENDENTE.trim();

      const pedido = rows.map(r => ({
        QT: r.QT,
        DESCRICAO: r.DESCRICAO.trim()
      }));

      db.query(
        'UPDATE DAVS_ITENS SET KDS_PRONTO = 1 WHERE IDDAV = ? AND COALESCE(KDS_PRONTO, 0) = 0',
        [idDav],
        (err) => {
          db.detach();
          if (err) {
            console.error('Erro ao atualizar KDS_PRONTO:', err);
            return res.status(500).json({ sucesso: false, error: 'Erro ao finalizar pedido' });
          }

          res.json({
            sucesso: true,
            mesa,
            hora,
            tempoProducao,
            atendente,
            observacao,
            pedido
          });
        }
      );
    });
  });
});

let clientesConectados = 0;

io.on('connection', (socket) => {
  clientesConectados++;
  console.log(`Cliente KDS conectado (${clientesConectados} ativo(s))`);

  buscarPedidos((err, rows) => {
    if (!err) socket.emit('atualizar', rows);
  });

  socket.on('disconnect', () => {
    clientesConectados--;
    console.log(`Cliente desconectado (${clientesConectados} ativo(s))`);
  });
});

setInterval(() => {
  if (clientesConectados > 0) {
    buscarPedidos((err, rows) => {
      if (!err) {
        io.emit('atualizar', rows);
      }
    });
  }
}, 10000);

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('=====================================');
  console.log('KDS - Monitor de Cozinha RODANDO!');
  console.log(`Acesse em: http://localhost:${PORT} ou pelo IP da máquina na rede`);
  console.log('=====================================');
});