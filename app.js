const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const port = 3000;
const sql = require('mssql');
const fs = require('fs');
const { Console } = require('console');
const sqlite3 = require('sqlite3').verbose();
const maxOnPatio = 100;
const maxMinPermitidos = 130;

var allowCrossDomain = function (req, res, next) {
    res.header('Access-Control-Allow-Origin', "*");
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
}

const connStr = "Server=192.168.100.92;Database=Segauto;User Id=link;Password=ti159753;";
//const connStr = "Server=127.0.0.1;Database=Segauto;User Id=link;Password=ti159753;";

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(allowCrossDomain);

sql.connect(connStr)
    .then(conn => global.conn = conn)
    .catch(err => console.log(err));

const router = express.Router();

router.get('/', (req, res) => res.json({ message: 'Funcionando!' }));
app.use('/', router);

function execSQLQuery(sqlQry, res) {
    global.conn.request()
        .query(sqlQry)
        .then(result => res.json(result.recordset))
        .catch(err => res.json(err));
}

router.get('/getTicket/:ticket', (req, res) => {
    updateOnPatio();
    execSQLQuery(`SELECT TOP 1000 * FROM [Segauto].[dbo].[Movimento] 
    WHERE [Segauto].[dbo].[Movimento].[MovTic] = ${req.params.ticket}
    AND [Segauto].[dbo].[Movimento].[MovDatSai] IS NULL
    `, res);
});

router.get('/checkTicket/:ticket', (req, res) => {

    updateOnPatio();

    let ticket = JSON.parse(req.params.ticket);

    if (ticket[0]) { ticket = ticket[0] }
    else { res.json('Erro ao encontrar Ticket! Tente Novamente') }

    // TESTA O PATIO E A ENTRADA QUE ELE UTILIZOU --------------------
    let MovTerEnt = ticket.MovTerEnt;
    let MovPat = ticket.MovPat;

    if (MovTerEnt == 'EN02') { }
    else { res.json('ENTRADA POR PATIO Ñ PERMITIDO') }

    // VERIFICAR SE O TICKET ESTÁ DENTRO DAS DUAS HORAS --------------
    let datEntrada = new Date(ticket.MovDatEnt);
    let hoursDiff = ((new Date() - datEntrada) / 3600000 - 3);

    if (hoursDiff < (maxMinPermitidos / 60)) { }
    else { res.json('TICKET FORA DO HORARIO PERMITIDO') }

    // SE FORA DO HORÁRIO PERMITIDO, DEVO JOGAR NO PÁTIO MESMO ASSIM
    // ELE UTILIZOU AS DUAS HORAS

    res.json('Ticket pronto pra ser validado');

});

router.get('/validateCPF/:cpf/:ticket', (req, res) => {

    updateOnPatio();

    var ticket = JSON.parse(req.params.ticket);

    let db = new sqlite3.Database('database.db', (err) => {
        if (err) { return console.error(err.message) }
    });

    let checkOnPatio = 'SELECT * FROM LIBERATIONS WHERE ONPATIO = "TRUE"';

    db.all(checkOnPatio, [], (err, rows) => {

        var flagReturn = false;

        rows.forEach(liberation => {
            if (liberation.TICKET == ticket.MovTic)
                res.json({ message: 'TICKET JÁ FOI VALIDADO!' })
            flagReturn = true;
        });

        if (!flagReturn) {
            // CHECA SE A QUANTIDADE MÁXIMA DE VEÍCULOS NO PÁTIO FOI EXCEDIDA
            if (rows.length > maxOnPatio) {
                res.json({ message: "Ops! A quantidade máxima de vagas foi excedida!" });
            } else {

                let choosen = { message: "Ops! Não encontramos este CPF em nossa base de dados!" };

                try {

                    // BUSCA A LISTA DE ALUNOS CADASTRADOS NA ACADEMIA
                    const data = fs.readFileSync('Academia.txt', 'UTF-8');
                    const lines = data.split(/\r?\n/);

                    lines.forEach(line => {
                        var splitter = line.split(";");

                        var aluno = {
                            matricula: splitter[0],
                            nome: splitter[1],
                            dtInicio: splitter[2],
                            dtFim: splitter[3],
                            vlfixo: splitter[4],
                            cpf: splitter[5]
                        }

                        if (aluno.cpf == req.params.cpf) {
                            var d1 = new Date(aluno.dtInicio);
                            var d2 = new Date(aluno.dtFim);
                            var actualDate = new Date();
                            if ((actualDate > d1) && (actualDate < d2)) {
                                choosen = aluno;
                            } else {
                                choosen = { message: "Ops! Sua matrícula está fora do período de vigência!" };
                            }
                        }

                    });

                } catch (error) { res.json(error) }

                // VERIFICA AS LIBERAÇÕES UTILIZADAS ANTERIORMENTE PELO CPF
                let query = 'SELECT * FROM LIBERATIONS WHERE CPF = ? AND ONPATIO = "TRUE"';

                let actualDate = new Date();

                if (!choosen.message) {
                    db.all(query, [req.params.cpf], (err, rows) => {
                        if (err) { throw err }
                        let sumMinutes = 0;
                        let liberations = [];
                        rows.forEach((row) => {
                            let date = new Date(row.DATA);
                            let diffInTime = actualDate.getTime() - date.getTime();
                            let diffInDays = diffInTime / (1000 * 3600 * 24);
                            if (diffInDays < 1) {
                                liberations.push(row);
                                sumMinutes += row.MINUTES;
                            }
                        });

                        choosen.sumMinutes = sumMinutes;
                        choosen.liberations = liberations;

                        if (sumMinutes > maxMinPermitidos) {
                            res.json({ message: "Ops! Você não possui mais minutos liberados no estacionamento!", choosen: choosen })
                        } else {

                            var date = `${actualDate.getMonth() + 1}/${actualDate.getDate()}/${actualDate.getFullYear()}`;

                            var diffMs = (actualDate - new Date(ticket.MovDatEnt)); // milliseconds between now & Christmas
                            var diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000); // minutes

                            if (actualDate.getDate() < 10)
                                date = `${actualDate.getMonth() + 1}/0${actualDate.getDate()}/${actualDate.getFullYear()}`;

                            let insertQuery = `
                            INSERT INTO LIBERATIONS(CPF, TICKET, MINUTES, DATA, ONPATIO)
                            VALUES(?, ?, ?, ?, ?)
                        `;

                            db.all(insertQuery, [req.params.cpf, ticket.MovTic, diffMins, date, 'TRUE'], (err2, rows2) => {
                                res.json({ message: 'TICKET VALIDADO COM SUCESSO!', choosen: choosen })
                            });

                        }

                    });
                } else { res.json(choosen) }

            }
        }

    });

    db.close();

});

router.get('/getLiberations', (req, res) => {

    updateOnPatio();

    let checkOnPatio = 'SELECT * FROM LIBERATIONS WHERE ONPATIO = "TRUE"';

    db.all(checkOnPatio, [], (err, rows) => {

        rows.forEach(liberation => {
            if (liberation.TICKET == ticket.MovTic)
                res.json({ message: 'TICKET JÁ FOI VALIDADO!' })
        });
    });

    db.close();

});

function updateOnPatio(res) {

    // ATUALIZANDO STATUS DOS DOCUMENTOS NO PÁTIO

    let db = new sqlite3.Database('database.db', (err) => {
        if (err) { return console.error(err.message) }
    });

    let checkOnPatio = 'SELECT * FROM LIBERATIONS WHERE ONPATIO = "TRUE"';

    // db.all(checkOnPatio, [], (err, rows) => {
    //     rows.forEach(ticket => {

    //         console.log(ticket);

    //         let getTicket = `
    //         SELECT TOP 1 * FROM [Segauto].[dbo].[Movimento] 
    //         WHERE [Segauto].[dbo].[Movimento].[MovTic] = ${ticket.TICKET}
    //             `;

    //         global.conn.request()
    //             .query(getTicket)
    //             .then(result => {cconsole.log(result.recordset)
    // 1 - verificar se ainda está no pátio
    // 2 - calcular os minutos
    // 3 - inserir os minutos no Liberations
    //})
    //             .catch(err => res.json(err));
    //     })
    // });

    db.close();

}

app.listen(port);

console.log('Integração Link - Selfit ONLINE');