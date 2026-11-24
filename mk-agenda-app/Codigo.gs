/**
 * MK Studio — servidor do app das manicures.
 *
 * Projeto separado do Apps Script do site: lê e grava na MESMA planilha
 * "Agenda MK Studio", então app, site e planilha ficam sempre sincronizados.
 *
 * Implantar: Implantar > Nova implantação > Tipo "App da Web"
 *   Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 */

const PLANILHA_ID = '1YSqEBkoa3ZsngWrP1Lsa-6A0GeeL54-lN84XsEpRY58';
const FUSO = 'America/Sao_Paulo';
const COMISSAO = 0.5;          // parte da profissional (50%)
const DIAS_A_FRENTE = 30;      // até quantos dias à frente a agenda aparece

// Código de acesso -> id da profissional (coluna "ID" da aba Profissionais)
const CODIGOS = {
  'KatiaMK': 'katia',
  'SueniaMK': 'suenia'
};

// Valores gravados na planilha
const EXEC_FEITO = 'feito';
const EXEC_NAO_FEITO = 'não feito';
const STATUS_CANCELADO = 'cancelado';
const STATUS_CONFIRMADO = 'confirmado';
const MOTIVO_FOLGA = 'Folga (app)';
const FORMAS_PAGAMENTO = ['pix', 'credito', 'debito'];

/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'MK Studio — app das manicures' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const prof = profissionalPorCodigo_(req.codigo);
    if (!prof) return json_({ ok: false, erro: 'Código de acesso inválido.' });

    switch (req.acao) {
      case 'login': return json_({ ok: true, profissional: prof });
      case 'dados': return json_(dados_(prof));
      case 'marcar': return json_(comTrava_(() => marcar_(prof, req)));
      case 'folga': return json_(comTrava_(() => folga_(prof, req)));
      default: return json_({ ok: false, erro: 'Ação desconhecida.' });
    }
  } catch (err) {
    return json_({ ok: false, erro: 'Erro no servidor: ' + err.message });
  }
}

/* ----------------------------- ações ------------------------------ */

function dados_(prof) {
  const hoje = hojeISO_();
  const semana = inicioSemana_(hoje);              // segunda-feira desta semana
  const fimJanela = somaDias_(hoje, DIAS_A_FRENTE);
  const precos = tabelaPrecos_();
  const ag = abaAgenda_();

  const atendimentos = [];
  ag.linhas.forEach((r, i) => {
    if (!mesmaProf_(r[ag.col.Profissional], prof)) return;
    const data = normData_(r[ag.col.Data]);
    if (!data || data < semana || data > fimJanela) return;
    const exec = String(r[ag.col['Execução']] || '').trim().toLowerCase();
    const status = String(r[ag.col.Status] || '').trim().toLowerCase();
    // cancelado sem ser "não feito" = desmarcado pela cliente/salão: não mostra
    if (status === STATUS_CANCELADO && exec !== EXEC_NAO_FEITO) return;
    const servico = String(r[ag.col['Serviço']] || '');
    const valorPlanilha = numero_(r[ag.col.Valor]);
    const valorCheio = valorPlanilha != null ? valorPlanilha : calculaPreco_(servico, precos);
    atendimentos.push({
      linha: i + 2,
      id: String(r[ag.col.ID] || ''),
      data: data,
      horario: normHora_(r[ag.col['Horário']]),
      fim: normHora_(r[ag.col.Fim]),
      servico: servico,
      cliente: String(r[ag.col.Cliente] || ''),
      telefone: String(r[ag.col.Telefone] || ''),
      obs: String(r[ag.col['Observação']] || ''),
      execucao: exec === EXEC_FEITO ? 'feito' : exec === EXEC_NAO_FEITO ? 'nao_feito' : '',
      pagamento: String(r[ag.col.Pagamento] || ''),
      valorCheio: valorCheio,
      ganho: arred_(valorCheio * COMISSAO)
    });
  });
  atendimentos.sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));

  const fimSemana = somaDias_(semana, 6);
  let ganhosSemana = 0, ganhosHoje = 0, feitosSemana = 0;
  atendimentos.forEach(a => {
    if (a.execucao !== 'feito') return;
    if (a.data >= semana && a.data <= fimSemana) { ganhosSemana += a.ganho; feitosSemana++; }
    if (a.data === hoje) ganhosHoje += a.ganho;
  });

  return {
    ok: true,
    profissional: prof,
    hoje: hoje,
    inicioSemana: semana,
    comissao: COMISSAO,
    diasAbertos: diasAbertos_(),
    atendimentos: atendimentos,
    folgas: folgasDe_(prof, hoje),
    ganhosSemana: arred_(ganhosSemana),
    ganhosHoje: arred_(ganhosHoje),
    feitosSemana: feitosSemana
  };
}

function marcar_(prof, req) {
  const ag = abaAgenda_();
  const idx = localizaLinha_(ag, req);
  if (idx < 0) return { ok: false, erro: 'Atendimento não encontrado. Atualize a agenda.' };
  const r = ag.linhas[idx];
  if (!mesmaProf_(r[ag.col.Profissional], prof)) return { ok: false, erro: 'Este atendimento não é seu.' };

  const linha = idx + 2;
  const data = normData_(r[ag.col.Data]);
  const hora = normHora_(r[ag.col['Horário']]);
  const execAtual = String(r[ag.col['Execução']] || '').trim().toLowerCase();
  const sh = ag.sheet;
  const set = (nome, v) => sh.getRange(linha, ag.col[nome] + 1).setValue(v);

  if (req.execucao === 'feito') {
    if (data > hojeISO_()) return { ok: false, erro: 'Só dá para marcar como feito no dia do atendimento ou depois.' };
    if (execAtual === EXEC_NAO_FEITO && !horarioLivre_(ag, prof, data, hora, idx)) {
      return { ok: false, erro: 'Esse horário já foi agendado por outra cliente pelo site.' };
    }
    const pagamento = String(req.pagamento || '').trim().toLowerCase();
    if (FORMAS_PAGAMENTO.indexOf(pagamento) < 0) return { ok: false, erro: 'Escolha Pix, Crédito ou Débito.' };
    const valor = numero_(req.valorCheio);
    set('Execução', EXEC_FEITO);
    set('Pagamento', pagamento);
    if (valor != null) set('Valor', valor);
    if (execAtual === EXEC_NAO_FEITO) set('Status', STATUS_CONFIRMADO);
  } else if (req.execucao === 'nao_feito') {
    set('Execução', EXEC_NAO_FEITO);
    set('Valor', '');
    set('Pagamento', '');
    set('Status', STATUS_CANCELADO);           // libera o horário no site
  } else {                                     // desfazer
    if (execAtual === EXEC_NAO_FEITO && !horarioLivre_(ag, prof, data, hora, idx)) {
      return { ok: false, erro: 'Esse horário já foi agendado por outra cliente pelo site.' };
    }
    set('Execução', '');
    set('Valor', '');
    set('Pagamento', '');
    if (execAtual === EXEC_NAO_FEITO) set('Status', STATUS_CONFIRMADO);
  }
  SpreadsheetApp.flush();
  return dados_(prof);
}

function folga_(prof, req) {
  const data = normData_(req.data);
  if (!data) return { ok: false, erro: 'Data inválida.' };
  if (data < hojeISO_()) return { ok: false, erro: 'Não dá para mudar folgas de dias que já passaram.' };
  const sh = planilha_().getSheetByName('Bloqueios');
  const valores = sh.getDataRange().getValues();
  const cab = valores[0].map(c => String(c).trim());
  const cData = cab.indexOf('Data'), cProf = cab.indexOf('Profissional'),
        cHora = cab.indexOf('Horário'), cMot = cab.indexOf('Motivo');

  if (req.marcar) {
    const ja = valores.slice(1).some(r => normData_(r[cData]) === data && mesmaProf_(r[cProf], prof) && !String(r[cHora] || '').trim());
    if (!ja) {
      const nova = new Array(cab.length).fill('');
      nova[cData] = data; nova[cProf] = prof.nome; nova[cHora] = ''; nova[cMot] = MOTIVO_FOLGA;
      sh.appendRow(nova);
    }
  } else {
    for (let i = valores.length - 1; i >= 1; i--) {
      const r = valores[i];
      if (normData_(r[cData]) === data && mesmaProf_(r[cProf], prof) && !String(r[cHora] || '').trim()) {
        sh.deleteRow(i + 1);
      }
    }
  }
  SpreadsheetApp.flush();
  return dados_(prof);
}

/* ----------------------------- apoio ------------------------------ */

function planilha_() { return SpreadsheetApp.openById(PLANILHA_ID); }

function abaAgenda_() {
  const sh = planilha_().getSheetByName('Agenda');
  let cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(c => String(c).trim());
  ['Execução', 'Valor', 'Pagamento'].forEach(nome => {      // cria as colunas novas se faltarem
    if (cab.indexOf(nome) < 0) {
      sh.getRange(1, cab.length + 1).setValue(nome);
      cab.push(nome);
    }
  });
  const col = {};
  cab.forEach((c, i) => { col[c] = i; });
  const n = sh.getLastRow() - 1;
  const linhas = n > 0 ? sh.getRange(2, 1, n, cab.length).getValues() : [];
  return { sheet: sh, col: col, linhas: linhas };
}

function localizaLinha_(ag, req) {
  // confere pelo número da linha e pelo ID (caso alguém tenha mexido na planilha)
  const i = Number(req.linha) - 2;
  if (i >= 0 && i < ag.linhas.length && String(ag.linhas[i][ag.col.ID] || '') === String(req.id || '')) return i;
  if (req.id) return ag.linhas.findIndex(r => String(r[ag.col.ID] || '') === String(req.id));
  return -1;
}

function horarioLivre_(ag, prof, data, hora, ignorar) {
  return !ag.linhas.some((r, i) => i !== ignorar &&
    mesmaProf_(r[ag.col.Profissional], prof) &&
    normData_(r[ag.col.Data]) === data &&
    normHora_(r[ag.col['Horário']]) === hora &&
    String(r[ag.col.Status] || '').trim().toLowerCase() !== STATUS_CANCELADO);
}

function folgasDe_(prof, desde) {
  const sh = planilha_().getSheetByName('Bloqueios');
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(c => String(c).trim());
  const cData = cab.indexOf('Data'), cProf = cab.indexOf('Profissional'), cHora = cab.indexOf('Horário');
  const out = [];
  v.slice(1).forEach(r => {
    const d = normData_(r[cData]);
    if (!d || d < desde || String(r[cHora] || '').trim()) return;   // só dias inteiros
    const p = norm_(r[cProf]);
    const todas = p === 'todas' || p === 'todos';
    if (todas || mesmaProf_(r[cProf], prof)) out.push({ data: d, salaoFechado: todas });
  });
  return out;
}

function diasAbertos_() {
  // índices de dia da semana (0 = domingo) marcados como abertos na aba Horários
  const nomes = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const sh = planilha_().getSheetByName('Horários');
  const abertos = [];
  if (!sh) return [2, 3, 4, 5, 6];
  sh.getDataRange().getValues().forEach(r => {
    const i = nomes.indexOf(norm_(r[0]));
    if (i >= 0 && norm_(r[1]) === 'sim') abertos.push(i);
  });
  return abertos.length ? abertos : [2, 3, 4, 5, 6];
}

function tabelaPrecos_() {
  const v = planilha_().getSheetByName('Serviços').getDataRange().getValues();
  const cab = v[0].map(c => String(c).trim());
  const cNome = cab.indexOf('Serviço'), cPreco = cab.findIndex(c => c.indexOf('Preço') === 0),
        cUni = cab.indexOf('Por unidade');
  return v.slice(1)
    .filter(r => String(r[cNome]).trim())
    .map(r => ({ nome: norm_(r[cNome]), preco: numero_(r[cPreco]) || 0, porUnidade: norm_(r[cUni]) === 'sim' }))
    .sort((a, b) => b.nome.length - a.nome.length);   // nomes maiores primeiro
}

function calculaPreco_(texto, precos) {
  // Procura os nomes dos serviços dentro do texto (ex.: "Manicure tradicional + Francesinha").
  // Para itens por unidade, aceita quantidade como "3x Unhas encapsuladas" ou "Unhas encapsuladas (3)".
  let resto = ' ' + norm_(texto) + ' ';
  let total = 0;
  precos.forEach(p => {
    let pos;
    while (p.nome && (pos = resto.indexOf(p.nome)) >= 0) {
      let qtd = 1;
      if (p.porUnidade) {
        const antes = resto.slice(Math.max(0, pos - 6), pos).match(/(\d+)\s*x?\s*$/);
        const depois = resto.slice(pos + p.nome.length, pos + p.nome.length + 8).match(/^\s*\(?\s*x?\s*(\d+)/);
        qtd = Number((depois && depois[1]) || (antes && antes[1]) || 1);
      }
      total += p.preco * qtd;
      resto = resto.slice(0, pos) + ' | ' + resto.slice(pos + p.nome.length);
    }
  });
  return arred_(total);
}

function profissionalPorCodigo_(codigo) {
  const id = CODIGOS[String(codigo || '').trim()];
  if (!id) return null;
  const v = planilha_().getSheetByName('Profissionais').getDataRange().getValues();
  const cab = v[0].map(c => String(c).trim());
  const r = v.slice(1).find(l => norm_(l[cab.indexOf('ID')]) === id);
  return { id: id, nome: r ? String(r[cab.indexOf('Nome')]) : id };
}

function mesmaProf_(valor, prof) {
  const v = norm_(valor);
  return v === norm_(prof.id) || v === norm_(prof.nome);
}

function comTrava_(fn) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try { return fn(); } finally { trava.releaseLock(); }
}

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function normData_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function normHora_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, FUSO, 'HH:mm');
  const m = String(v || '').trim().match(/^(\d{1,2})[:h](\d{2})?/);
  return m ? ('0' + m[1]).slice(-2) + ':' + (m[2] || '00') : '';
}

function numero_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function arred_(n) { return Math.round(n * 100) / 100; }

function hojeISO_() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd'); }

function somaDias_(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function inicioSemana_(iso) {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();   // 0 = domingo
  return somaDias_(iso, -((dow + 6) % 7));                 // volta até segunda
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
