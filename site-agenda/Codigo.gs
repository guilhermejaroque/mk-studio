/**
 * MK Studio · Agenda
 * Script da planilha "Agenda MK Studio".
 * - GET  (doGet):  o site lê profissionais, serviços, dias/blocos e horários ocupados (sem dados de clientes).
 * - POST (doPost): o site grava um agendamento na aba Agenda, depois de conferir se o horário continua livre.
 *
 * Horários por profissional (aba Profissionais):
 *   coluna F "Blocos": se preenchida, substitui os blocos do dia para ela (ex.: 08:00, 09:00, 10:00 …);
 *   coluna G "Duração (min)": duração de cada atendimento dela (vazio = DURACAO_BLOCO).
 *   Os dias abertos continuam vindo da aba Horários.
 */

const TZ = 'America/Sao_Paulo';
const DIAS_A_FRENTE = 30;          // até quantos dias à frente o site pode agendar
const ANTECEDENCIA_MIN = 30;       // minutos mínimos antes do início do bloco
const MAX_POR_TELEFONE = 3;        // agendamentos futuros ativos por telefone
const DURACAO_BLOCO = 90;          // minutos (padrão, quando a profissional não tem duração própria)
const NOMES_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Colunas da aba Agenda (1 = A)
const C = { id: 1, data: 2, hora: 3, fim: 4, prof: 5, serv: 6, cliente: 7, tel: 8, obs: 9, origem: 10, status: 11, criado: 12 };

/* ---------- utilidades ---------- */

function aba_(nome) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sh) throw new Error('Aba não encontrada: ' + nome);
  return sh;
}
// texto=true lê o que aparece na tela (evita problemas de fuso com datas e horas guardadas como número)
function linhas_(nome, texto) {
  const sh = aba_(nome);
  const n = sh.getLastRow();
  if (n < 2) return [];
  const rg = sh.getRange(2, 1, n - 1, sh.getLastColumn());
  return texto ? rg.getDisplayValues() : rg.getValues();
}
function txt_(v) { return String(v == null ? '' : v).trim(); }
function sim_(v) { return /^s(im)?$/i.test(txt_(v)); }
function semAcento_(s) { return txt_(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function dataIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = txt_(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : '';
}
function hora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  const m = txt_(v).match(/^(\d{1,2})[:h](\d{2})?/);
  return m ? ('0' + m[1]).slice(-2) + ':' + (m[2] || '00') : '';
}
function min_(h) { const p = h.split(':'); return +p[0] * 60 + +p[1]; }
function hhmm_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function agora_() {
  const n = new Date();
  return { iso: Utilities.formatDate(n, TZ, 'yyyy-MM-dd'), min: +Utilities.formatDate(n, TZ, 'H') * 60 + +Utilities.formatDate(n, TZ, 'm') };
}
function diaSemana_(iso) { const p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getDay(); }
function acertaFuso_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- leitura da configuração ---------- */

function profissionais_() {
  return linhas_('Profissionais').filter(r => txt_(r[0]) && sim_(r[3]))
    .map(r => ({ nome: txt_(r[0]), id: txt_(r[1]) || semAcento_(r[0]), funcao: txt_(r[2]),
      extras: txt_(r[4]).split(/[,;\s]+/).map(hora_).filter(Boolean),          // coluna E: horários extras
      blocos: txt_(r[5]) ? txt_(r[5]).split(/[,;\s]+/).map(hora_).filter(Boolean) : null,   // coluna F: blocos próprios
      duracao: +txt_(r[6]).replace(',', '.') > 0 ? +txt_(r[6]).replace(',', '.') : DURACAO_BLOCO })); // coluna G
}
/** Lê a aba Serviços pelos nomes das colunas (a ordem das colunas pode mudar). */
function servicos_() {
  const sh = aba_('Serviços');
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const head = v[0].map(semAcento_);
  const col = nome => head.findIndex(h => h.indexOf(nome) === 0);
  const c = { nome: col('servico'), cat: col('categoria'), tipo: col('tipo'), preco: col('preco'), un: col('por unidade'), desc: col('descricao'), ativo: col('ativo') };
  const pega = (r, i) => i < 0 ? '' : r[i];
  return v.slice(1).filter(r => txt_(pega(r, c.nome)) && (c.ativo < 0 || sim_(pega(r, c.ativo)))).map(r => {
    const p = pega(r, c.preco);
    return {
      nome: txt_(pega(r, c.nome)),
      categoria: txt_(pega(r, c.cat)),
      tipo: semAcento_(pega(r, c.tipo)) === 'adicional' ? 'adicional' : 'principal',
      preco: p === '' || isNaN(+String(p).replace(',', '.')) ? null : +String(p).replace(',', '.'),
      porUnidade: sim_(pega(r, c.un)),
      descricao: txt_(pega(r, c.desc))
    };
  });
}
/** Blocos de uma profissional num dia: os do dia + os extras dela (só em dia aberto). */
function blocosDaProf_(prof, blocos, iso) {
  const dia = blocos[diaSemana_(iso)] || [];
  if (!dia.length) return [];
  const base = prof.blocos || dia;
  return base.concat(prof.extras.filter(h => base.indexOf(h) < 0));
}
/** Marca como ocupados os blocos da profissional nesse dia que se sobrepõem ao intervalo [ini, fim). */
function marcaIntervalo_(set, prof, blocos, d, ini, fim) {
  blocosDaProf_(prof, blocos, d).forEach(x => {
    const a = min_(x), b = a + prof.duracao;
    if (a < fim && ini < b) set[prof.id + '|' + d + '|' + x] = 1;
  });
}
function blocosPorDia_() {
  const out = {};
  linhas_('Horários', true).forEach(r => {
    const i = NOMES_DIAS.indexOf(semAcento_(r[0]).replace('terca', 'terça').replace('sabado', 'sábado'));
    if (i < 0) return;
    out[i] = sim_(r[1]) ? txt_(r[2]).split(/[,;\s]+/).map(hora_).filter(Boolean) : [];
  });
  return out;
}

/** Mapa "profId|yyyy-MM-dd|HH:mm" de todos os horários indisponíveis a partir de hoje. */
function ocupados_(profs, blocos) {
  const hoje = agora_().iso;
  const porNome = {}, porId = {};
  profs.forEach(p => { porNome[semAcento_(p.nome)] = p.id; porNome[semAcento_(p.id)] = p.id; porId[p.id] = p; });
  const set = {};

  linhas_('Agenda', true).forEach(r => {
    const d = dataIso_(r[C.data - 1]), h = hora_(r[C.hora - 1]);
    const id = porNome[semAcento_(r[C.prof - 1])];
    if (!d || !h || !id || d < hoje) return;
    if (semAcento_(r[C.status - 1]) === 'cancelado') return;
    set[id + '|' + d + '|' + h] = 1;
    // um atendimento ocupa todos os blocos que ele cobre (importa quando a grade da profissional muda)
    const fim = hora_(r[C.fim - 1]);
    const ini = min_(h), ate = fim && min_(fim) > ini ? min_(fim) : ini + porId[id].duracao;
    marcaIntervalo_(set, porId[id], blocos, d, ini, ate);
  });

  linhas_('Bloqueios', true).forEach(r => {
    const d = dataIso_(r[0]);
    if (!d || d < hoje) return;
    const quem = semAcento_(r[1]);
    const alvo = !quem || quem === 'todas' ? profs : profs.filter(p => p.id === porNome[quem]);
    const h = hora_(r[2]);
    alvo.forEach(p => h ? marcaIntervalo_(set, p, blocos, d, min_(h), min_(h) + 1) : blocosDaProf_(p, blocos, d).forEach(x => set[p.id + '|' + d + '|' + x] = 1));
  });
  return set;
}

/** Dias inteiros bloqueados (aba Bloqueios sem horário): "folga" de uma profissional ou "fechado" para todas. */
function folgas_(profs) {
  const hoje = agora_().iso, out = {};
  const porNome = {};
  profs.forEach(p => { porNome[semAcento_(p.nome)] = p.id; porNome[semAcento_(p.id)] = p.id; });
  linhas_('Bloqueios', true).forEach(r => {
    const d = dataIso_(r[0]);
    if (!d || d < hoje || hora_(r[2])) return;
    const quem = semAcento_(r[1]), todas = !quem || quem === 'todas';
    const ids = todas ? profs.map(p => p.id) : [porNome[quem]].filter(Boolean);
    ids.forEach(id => { const k = id + '|' + d; if (out[k] !== 'fechado') out[k] = todas ? 'fechado' : 'folga'; });
  });
  return Object.keys(out).map(k => { const p = k.split('|'); return { p: p[0], d: p[1], t: out[k] }; });
}

/* ---------- GET: o site lê a agenda ---------- */

function doGet() {
  try {
    const profs = profissionais_(), blocos = blocosPorDia_();
    const oc = ocupados_(profs, blocos);
    const agora = agora_();
    return json_({
      ok: true,
      hoje: agora.iso,
      agoraMin: agora.min,
      diasAFrente: DIAS_A_FRENTE,
      antecedenciaMin: ANTECEDENCIA_MIN,
      duracaoBloco: DURACAO_BLOCO,
      profissionais: profs.map(p => ({ id: p.id, nome: p.nome, funcao: p.funcao, extras: p.extras, blocos: p.blocos, duracao: p.duracao })),
      servicos: servicos_(),
      blocos: blocos,
      folgas: folgas_(profs),
      ocupados: Object.keys(oc).map(k => { const p = k.split('|'); return { p: p[0], d: p[1], h: p[2] }; })
    });
  } catch (err) {
    return json_({ ok: false, erro: 'Agenda indisponível no momento.' });
  }
}

/* ---------- POST: o site grava um agendamento ---------- */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, erro: 'Muitos agendamentos ao mesmo tempo. Tente de novo em instantes.' });
  }
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (txt_(b.site)) return json_({ ok: true });          // campo-isca contra robôs

    const profs = profissionais_(), blocos = blocosPorDia_();
    const prof = profs.find(p => p.id === txt_(b.profissional));
    const todos = servicos_();
    const serv = todos.find(s => s.tipo === 'principal' && s.nome === txt_(b.servico));
    const extras = (Array.isArray(b.adicionais) ? b.adicionais : []).slice(0, 10).map(txt_);
    const adic = extras.map(n => todos.find(s => s.tipo === 'adicional' && s.nome === n));
    const d = dataIso_(b.data), h = hora_(b.horario);
    const cliente = txt_(b.cliente).slice(0, 80);
    const tel = txt_(b.telefone).replace(/\D/g, '').slice(0, 11);
    const obs = txt_(b.obs).slice(0, 300);

    if (!prof) return json_({ ok: false, erro: 'Profissional inválida.' });
    if (!serv) return json_({ ok: false, erro: 'Serviço inválido.' });
    if (adic.some(x => !x)) return json_({ ok: false, erro: 'Decoração inválida.' });
    if (!d || blocosDaProf_(prof, blocos, d).indexOf(h) < 0) return json_({ ok: false, erro: 'Horário fora do funcionamento.' });
    if (cliente.length < 2) return json_({ ok: false, erro: 'Escreva seu nome.' });
    if (tel.length < 10) return json_({ ok: false, erro: 'Escreva um telefone com DDD.' });

    const agora = agora_();
    const limite = Utilities.formatDate(new Date(Date.now() + DIAS_A_FRENTE * 864e5), TZ, 'yyyy-MM-dd');
    if (d < agora.iso || d > limite || (d === agora.iso && min_(h) < agora.min + ANTECEDENCIA_MIN))
      return json_({ ok: false, erro: 'Esse horário não está mais disponível para agendamento.' });

    if (ocupados_(profs, blocos)[prof.id + '|' + d + '|' + h])
      return json_({ ok: false, ocupado: true, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });

    const ativos = linhas_('Agenda', true).filter(r =>
      txt_(r[C.tel - 1]).replace(/\D/g, '') === tel &&
      dataIso_(r[C.data - 1]) >= agora.iso &&
      semAcento_(r[C.status - 1]) !== 'cancelado').length;
    if (ativos >= MAX_POR_TELEFONE)
      return json_({ ok: false, erro: 'Esse telefone já tem ' + MAX_POR_TELEFONE + ' agendamentos marcados. Fale com o salão para marcar mais.' });

    acertaFuso_();
    const sh = aba_('Agenda');
    const id = 'MK' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    const p = d.split('-');
    sh.appendRow([
      id,
      Utilities.parseDate(d + ' 12:00', TZ, 'yyyy-MM-dd HH:mm'),   // meio-dia: a data não muda com fuso
      "'" + h,
      "'" + hhmm_(min_(h) + prof.duracao),
      prof.nome,
      [serv.nome].concat(adic.map(x => x.nome)).join(' + '),
      cliente,
      "'" + tel,
      obs,
      'site',
      'confirmado',
      new Date()
    ]);
    const r = sh.getLastRow();
    sh.getRange(r, C.data).setNumberFormat('dd/MM/yyyy');
    sh.getRange(r, C.criado).setNumberFormat('dd/MM/yyyy HH:mm');

    return json_({ ok: true, id: id });
  } catch (err) {
    return json_({ ok: false, erro: 'Não foi possível concluir o agendamento. Tente de novo.' });
  } finally {
    lock.releaseLock();
  }
}

/** Rode esta função uma vez pelo editor para autorizar o script e conferir a leitura. */
function testar() {
  acertaFuso_();
  Logger.log('Fuso da planilha: ' + SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone());
  Logger.log(doGet().getContent());
}