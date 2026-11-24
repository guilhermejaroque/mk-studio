// Planilha falsa em memória com o pedaço da API do Apps Script que os servidores usam.

function aba(nome, linhas) {
  const s = {
    nome, linhas: linhas.map(l => l.slice()),
    getName: () => nome,
    getLastRow: () => s.linhas.length,
    getLastColumn: () => s.linhas.reduce((m, l) => Math.max(m, l.length), 0),
    getDataRange: () => intervalo(s, 1, 1, Math.max(1, s.linhas.length), Math.max(1, s.getLastColumn())),
    getRange: (r, c, nr = 1, nc = 1) => intervalo(s, r, c, nr, nc),
    appendRow: l => { s.linhas.push(l.slice()); },
    deleteRow: r => { s.linhas.splice(r - 1, 1); },
    setFrozenRows: () => {}
  };
  return s;
}

function intervalo(s, r, c, nr, nc) {
  const larg = s.getLastColumn();
  const cel = (i, j) => {
    const l = s.linhas[i] || [];
    const v = l[j];
    return v === undefined ? '' : v;
  };
  return {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cel(r - 1 + i, c - 1 + j))),
    getValue: () => cel(r - 1, c - 1),
    setValue: v => {
      while (s.linhas.length < r) s.linhas.push([]);
      const l = s.linhas[r - 1];
      while (l.length < c - 1) l.push('');
      l[c - 1] = v;
    },
    setValues: vs => vs.forEach((linha, i) => linha.forEach((v, j) => intervalo(s, r + i, c + j, 1, 1).setValue(v))),
    setFontWeight: function () { return this; },
    _larg: larg
  };
}

function fake(abas, opcoes = {}) {
  const planilha = { abas: {} };
  Object.entries(abas).forEach(([n, l]) => { planilha.abas[n] = aba(n, l); });
  let uid = 0;
  const hoje = opcoes.hoje || '2026-11-25';
  const g = {
    _planilha: planilha,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: n => planilha.abas[n] || null,
        insertSheet: n => (planilha.abas[n] = aba(n, []))
      }),
      flush: () => {}
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ conteudo: s, setMimeType() { return this; } })
    },
    Utilities: {
      getUuid: () => 'id' + (++uid),
      formatDate: (d, fuso, fmt) => {
        if (d && d.__hoje) return fmt === 'yyyy-MM-dd' ? hoje : '12:00';
        const iso = d.toISOString();
        return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso.slice(11, 16);
      }
    }
  };
  // new Date() sem argumentos devolve "hoje" fixo, para os testes serem estáveis
  const DataReal = Date;
  function DataFalsa(...a) {
    if (!a.length) { const d = new DataReal(hoje + 'T15:00:00Z'); d.__hoje = true; return d; }
    return new DataReal(...a);
  }
  DataFalsa.prototype = DataReal.prototype;
  DataFalsa.now = () => new DataReal(hoje + 'T15:00:00Z').getTime();
  DataFalsa.UTC = DataReal.UTC;
  g.Date = DataFalsa;
  return g;
}

function post(fns, corpo) {
  const r = fns.doPost({ postData: { contents: JSON.stringify(corpo) } });
  return JSON.parse(r.conteudo);
}

module.exports = { fake, post };
