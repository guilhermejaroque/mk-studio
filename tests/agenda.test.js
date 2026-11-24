const test = require('node:test');
const assert = require('node:assert/strict');
const { carregar } = require('./carregar');
const { fake, post } = require('./fake-planilha');

const CAB = ['ID', 'Data', 'Horário', 'Fim', 'Profissional', 'Serviço', 'Cliente', 'Telefone', 'Observação', 'Status', 'Execução', 'Valor'];

function novo() {
  const g = fake({
    Agenda: [CAB, ['a1', '2026-11-25', '08:00', '09:30', 'Katia', 'Manicure', 'Ana', '', '', 'confirmado', '', '']],
    Profissionais: [['ID', 'Nome'], ['katia', 'Katia'], ['suenia', 'Suênia']],
    'Serviços': [['Serviço', 'Preço', 'Por unidade'], ['Manicure', 40, 'não']],
    Bloqueios: [['Data', 'Profissional', 'Horário', 'Motivo']],
    'Horários': [['terca', 'sim']]
  }, { hoje: '2026-11-25' });
  const fns = carregar(['mk-agenda-app/Codigo.gs'], g);
  const ag = g._planilha.abas.Agenda;
  const col = n => ag.linhas[0].indexOf(n);
  const p = extra => post(fns, { codigo: 'KatiaMK', acao: 'marcar', linha: 2, id: 'a1', ...extra });
  return { ag, col, p };
}

test('marcar feito grava a forma de pagamento na coluna Pagamento', () => {
  const { ag, col, p } = novo();
  const r = p({ execucao: 'feito', valorCheio: 100, pagamento: 'credito' });
  assert.equal(r.ok, true);
  assert.ok(col('Pagamento') >= 0);
  assert.equal(ag.linhas[1][col('Pagamento')], 'credito');
  assert.equal(r.atendimentos[0].pagamento, 'credito');
});

test('marcar feito sem Pix, Crédito ou Débito é recusado', () => {
  const { p } = novo();
  const r = p({ execucao: 'feito', valorCheio: 100, pagamento: 'dinheiro' });
  assert.deepEqual([r.ok, r.erro], [false, 'Escolha Pix, Crédito ou Débito.']);
});

test('não feito e desfazer limpam a forma de pagamento', () => {
  const { ag, col, p } = novo();
  p({ execucao: 'feito', valorCheio: 100, pagamento: 'pix' });
  p({ execucao: '' });
  assert.equal(ag.linhas[1][col('Pagamento')], '');
  p({ execucao: 'feito', valorCheio: 100, pagamento: 'debito' });
  p({ execucao: 'nao_feito' });
  assert.equal(ag.linhas[1][col('Pagamento')], '');
});

test('final: página antiga sem forma de pagamento ainda consegue marcar feito', () => {
  const { ag, col, p } = novo();
  const r = p({ execucao: 'feito', valorCheio: 100 });
  assert.equal(r.ok, true);
  assert.equal(ag.linhas[1][col('Execução')], 'feito');
  assert.equal(ag.linhas[1][col('Pagamento')], '');
});
