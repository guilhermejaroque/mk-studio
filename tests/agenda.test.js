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
  }, { hoje: '2026-11-25', props: { CODIGO_katia: 'KatiaMK', CODIGO_suenia: 'SueniaMK' } });
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

const CAB_EST = ['ID', 'Item', 'Unidade', 'Quantidade', 'Mínimo'];
function comEstoque(linhasEstoque) {
  const abas = {
    Agenda: [CAB], Profissionais: [['ID', 'Nome'], ['katia', 'Katia']],
    'Serviços': [['Serviço', 'Preço', 'Por unidade']], Bloqueios: [['Data', 'Profissional', 'Horário', 'Motivo']], 'Horários': [['terca', 'sim']]
  };
  if (linhasEstoque) abas.Estoque = linhasEstoque;
  const g = fake(abas, { hoje: '2026-11-25', props: { CODIGO_katia: 'KatiaMK', CODIGO_suenia: 'SueniaMK' } });
  const fns = carregar(['mk-agenda-app/Codigo.gs'], g);
  return { g, p: (acao, extra = {}) => post(fns, { codigo: 'SueniaMK', acao, ...extra }) };
}

test('estoque: sem a aba, cria com o cabeçalho da gestão e devolve lista vazia', () => {
  const { g, p } = comEstoque(null);
  const r = p('estoque');
  assert.equal(r.ok, true);
  assert.equal(r.estoque.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(g._planilha.abas.Estoque.linhas[0])), CAB_EST);
});

test('estoque: cadastrar, tirar até zero (fica primeiro), apagar e nome vazio', () => {
  const { p } = comEstoque([CAB_EST, ['e1', 'Algodão', 'pacotes', 10, 2]]);
  let r = p('salvarItem', { item: { item: 'Acetona', unidade: 'frascos', quantidade: 2, minimo: 1 } });
  assert.equal(r.estoque.length, 2);
  const id = r.estoque.find(i => i.item === 'Acetona').id;
  r = p('ajusteEstoque', { id, delta: -5 });
  assert.equal(r.estoque[0].item, 'Acetona');
  assert.equal(r.estoque[0].quantidade, 0);
  r = p('salvarItem', { item: { id: 'e1', item: 'Algodão', unidade: 'pacotes', quantidade: 8, minimo: 2 } });
  assert.equal(r.estoque.find(i => i.id === 'e1').quantidade, 8);
  r = p('apagarItem', { id });
  assert.deepEqual(JSON.parse(JSON.stringify(r.estoque.map(i => i.item))), ['Algodão']);
  assert.equal(p('salvarItem', { item: { item: '  ' } }).ok, false);
});

test('códigos das manicures vêm das propriedades do script', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'mk-agenda-app', 'Codigo.gs'), 'utf8');
  assert.ok(!/KatiaMK|SueniaMK/.test(src));
  const g = fake({ Profissionais: [['ID', 'Nome'], ['katia', 'Katia']] }, { hoje: '2026-11-25', props: { CODIGO_katia: 'K-nova' } });
  const fns = carregar(['mk-agenda-app/Codigo.gs'], g);
  assert.equal(post(fns, { codigo: 'KatiaMK', acao: 'login' }).ok, false);
  const r = post(fns, { codigo: 'K-nova', acao: 'login' });
  assert.deepEqual([r.ok, r.profissional.id, r.profissional.nome], [true, 'katia', 'Katia']);
  assert.equal(post(fns, { codigo: '', acao: 'login' }).ok, false);
});
