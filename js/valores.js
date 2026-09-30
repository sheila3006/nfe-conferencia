// valores.js
// Conferência de valores da NF-e, base de PIS/COFINS e colunas do livro de ICMS.
//
// Bases:
// - Total da NF: regra de validação W16-10 do MOC/NT 2020.002 (Portal Nacional da NF-e):
//   vNF = vProd - vDesc - vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol
// - Base de PIS/COFINS: IPI, ICMS e descontos NÃO integram; frete e despesas acessórias INTEGRAM.
//   ICMS fora da base: STF Tema 69 (RE 574.706) e, para créditos, Lei 14.592/2023 (desde 01/05/2023).
//   IPI fora da base de crédito: IN RFB 2.121/2022, art. 170, II (STJ Tese 1.373).
// Não substitui a validação do contador.

export const TOLERANCIA = 0.02; // R$ — diferença de arredondamento aceita

const n = (x) => Number(x) || 0;
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// ---------- Total da NF ----------
export function conferirTotalNota(nota) {
  const t = nota.totais;
  if (!t) return { ok: null, aviso: "Nota importada antes desta versão — reimporte o XML para conferir os valores." };

  const soma = n(t.vProd) + n(t.vST) + n(t.vFCPST) + n(t.vIPI) + n(t.vIPIDevol) + n(t.vII)
    + n(t.vFrete) + n(t.vSeg) + n(t.vOutro) - n(t.vDesc);
  const semDeson = r2(soma);
  const comDeson = r2(soma - n(t.vICMSDeson)); // a SEFAZ aceita as duas formas (NT 2013/005)
  const informado = r2(n(nota.valorTotal));
  const calculado = Math.abs(informado - comDeson) <= Math.abs(informado - semDeson) ? comDeson : semDeson;
  const diferenca = r2(informado - calculado);

  // Totais do cabeçalho x soma dos itens (só quando o item já tem os campos novos)
  const divergencias = [];
  if (nota.itens.length && nota.itens.every((i) => i.vIPI !== undefined)) {
    const campos = [
      ["Produtos", "valorProduto", "vProd"], ["IPI", "vIPI", "vIPI"], ["ICMS-ST", "vICMSST", "vST"],
      ["Frete", "vFrete", "vFrete"], ["Seguro", "vSeg", "vSeg"], ["Outras despesas", "vOutro", "vOutro"],
      ["Descontos", "vDesc", "vDesc"],
    ];
    for (const [rotulo, campoItem, campoTotal] of campos) {
      const somaItens = r2(nota.itens.reduce((s, i) => s + n(i[campoItem]), 0));
      if (Math.abs(somaItens - n(t[campoTotal])) > TOLERANCIA) {
        divergencias.push(`${rotulo}: soma dos itens ${somaItens.toFixed(2)} ≠ total da NF ${n(t[campoTotal]).toFixed(2)}`);
      }
    }
  }

  return {
    ok: Math.abs(diferenca) <= TOLERANCIA && !divergencias.length,
    informado, calculado, diferenca, divergencias,
    componentes: {
      produtos: n(t.vProd), icmsSt: n(t.vST) + n(t.vFCPST), ipi: n(t.vIPI) + n(t.vIPIDevol), ii: n(t.vII),
      frete: n(t.vFrete), seguro: n(t.vSeg), outras: n(t.vOutro), descontos: n(t.vDesc), desonerado: n(t.vICMSDeson),
    },
  };
}

// ---------- Por item ----------
// Valor da operação sem IPI/ICMS-ST: produtos + frete + seguro + outras - descontos
const baseCheia = (i) => n(i.valorProduto) + n(i.vFrete) + n(i.vSeg) + n(i.vOutro) - n(i.vDesc);

// Valor contábil do item (mesma composição do total da NF)
export const valorContabilItem = (i) =>
  r2(baseCheia(i) + n(i.vIPI) + n(i.vII) + n(i.vICMSST) + n(i.vFCPST));

// Base de PIS/COFINS do item: não integram IPI, ICMS (destacado / ST) e descontos; integram frete e outras despesas.
// (Seguro tratado como despesa acessória — ajuste aqui se a empresa entender diferente.)
export const basePisCofinsItem = (i) =>
  r2(Math.max(0, n(i.valorProduto) + n(i.vFrete) + n(i.vSeg) + n(i.vOutro) - n(i.vDesc) - n(i.vICMS)));

// Colunas do livro de entradas (hamburgueria): valor contábil, base, imposto, isentas/não tributadas, outras.
export function livroIcmsItem(i) {
  const contabil = valorContabilItem(i);
  const tp = (i.cstIcmsEntrada || "").slice(1);
  if (!tp) return { contabil, base: null, imposto: null, isentas: null, outras: null };
  let base = 0, imposto = 0, isentas = 0, outras = 0;
  if (["00", "10", "20", "70"].includes(tp)) {
    base = n(i.vBC);
    imposto = n(i.vICMS);
    // CST 20 (redução de base): o que sobra entre o valor da operação e a base vai para "isentas/não tributadas"
    if (tp === "20") isentas = Math.max(0, r2(baseCheia(i) - base));
    outras = Math.max(0, r2(contabil - base - isentas));
  } else if (tp === "40" || tp === "41") {
    isentas = contabil;
  } else {
    outras = contabil; // 60, 90 etc.: sem crédito -> valor contábil e outras
  }
  return { contabil, base: r2(base), imposto: r2(imposto), isentas: r2(isentas), outras: r2(outras) };
}

// ---------- Resumo da nota ----------
export function resumoNota(nota, usaIcms) {
  const soma = (fn) => r2(nota.itens.reduce((s, i) => s + n(fn(i)), 0));
  const resumo = { basePisCofins: soma(basePisCofinsItem) };
  if (usaIcms) {
    const livro = nota.itens.map(livroIcmsItem);
    const tot = (c) => r2(livro.reduce((s, l) => s + n(l[c]), 0));
    resumo.livro = { contabil: tot("contabil"), base: tot("base"), imposto: tot("imposto"), isentas: tot("isentas"), outras: tot("outras") };
  }
  return resumo;
}
