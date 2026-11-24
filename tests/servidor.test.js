const test = require('node:test');
const assert = require('node:assert/strict');
const { carregar } = require('./carregar');
const { fake, post } = require('./fake-planilha');

const CAB_AGENDA = ['ID', 'Data', 'Horário', 'Profissional', 'Serviço', 'Cliente', 'Status', 'Execução', 'Valor', 'Pagamento'];

function novo(opcoes = {}) {
  const agenda = opcoes.agenda || [
    CAB_AGENDA,
    ['a1', '2026-11-24', '08:00', 'Katia', 'Mão', 'Ana', 'confirmado', 'feito', 100, 'credito'],
    ['a2', '2026-11-24', '09:30', 'Suênia', 'Pé', 'Bia', 'confirmado', 'feito', 80, 'pix']
  ];
  const g = fake({
    Agenda: agenda,
    Profissionais: [['ID', 'Nome'], ['katia', 'Katia'], ['suenia', 'Suênia'], ['carla', 'Carla']]
  }, { hoje: '2026-11-25', props: { CODIGO_DONO: 'DonoMK' } });
  const fns = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g);
  const p = (acao, extra = {}) => post(fns, { codigo: 'DonoMK', acao, ...extra });
  return { g, fns, p, abas: g._planilha.abas };
}

test('código de manicure não entra; código do dono entra', () => {
  const { fns } = novo();
  assert.equal(post(fns, { codigo: 'KatiaMK', acao: 'login' }).ok, false);
  assert.equal(post(fns, { codigo: 'DonoMK', acao: 'login' }).ok, true);
});

test('primeiro acesso cria as abas, as duas salas (só a 1 ocupada) e taxas 0', () => {
  const { p, abas } = novo();
  const d = p('dados');
  assert.equal(d.ok, true);
  ['Contas', 'Lançamentos', 'Salas', 'Aluguéis', 'Pagamentos', 'Estoque', 'Config'].forEach(n => assert.ok(abas[n], n));
  assert.deepEqual(JSON.parse(JSON.stringify(d.salas.map(s => [s.id, s.valor, s.ocupada]))), [['S1', 300, true], ['S2', 300, false]]);
  assert.deepEqual(JSON.parse(JSON.stringify(d.config.taxas)), { pix: 0, credito: 0, debito: 0 });
  assert.equal(d.config.inicio, '2026-11-23');
  assert.equal(d.mes, '2026-11');
  assert.equal(d.entradas.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(d.semanas[0].profissionais.map(x => x.nome))), ['Katia', 'Suênia']);
});

test('conta fixa lançada duas vezes no mesmo mês fica uma linha só, com histórico', () => {
  const { p, abas } = novo();
  p('dados');
  const conta = p('salvarConta', { conta: { nome: 'Luz', categoria: 'Fixas', fixa: true, ativa: true } }).contas[0];
  p('lancar', { lancamento: { contaId: conta.id, valor: 200, pago: false } });
  const d = p('lancar', { lancamento: { contaId: conta.id, valor: 210, pago: true } });
  assert.equal(abas['Lançamentos'].linhas.length, 2);
  assert.deepEqual([d.contas[0].lanc.valor, d.contas[0].lanc.pago], [210, true]);
  assert.equal(d.resumo.saiu.contas, 210);
  const h = p('historicoConta', { id: conta.id });
  assert.deepEqual(JSON.parse(JSON.stringify(h.historico)), [{ mes: '2026-11', valor: 210, pago: true }]);
});

test('gasto avulso de material entra em Saiu > Material e pode ser apagado', () => {
  const { p } = novo();
  p('dados');
  let d = p('lancar', { lancamento: { descricao: 'Acetona', categoria: 'Material', valor: 60, pago: true } });
  assert.equal(d.avulsos.length, 1);
  assert.equal(d.resumo.saiu.material, 60);
  d = p('apagarLancamento', { id: d.avulsos[0].id });
  assert.equal(d.avulsos.length, 0);
});

test('aluguel recebido entra no mês; sala desocupada continua no passado e some do futuro', () => {
  const { p } = novo();
  p('dados');
  let d = p('aluguel', { salaId: 'S1', recebido: true });
  assert.equal(d.resumo.entrou.alugueis, 300);
  assert.deepEqual(JSON.parse(JSON.stringify(d.alugueis.map(a => [a.salaId, a.recebido]))), [['S1', true]]);
  p('salvarSala', { sala: { id: 'S1', nome: 'Sala 1', valor: 300, ocupada: false } });
  d = p('dados', { mes: '2026-11' });
  assert.equal(d.alugueis.length, 1);
  d = p('dados', { mes: '2026-12' });
  assert.equal(d.alugueis.length, 0);
});

test('sala ocupada aparece no mês atual como não recebida', () => {
  const { p } = novo();
  const d = p('dados');
  assert.deepEqual(JSON.parse(JSON.stringify(d.alugueis.map(a => [a.salaId, a.recebido, a.valor]))), [['S1', false, 300]]);
});

test('semana paga que muda depois mostra diferença sem criar outro pagamento', () => {
  const { p, abas } = novo();
  p('dados');
  let d = p('pagarSemana', { semana: '2026-11-23', profissional: 'Katia', valor: 50, pago: true });
  let k = d.semanas[0].profissionais.find(x => x.nome === 'Katia');
  assert.deepEqual([k.pago, k.diferenca, k.pagoEm], [true, 0, '2026-11-25']);
  abas.Agenda.linhas[1][8] = 120;          // valor mudou na agenda
  d = p('dados');
  k = d.semanas[0].profissionais.find(x => x.nome === 'Katia');
  assert.equal(k.diferenca, 10);
  assert.equal(abas.Pagamentos.linhas.length, 2);
  d = p('pagarSemana', { semana: '2026-11-23', profissional: 'Katia', pago: false });
  assert.equal(abas.Pagamentos.linhas.length, 1);
});

test('estoque: ajuste nunca fica negativo e item no mínimo vem primeiro', () => {
  const { p } = novo();
  p('dados');
  p('salvarItem', { item: { item: 'Algodão', unidade: 'pacotes', quantidade: 10, minimo: 2 } });
  let d = p('salvarItem', { item: { item: 'Acetona', unidade: 'frascos', quantidade: 2, minimo: 1 } });
  const acet = d.estoque.find(i => i.item === 'Acetona');
  d = p('ajusteEstoque', { id: acet.id, delta: -5 });
  assert.equal(d.estoque.find(i => i.item === 'Acetona').quantidade, 0);
  assert.equal(d.estoque[0].item, 'Acetona');
  d = p('apagarItem', { id: acet.id });
  assert.equal(d.estoque.length, 1);
});

test('taxas configuradas entram nas entradas e no resumo', () => {
  const { p } = novo();
  p('dados');
  const d = p('config', { taxas: { pix: 0, credito: 4, debito: 2 } });
  assert.equal(d.entradas.find(e => e.cliente === 'Ana').taxa, 4);
  assert.equal(d.resumo.saiu.taxas, 4);
});

test('agenda sem coluna Pagamento ainda calcula entradas com taxa 0', () => {
  const { p } = novo({
    agenda: [['ID', 'Data', 'Profissional', 'Serviço', 'Cliente', 'Status', 'Execução', 'Valor'],
      ['a1', '2026-11-24', 'Katia', 'Mão', 'Ana', 'confirmado', 'feito', 100]]
  });
  p('dados');
  const d = p('config', { taxas: { pix: 5, credito: 5, debito: 5 } });
  assert.equal(d.entradas.length, 1);
  assert.equal(d.entradas[0].taxa, 0);
});

test('conta desativada sai da lista do mês mas continua no cadastro', () => {
  const { p } = novo();
  p('dados');
  const id = p('salvarConta', { conta: { nome: 'Luz', categoria: 'Fixas', fixa: true, ativa: true } }).contas[0].id;
  const d = p('salvarConta', { conta: { id, nome: 'Luz', categoria: 'Fixas', fixa: true, ativa: false } });
  assert.equal(d.contas.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(d.cadastroContas)), [{ id, nome: 'Luz', categoria: 'Fixas', fixa: true, ativa: false }]);
});

test('dados de exemplo do modo demonstração funcionam no servidor de verdade', () => {
  const { exemplo } = require('../gestao/demo.js');
  const g = fake(exemplo('2026-11-25'), { hoje: '2026-11-25', props: { CODIGO_DONO: 'DonoMK' } });
  const fns = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g);
  const d = post(fns, { codigo: 'DonoMK', acao: 'dados' });
  assert.equal(d.ok, true);
  assert.ok(d.entradas.length > 10);
  assert.equal(d.semanas.length, 3);
  assert.equal(d.contas.length, 4);
  assert.equal(d.estoque[0].item, 'Acetona');
});

test('final: Valor com texto na agenda é ignorado e gasto com letras é recusado', () => {
  const { p } = novo({
    agenda: [CAB_AGENDA, ['a1', '2026-11-24', '08:00', 'Katia', 'Mão', 'Ana', 'confirmado', 'feito', 'a combinar', 'pix'],
      ['a2', '2026-11-24', '09:30', 'Katia', 'Pé', 'Bia', 'confirmado', 'feito', 80, 'pix']]
  });
  const d = p('dados');
  assert.equal(d.entradas.length, 1);
  const r = p('lancar', { lancamento: { descricao: 'X', categoria: 'Outros', valor: 'abc', pago: true } });
  assert.equal(r.ok, false);
});

test('final: atendimentos antes do início do app não entram nas entradas', () => {
  const { p } = novo({
    agenda: [CAB_AGENDA, ['a1', '2026-11-10', '08:00', 'Katia', 'Mão', 'Ana', 'confirmado', 'feito', 100, 'pix'],
      ['a2', '2026-11-24', '09:30', 'Katia', 'Pé', 'Bia', 'confirmado', 'feito', 80, 'pix']]
  });
  const d = p('dados');
  assert.equal(d.config.inicio, '2026-11-23');
  assert.deepEqual(JSON.parse(JSON.stringify(d.entradas.map(e => e.cliente))), ['Bia']);
  assert.equal(d.resumo.entrou.atendimentos, 80);
});

test('final: aluguel do mês passado ainda pode ser marcado depois que o mês virou', () => {
  const g = fake({
    Agenda: [CAB_AGENDA],
    Profissionais: [['ID', 'Nome'], ['katia', 'Katia']],
    Salas: [['ID', 'Nome', 'Valor mensal', 'Ocupada', 'Desde'], ['S1', 'Sala 1', 300, 'sim', "'2026-11"], ['S2', 'Sala 2', 300, 'não', '']],
    Config: [['Chave', 'Valor'], ['inicio', "'2026-11-02"]]
  }, { hoje: '2026-12-03', props: { CODIGO_DONO: 'DonoMK' } });
  const fns = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g);
  let d = post(fns, { codigo: 'DonoMK', acao: 'dados', mes: '2026-11' });
  assert.deepEqual(JSON.parse(JSON.stringify(d.alugueis.map(a => [a.salaId, a.recebido]))), [['S1', false]]);
  d = post(fns, { codigo: 'DonoMK', acao: 'aluguel', mes: '2026-11', salaId: 'S1', recebido: true });
  assert.equal(d.resumo.entrou.alugueis, 300);
  d = post(fns, { codigo: 'DonoMK', acao: 'dados', mes: '2026-10' });
  assert.equal(d.alugueis.length, 0);
});

test('final: sala que fica livre continua no mês atual e nos anteriores, some dos seguintes', () => {
  const g = fake({
    Agenda: [CAB_AGENDA],
    Profissionais: [['ID', 'Nome'], ['katia', 'Katia']],
    Salas: [['ID', 'Nome', 'Valor mensal', 'Ocupada', 'Desde'], ['S1', 'Sala 1', 300, 'sim', "'2026-10"], ['S2', 'Sala 2', 300, 'não', '']]
  }, { hoje: '2026-11-25', props: { CODIGO_DONO: 'DonoMK' } });
  const fns = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g);
  post(fns, { codigo: 'DonoMK', acao: 'salvarSala', sala: { id: 'S1', nome: 'Sala 1', valor: 300, ocupada: false } });
  const m = mes => post(fns, { codigo: 'DonoMK', acao: 'dados', mes }).alugueis.length;
  assert.deepEqual([m('2026-10'), m('2026-11'), m('2026-12')], [1, 1, 0]);
});

test('código do dono vem das propriedades do script, não do código-fonte', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'mk-gestao-app', 'Codigo.gs'), 'utf8');
  assert.ok(!/DonoMK/.test(src));
  const g = fake({ Agenda: [CAB_AGENDA], Profissionais: [['ID', 'Nome']] }, { hoje: '2026-11-25' });
  const fns = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g);
  const r = post(fns, { codigo: 'DonoMK', acao: 'login' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não configurado/);
  const g2 = fake({ Agenda: [CAB_AGENDA], Profissionais: [['ID', 'Nome']] }, { hoje: '2026-11-25', props: { CODIGO_DONO: 'Novo123' } });
  const f2 = carregar(['mk-gestao-app/calculos.gs', 'mk-gestao-app/Codigo.gs'], g2);
  assert.equal(post(f2, { codigo: 'Novo123', acao: 'login' }).ok, true);
  assert.equal(post(f2, { codigo: '', acao: 'login' }).ok, false);
});
