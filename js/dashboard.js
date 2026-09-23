// dashboard.js — volume de XMLs e soma por fornecedor, por competência.
import { estado, $, esc, moeda, formatarCnpj, competenciaDe, rotuloCompetencia, valorNota } from "./estado.js";

export function iniciarDashboard() {
  $("dash-competencia").addEventListener("change", renderDashboard);
  $("dash-comps").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-comp]");
    if (!tr) return;
    $("dash-competencia").value = tr.dataset.comp;
    renderDashboard();
  });
}

export function renderDashboard() {
  const notas = estado.notas;
  const comps = [...new Set(notas.map(competenciaDe))].sort().reverse();

  const sel = $("dash-competencia");
  const atual = comps.includes(sel.value) ? sel.value : "";
  sel.innerHTML = '<option value="">Todas as competências</option>' +
    comps.map((c) => `<option value="${c}">${rotuloCompetencia(c)}</option>`).join("");
  sel.value = atual;

  const periodo = atual ? notas.filter((n) => competenciaDe(n) === atual) : notas;
  const total = periodo.reduce((s, n) => s + valorNota(n), 0);

  // por fornecedor
  const mapa = new Map();
  for (const n of periodo) {
    const chave = n.emitenteCnpj || n.emitenteNome;
    const f = mapa.get(chave) || { nome: n.emitenteNome, cnpj: n.emitenteCnpj, qtd: 0, valor: 0 };
    f.qtd += 1;
    f.valor += valorNota(n);
    mapa.set(chave, f);
  }
  const fornecedores = [...mapa.values()].sort((a, b) => b.valor - a.valor);

  $("dash-kpis").innerHTML = [
    ["XMLs", periodo.length],
    ["Valor total", moeda(total)],
    ["Fornecedores", fornecedores.length],
    ["Pendentes de revisão", periodo.filter((n) => n.status !== "revisada").length],
  ].map(([rotulo, valor]) => `<div class="kpi"><span>${rotulo}</span><b>${valor}</b></div>`).join("");

  // por competência (sempre todas; clicar numa linha filtra o restante)
  const porComp = comps.map((c) => {
    const l = notas.filter((n) => competenciaDe(n) === c);
    return { c, qtd: l.length, valor: l.reduce((s, n) => s + valorNota(n), 0) };
  });
  const maior = Math.max(1, ...porComp.map((x) => x.valor));
  $("dash-comps").innerHTML = porComp.length
    ? `<table><thead><tr><th>Competência</th><th>XMLs</th><th>Valor total</th><th class="larga"></th></tr></thead><tbody>${
        porComp.map((x) => `<tr data-comp="${x.c}" class="clicavel ${x.c === atual ? "sel" : ""}">
          <td><b>${rotuloCompetencia(x.c)}</b></td><td>${x.qtd}</td><td>${moeda(x.valor)}</td>
          <td><div class="barra-h"><span style="width:${(x.valor / maior) * 100}%"></span></div></td></tr>`).join("")
      }</tbody></table>`
    : '<p class="vazio">Ainda não há notas importadas.</p>';

  $("dash-titulo-forn").textContent = `Soma por fornecedor — ${atual ? rotuloCompetencia(atual) : "todas as competências"}`;
  $("dash-forn").innerHTML = fornecedores.length
    ? `<table><thead><tr><th>Fornecedor</th><th>CNPJ</th><th>XMLs</th><th>Valor total</th><th>% do total</th></tr></thead><tbody>${
        fornecedores.map((f) => `<tr><td>${esc(f.nome)}</td><td>${esc(formatarCnpj(f.cnpj))}</td><td>${f.qtd}</td>
          <td>${moeda(f.valor)}</td><td>${total ? ((f.valor / total) * 100).toFixed(1) : "0.0"}%</td></tr>`).join("")
      }</tbody></table>`
    : '<p class="vazio">Sem notas nesta competência.</p>';
}
