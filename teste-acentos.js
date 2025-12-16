const Firebird = require('node-firebird');
const iconv = require('iconv-lite'); // Módulo necessário para a conversão de caracteres

// --- 🛠️ CONFIGURAÇÕES DE CONEXÃO ---
const dbOptions = {
    host: '127.0.0.1',
    port: 3050,
    database: 'C:/GDOOR Sistemas/GDOOR PRO/DATAGES.FDB',
    user: 'SYSDBA',
    password: 'masterkey',
    
    // 🎯 CONFIGURAÇÃO CRUCIAL:
    // Define o encoding como NONE para garantir que os bytes cheguem "crus".
    encoding: 'NONE', 

    // Outras opções padrão:
    lowercase_keys: false,
    pageSize: 4096 
};

// --- FUNÇÃO PRINCIPAL DE CONEXÃO E QUERY ---
Firebird.attach(dbOptions, function(err, db) {
    if (err) {
        console.error('❌ ERRO DE CONEXÃO:', err.message);
        return;
    }

    console.log('✅ Conectado ao banco de dados (Encoding: NONE para conversão manual)');

    const sql = `SELECT FIRST 10
        d.ID,
        d.OBS AS OBSERVACAO
        FROM DAVS d
        WHERE d.OBS IS NOT NULL AND TRIM(d.OBS) <> ''
        ORDER BY d.ID DESC`; 

    db.query(sql, function(err, rows) {
        if (err) {
            console.error('❌ ERRO NA QUERY:', err.message);
            db.detach();
            return;
        }

        if (rows.length === 0) {
            console.log('Nenhum DAV com OBS encontrado.');
            db.detach();
            return;
        }

        console.log('\n=== RESULTADO FINAL (Conversão manual: latin1 -> ISO-8859-1) ===');
        rows.forEach(r => {
            let obs = r.OBSERVACAO;
            
            if (typeof obs === 'string' && obs.length > 0) {
                // 1. Cria o Buffer: Interpreta a string JavaScript corrompida como Latin1/Binária.
                const buffer = Buffer.from(obs, 'latin1'); 
                
                // 2. Decodifica: Força a reinterpretação dos bytes como a codificação Latin-1 (ISO-8859-1).
                obs = iconv.decode(buffer, 'ISO-8859-1'); 
            }
            console.log(`ID: ${r.ID} | OBS: "${obs}"`);
        });

        db.detach();
        console.log('\nTeste de conversão concluído com sucesso.');
    });
});