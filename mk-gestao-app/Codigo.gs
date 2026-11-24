/**
 * MK Studio — servidor do app de GESTÃO (o app do dono).
 *
 * Projeto separado do Apps Script: lê a aba Agenda (só leitura) e grava nas
 * abas da gestão (Contas, Lançamentos, Salas, Aluguéis, Pagamentos, Estoque,
 * Config) da MESMA planilha "Agenda MK Studio". As abas são criadas sozinhas
 * no primeiro acesso.
 *
 * Arquivos do projeto: Codigo.gs (este) + calculos.gs
 * Implantar: Implantar > Nova implantação > Tipo "App da Web"
 *   Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 */

const PLANILHA_ID = '1YSqEBkoa3ZsngWrP1Lsa-6A0GeeL54-lN84XsEpRY58';
const FUSO = 'America/Sao_Paulo';
const CODIGO_DONO = 'DonoMK';                 // código de acesso do app de gestão
const IDS_EQUIPE = ['katia', 'suenia'];       // profissionais que recebem o acerto semanal (coluna ID de Profissionais)
const SEMANAS_NA_TELA = 8;
const MESES_NO_GRAFICO = 6;

const ABAS = {
  'Contas': ['ID', 'Nome', 'Categoria', 'Fixa', 'Ativa'],
  'Lançamentos': ['ID', 'Mês', 'Data', 'ContaID', 'Descrição', 'Categoria', 'Valor', 'Pago'],
  'Salas': ['ID', 'Nome', 'Valor mensal', 'Ocupada', 'Desde'],
  'Aluguéis': ['Mês', 'SalaID', 'Valor', 'Recebido', 'Data'],
  'Pagamentos': ['Semana', 'Profissional', 'Valor', 'Pago em'],
  'Estoque': ['ID', 'Item', 'Unidade', 'Quantidade', 'Mínimo'],
  'Config': ['Chave', 'Valor']
};

/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'MK Studio — gestão' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(req.codigo || '').trim() !== CODIGO_DONO) return json_({ ok: false, erro: 'Código de acesso inválido.' });
    const mes = /^\d{4}-\d{2}$/.test(String(req.mes || '')) ? req.mes : mesDe(hojeISO_());

    if (req.acao === 'login') return json_({ ok: true, nome: 'Dono' });
    if (req.acao === 'dados') return json_(comTrava_(() => dados_(mes)));
    if (req.acao === 'historicoConta') return json_(historicoConta_(req.id));

    const acoes = {
      salvarConta: salvarConta_, lancar: lancar_, apagarLancamento: apagarLancamento_,
      aluguel: aluguel_, salvarSala: salvarSala_, pagarSemana: pagarSemana_,
      salvarItem: salvarItem_, ajusteEstoque: ajusteEstoque_, apagarItem: apagarItem_, config: config_
    };
    const fn = acoes[req.acao];
    if (!fn) return json_({ ok: false, erro: 'Ação desconhecida.' });
    return json_(comTrava_(() => {
      const r = fn(req, mes);
      if (r && r.ok === false) return r;
      SpreadsheetApp.flush();
      return dados_(mes);
    }));
  } catch (err) {
    return json_({ ok: false, erro: 'Erro no servidor: ' + err.message });
  }
}

/* ----------------------------- leitura ----------------------------- */

function dados_(mes) {
  const hoje = hojeISO_();
  const cfg = lerConfig_();
  const agenda = lerAgenda_().filter(r => r.data >= cfg.inicio);   // nada antes do início do app
  const profs = equipe_();
  const lanc = lancamentos_();
  const alug = alugueisTodos_();
  const pags = tabela_('Pagamentos').linhas.map(r => ({
    semana: normData_(r['Semana']), profissional: String(r['Profissional']),
    valor: numero_(r['Valor']) || 0, pagoEm: normData_(r['Pago em'])
  }));
  const semanas = semanasEquipe(agenda, pags, profs, cfg.comissao, cfg.inicio, hoje);
  const base = { alugueis: alug, lancamentos: lanc, semanas: semanas };
  const resumoDe = m => resumoMes(m, Object.assign({ entradas: entradasDoMes(m, agenda, cfg.comissao, cfg.taxas) }, base));

  const historico = [];
  for (let i = MESES_NO_GRAFICO - 1; i >= 0; i--) {
    const m = somaMeses(mes, -i);
    if (m < mesDe(cfg.inicio)) continue;
    const r = resumoDe(m);
    historico.push({ mes: m, entrou: r.entrou.total, saiu: r.saiu.total, sobrou: r.sobrou });
  }

  const cadastroContas = tabela_('Contas').linhas.map(r => ({
    id: String(r['ID']), nome: String(r['Nome']), categoria: String(r['Categoria'] || 'Fixas'),
    fixa: simNao_(r['Fixa']), ativa: simNao_(r['Ativa'])
  })).sort((a, b) => a.nome.localeCompare(b.nome));
  const contas = cadastroContas.map(c => {
    const l = lanc.find(x => x.contaId === c.id && x.mes === mes);
    return Object.assign({}, c, { lanc: l ? { id: l.id, valor: l.valor, pago: l.pago } : null });
  }).filter(c => (c.fixa && c.ativa) || c.lanc);

  const salas = salas_();
  const mesAtual = mesDe(hoje);
  const alugueis = salas.map(s => {
    const a = alug.find(x => x.mes === mes && x.salaId === s.id);
    if (!a && !(s.ocupada && mes >= (s.desde || mesAtual))) return null;
    return { salaId: s.id, nome: s.nome, valor: a ? a.valor : s.valor, recebido: a ? a.recebido : false };
  }).filter(Boolean);

  const estoque = tabela_('Estoque').linhas.map(r => ({
    id: String(r['ID']), item: String(r['Item']), unidade: String(r['Unidade'] || ''),
    quantidade: numero_(r['Quantidade']) || 0, minimo: numero_(r['Mínimo']) || 0
  })).sort((a, b) => ((b.quantidade <= b.minimo) - (a.quantidade <= a.minimo)) || a.item.localeCompare(b.item));

  return {
    ok: true, hoje: hoje, mes: mes,
    config: cfg,
    resumo: resumoDe(mes),
    historico: historico,
    contas: contas,
    cadastroContas: cadastroContas,
    avulsos: lanc.filter(l => !l.contaId && l.mes === mes)
      .map(l => ({ id: l.id, data: l.data, descricao: l.descricao, categoria: l.categoria, valor: l.valor, pago: l.pago }))
      .sort((a, b) => a.data.localeCompare(b.data)),
    entradas: entradasDoMes(mes, agenda, cfg.comissao, cfg.taxas),
    alugueis: alugueis,
    salas: salas,
    semanas: semanas.slice(0, SEMANAS_NA_TELA),
    estoque: estoque
  };
}

function historicoConta_(id) {
  const h = lancamentos_().filter(l => l.contaId === String(id))
    .map(l => ({ mes: l.mes, valor: l.valor, pago: l.pago }))
    .sort((a, b) => b.mes.localeCompare(a.mes));
  return { ok: true, historico: h };
}

function lerAgenda_() {
  const sh = planilha_().getSheetByName('Agenda');
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(c => String(c).trim());
  const c = n => cab.indexOf(n);
  const pega = (r, n) => (c(n) >= 0 ? r[c(n)] : '');
  return v.slice(1).map(r => ({
    data: normData_(pega(r, 'Data')),
    profissional: String(pega(r, 'Profissional') || ''),
    servico: String(pega(r, 'Serviço') || ''),
    cliente: String(pega(r, 'Cliente') || ''),
    status: String(pega(r, 'Status') || ''),
    execucao: String(pega(r, 'Execução') || ''),
    valor: numero_(pega(r, 'Valor')) == null ? '' : numero_(pega(r, 'Valor')),
    pagamento: String(pega(r, 'Pagamento') || '')
  })).filter(r => r.data && norm(r.status) !== 'cancelado');
}

function equipe_() {
  const v = planilha_().getSheetByName('Profissionais').getDataRange().getValues();
  const cab = v[0].map(c => String(c).trim());
  const cId = cab.indexOf('ID'), cNome = cab.indexOf('Nome');
  return IDS_EQUIPE.map(id => {
    const r = v.slice(1).find(l => norm(l[cId]) === id);
    return r ? String(r[cNome]) : id;
  });
}

function lerConfig_() {
  const kv = {};
  tabela_('Config').linhas.forEach(r => { kv[String(r['Chave']).trim()] = r['Valor']; });
  return {
    taxas: { pix: numero_(kv.taxa_pix) || 0, credito: numero_(kv.taxa_credito) || 0, debito: numero_(kv.taxa_debito) || 0 },
    comissao: numero_(kv.comissao) == null ? 0.5 : numero_(kv.comissao),
    inicio: segundaDe(normData_(kv.inicio) || hojeISO_())
  };
}

function lancamentos_() {
  return tabela_('Lançamentos').linhas.map(r => ({
    id: String(r['ID']), mes: normMes_(r['Mês']), data: normData_(r['Data']),
    contaId: String(r['ContaID'] || ''), descricao: String(r['Descrição'] || ''),
    categoria: String(r['Categoria'] || ''), valor: numero_(r['Valor']) || 0, pago: simNao_(r['Pago'])
  }));
}

function alugueisTodos_() {
  return tabela_('Aluguéis').linhas.map(r => ({
    mes: normMes_(r['Mês']), salaId: String(r['SalaID']), valor: numero_(r['Valor']) || 0,
    recebido: simNao_(r['Recebido']), data: normData_(r['Data'])
  }));
}

function salas_() {
  return tabela_('Salas').linhas.map(r => ({
    id: String(r['ID']), nome: String(r['Nome']), valor: numero_(r['Valor mensal']) || 0, ocupada: simNao_(r['Ocupada']),
    desde: normMes_(r['Desde'])
  }));
}

/* ----------------------------- gravação ---------------------------- */

function salvarConta_(req) {
  const c = req.conta || {};
  if (!String(c.nome || '').trim()) return { ok: false, erro: 'Digite o nome da conta.' };
  upsert_('Contas', r => c.id && String(r['ID']) === String(c.id), {
    'ID': c.id || Utilities.getUuid(), 'Nome': String(c.nome).trim(), 'Categoria': c.categoria || 'Fixas',
    'Fixa': sn_(c.fixa !== false), 'Ativa': sn_(c.ativa !== false)
  });
}

function lancar_(req, mes) {
  const l = req.lancamento || {};
  const valor = numero_(l.valor);
  if (valor == null) return { ok: false, erro: 'Digite o valor.' };
  let categoria = l.categoria || 'Outros';
  if (l.contaId) {
    const conta = tabela_('Contas').linhas.find(r => String(r['ID']) === String(l.contaId));
    if (!conta) return { ok: false, erro: 'Conta não encontrada.' };
    categoria = String(conta['Categoria'] || 'Fixas');
  } else if (!String(l.descricao || '').trim()) {
    return { ok: false, erro: 'Digite a descrição do gasto.' };
  }
  const acha = l.contaId
    ? r => String(r['ContaID']) === String(l.contaId) && normMes_(r['Mês']) === mes
    : r => l.id && String(r['ID']) === String(l.id);
  const atual = tabela_('Lançamentos').linhas.find(acha);
  upsert_('Lançamentos', acha, {
    'ID': atual ? atual['ID'] : Utilities.getUuid(), 'Mês': texto_(mes),
    'Data': texto_(l.data || (atual && normData_(atual['Data'])) || hojeISO_()),
    'ContaID': l.contaId || '', 'Descrição': l.descricao || '', 'Categoria': categoria,
    'Valor': valor, 'Pago': sn_(!!l.pago)
  });
}

function apagarLancamento_(req) { apaga_('Lançamentos', r => String(r['ID']) === String(req.id)); }

function aluguel_(req, mes) {
  const sala = salas_().find(s => s.id === String(req.salaId));
  if (!sala) return { ok: false, erro: 'Sala não encontrada.' };
  const acha = r => normMes_(r['Mês']) === mes && String(r['SalaID']) === sala.id;
  const atual = tabela_('Aluguéis').linhas.find(acha);
  upsert_('Aluguéis', acha, {
    'Mês': texto_(mes), 'SalaID': sala.id, 'Valor': atual ? numero_(atual['Valor']) : sala.valor,
    'Recebido': sn_(!!req.recebido), 'Data': req.recebido ? texto_(hojeISO_()) : ''
  });
}

function salvarSala_(req) {
  const s = req.sala || {};
  const atual = tabela_('Salas').linhas.find(r => String(r['ID']) === String(s.id));
  if (!atual) return { ok: false, erro: 'Sala não encontrada.' };
  const valor = numero_(s.valor);
  const ocupada = !!s.ocupada;
  if (!ocupada && simNao_(atual['Ocupada'])) guardaMesesOcupados_(String(s.id), normMes_(atual['Desde']), numero_(atual['Valor mensal']) || 0);
  upsert_('Salas', r => String(r['ID']) === String(s.id), {
    'ID': s.id, 'Nome': String(s.nome || atual['Nome']), 'Valor mensal': valor == null ? numero_(atual['Valor mensal']) : valor,
    'Ocupada': sn_(ocupada),
    'Desde': ocupada && !simNao_(atual['Ocupada']) ? texto_(mesDe(hojeISO_())) : (atual['Desde'] || '')
  });
}

// Ao liberar uma sala, grava (como não recebido) os meses ocupados até o atual que ainda
// não têm linha em Aluguéis, para eles continuarem aparecendo no histórico.
function guardaMesesOcupados_(salaId, desde, valor) {
  const atual = mesDe(hojeISO_());
  const tem = alugueisTodos_().filter(a => a.salaId === salaId).map(a => a.mes);
  const sh = planilha_().getSheetByName('Aluguéis');
  for (let m = desde || atual; m <= atual; m = somaMeses(m, 1)) {
    if (tem.indexOf(m) < 0) sh.appendRow([texto_(m), salaId, valor, sn_(false), '']);
  }
}

function pagarSemana_(req) {
  const semana = segundaDe(normData_(req.semana));
  const acha = r => normData_(r['Semana']) === semana && norm(r['Profissional']) === norm(req.profissional);
  if (!req.pago) { apaga_('Pagamentos', acha); return; }
  const valor = numero_(req.valor);
  if (valor == null) return { ok: false, erro: 'Valor do pagamento inválido.' };
  upsert_('Pagamentos', acha, { 'Semana': texto_(semana), 'Profissional': String(req.profissional), 'Valor': valor, 'Pago em': texto_(hojeISO_()) });
}

function salvarItem_(req) {
  const i = req.item || {};
  if (!String(i.item || '').trim()) return { ok: false, erro: 'Digite o nome do item.' };
  upsert_('Estoque', r => i.id && String(r['ID']) === String(i.id), {
    'ID': i.id || Utilities.getUuid(), 'Item': String(i.item).trim(), 'Unidade': i.unidade || '',
    'Quantidade': Math.max(0, numero_(i.quantidade) || 0), 'Mínimo': Math.max(0, numero_(i.minimo) || 0)
  });
}

function ajusteEstoque_(req) {
  const t = tabela_('Estoque');
  const r = t.linhas.find(x => String(x['ID']) === String(req.id));
  if (!r) return { ok: false, erro: 'Item não encontrado.' };
  const q = Math.max(0, (numero_(r['Quantidade']) || 0) + (Number(req.delta) || 0));
  t.sheet.getRange(r._linha, t.cab.indexOf('Quantidade') + 1).setValue(q);
}

function apagarItem_(req) { apaga_('Estoque', r => String(r['ID']) === String(req.id)); }

function config_(req) {
  const tx = req.taxas || {};
  ['pix', 'credito', 'debito'].forEach(k => {
    const v = numero_(tx[k]);
    if (v != null) upsert_('Config', r => String(r['Chave']) === 'taxa_' + k, { 'Chave': 'taxa_' + k, 'Valor': Math.max(0, v) });
  });
}

/* ------------------------------ tabelas ---------------------------- */

function planilha_() { return SpreadsheetApp.openById(PLANILHA_ID); }

function garanteAbas_() {
  const pl = planilha_();
  Object.keys(ABAS).forEach(nome => {
    if (pl.getSheetByName(nome)) return;
    const sh = pl.insertSheet(nome);
    sh.appendRow(ABAS[nome]);
    if (nome === 'Salas') {
      sh.appendRow(['S1', 'Sala 1', 300, 'sim', texto_(mesDe(hojeISO_()))]);
      sh.appendRow(['S2', 'Sala 2', 300, 'não', '']);
    }
    if (nome === 'Config') {
      [['taxa_pix', 0], ['taxa_credito', 0], ['taxa_debito', 0], ['comissao', 0.5],
        ['inicio', texto_(segundaDe(hojeISO_()))]].forEach(l => sh.appendRow(l));
    }
  });
}

function tabela_(nome) {
  garanteAbas_();
  const sh = planilha_().getSheetByName(nome);
  const v = sh.getDataRange().getValues();
  const cab = (v[0] || []).map(c => String(c).trim());
  const linhas = v.slice(1).map((l, i) => {
    const o = { _linha: i + 2 };
    cab.forEach((c, j) => { o[c] = l[j]; });
    return o;
  }).filter(o => cab.some(c => String(o[c] == null ? '' : o[c]).trim() !== ''));
  return { sheet: sh, cab: cab, linhas: linhas };
}

function upsert_(nome, acha, obj) {
  const t = tabela_(nome);
  const r = t.linhas.find(acha);
  const linha = t.cab.map(c => (Object.prototype.hasOwnProperty.call(obj, c) ? obj[c] : (r ? r[c] : '')));
  if (r) t.sheet.getRange(r._linha, 1, 1, linha.length).setValues([linha]);
  else t.sheet.appendRow(linha);
}

function apaga_(nome, acha) {
  const t = tabela_(nome);
  t.linhas.filter(acha).map(r => r._linha).sort((a, b) => b - a).forEach(l => t.sheet.deleteRow(l));
}

/* ------------------------------- apoio ----------------------------- */

function comTrava_(fn) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try { return fn(); } finally { trava.releaseLock(); }
}

function sn_(b) { return b ? 'sim' : 'não'; }
function simNao_(v) { return v === true || norm(v) === 'sim'; }
// Apóstrofo na frente para o Google Planilhas guardar como texto (e não virar data)
function texto_(s) { return s ? "'" + s : ''; }

function normData_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  const s = String(v || '').trim().replace(/^'/, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function normMes_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd').slice(0, 7);
  const m = String(v || '').trim().replace(/^'/, '').match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : '';
}

function numero_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  if (!/\d/.test(String(v))) return null;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return String(v).trim() === '' || isNaN(n) ? null : n;
}

function hojeISO_() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd'); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
