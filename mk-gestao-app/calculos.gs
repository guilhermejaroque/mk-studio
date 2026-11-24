/**
 * MK Studio — gestão: cálculos (funções puras, sem planilha).
 * Coloque este arquivo no mesmo projeto do Apps Script que o Codigo.gs da gestão.
 */

function arred(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/* ------------------------------ datas ------------------------------ */

function dataUTC_(iso) { return new Date(iso + 'T12:00:00Z'); }

function somaDiasISO(iso, n) {
  const d = dataUTC_(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function segundaDe(iso) {
  const dow = dataUTC_(iso).getUTCDay();          // 0 = domingo
  return somaDiasISO(iso, -((dow + 6) % 7));
}

function domingoDe(segundaISO) { return somaDiasISO(segundaISO, 6); }

function mesDe(iso) { return String(iso || '').slice(0, 7); }

function mesDaSemana(segundaISO) { return mesDe(domingoDe(segundaISO)); }

function somaMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2);
}

/* ---------------------------- dinheiro ----------------------------- */

function taxaDe(valor, pagamento, taxas) {
  const pct = taxas && Object.prototype.hasOwnProperty.call(taxas, pagamento) ? Number(taxas[pagamento]) || 0 : 0;
  return arred(valor * pct / 100);
}

function ehFeito_(r) {
  return norm(r.execucao) === 'feito' && typeof r.valor === 'number' && !isNaN(r.valor);
}

function entradasDoMes(mes, agenda, comissao, taxas) {
  return agenda
    .filter(r => ehFeito_(r) && mesDe(r.data) === mes)
    .map(r => {
      const pagamento = norm(r.pagamento);
      const taxa = taxaDe(r.valor, pagamento, taxas);
      const parteProf = arred(r.valor * comissao);
      return {
        data: r.data, profissional: r.profissional, servico: r.servico, cliente: r.cliente,
        valor: r.valor, pagamento: pagamento, taxa: taxa, parteProf: parteProf,
        liquido: arred(r.valor - parteProf - taxa)
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

function semanasEquipe(agenda, pagamentos, profissionais, comissao, inicio, hoje) {
  const ini = segundaDe(inicio);
  const fim = segundaDe(hoje);
  const semanas = [];
  for (let s = fim; s >= ini; s = somaDiasISO(s, -7)) {
    const dom = domingoDe(s);
    semanas.push({
      semana: s, domingo: dom, mes: mesDe(dom),
      profissionais: profissionais.map(nome => {
        const devido = arred(agenda
          .filter(r => ehFeito_(r) && norm(r.profissional) === norm(nome) && r.data >= s && r.data <= dom)
          .reduce((t, r) => t + arred(r.valor * comissao), 0));
        const p = pagamentos.find(x => x.semana === s && norm(x.profissional) === norm(nome));
        return {
          nome: nome, devido: devido, pago: !!p,
          valorPago: p ? arred(p.valor) : 0, pagoEm: p ? p.pagoEm : '',
          diferenca: p ? arred(devido - p.valor) : 0
        };
      })
    });
  }
  return semanas;
}

function resumoMes(mes, d) {
  const soma = (lista, f) => arred(lista.reduce((t, x) => t + (Number(f(x)) || 0), 0));
  const atendimentos = soma(d.entradas, e => e.valor);
  const alugueis = soma(d.alugueis.filter(a => a.mes === mes && a.recebido), a => a.valor);
  const pagos = d.lancamentos.filter(l => l.mes === mes && l.pago);
  const contas = soma(pagos.filter(l => l.categoria !== 'Material'), l => l.valor);
  const material = soma(pagos.filter(l => l.categoria === 'Material'), l => l.valor);
  const profissionais = soma(d.semanas.filter(s => s.mes === mes), s => soma(s.profissionais, p => p.devido));
  const taxas = soma(d.entradas, e => e.taxa);
  const entrouTotal = arred(atendimentos + alugueis);
  const saiuTotal = arred(contas + material + profissionais + taxas);
  return {
    entrou: { atendimentos: atendimentos, alugueis: alugueis, total: entrouTotal },
    saiu: { contas: contas, material: material, profissionais: profissionais, taxas: taxas, total: saiuTotal },
    sobrou: arred(entrouTotal - saiuTotal)
  };
}
