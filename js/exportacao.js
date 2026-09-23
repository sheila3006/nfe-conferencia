// exportacao.js — XML ajustado e PDF de análise.

export function baixarArquivo(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function definir(pai, tag, valor) {
  const el = pai && pai.getElementsByTagName(tag)[0];
  if (el && valor) el.textContent = valor;
}

// Devolve o XML original com CFOP e CST de PIS/COFINS de cada item trocados
// pelos valores revisados. O restante do XML permanece intacto.
export function gerarXmlAjustado(xmlString, itens) {
  const xmlDoc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (xmlDoc.getElementsByTagName("parsererror")[0]) throw new Error("XML original corrompido.");

  const porNumero = new Map(itens.map((i) => [String(i.numeroItem), i]));
  for (const det of Array.from(xmlDoc.getElementsByTagName("det"))) {
    const item = porNumero.get(det.getAttribute("nItem"));
    if (!item) continue;
    definir(det.getElementsByTagName("prod")[0], "CFOP", item.cfopEntrada);
    definir(det.getElementsByTagName("PIS")[0], "CST", item.cstPis);
    definir(det.getElementsByTagName("COFINS")[0], "CST", item.cstCofins);
  }

  let saida = new XMLSerializer().serializeToString(xmlDoc);
  if (!saida.startsWith("<?xml")) saida = '<?xml version="1.0" encoding="UTF-8"?>' + saida;
  return saida;
}

const brl = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (s) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");

// Um PDF com TODAS as notas recebidas, numa única tabela (cada nota abre com
// uma linha de destaque). Não depende de trocar de página manualmente.
export function gerarPdf(notas, nomeArquivo, titulo = "Análise de NF-e") {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  pdf.setFontSize(14);
  pdf.text(`${titulo} - ${notas.length} nota(s)`, 30, 34);

  const corpo = [];
  notas.forEach((n) => {
    const totais = {};
    n.itens.forEach((i) => {
      const k = i.classificacao || "sem classificação";
      totais[k] = (totais[k] || 0) + (i.valorProduto || 0);
    });
    const resumo = Object.entries(totais).map(([k, v]) => `${k} ${brl(v)}`).join("  |  ");
    corpo.push([{
      content: `NF ${n.numero} - ${n.emitenteNome}  |  CNPJ ${n.emitenteCnpj}  |  Emissão ${fmtData(n.dataEmissao)}\nChave ${n.chaveAcesso}\nTotais: ${resumo}`,
      colSpan: 10,
      styles: { fillColor: [219, 234, 254], textColor: [15, 42, 90], fontStyle: "bold" },
    }]);
    n.itens.forEach((i) => corpo.push([
      i.numeroItem, i.descricao, i.ncm, i.cfopOrigem, i.classificacao || "-", i.cfopEntrada || "-",
      `${i.cstPisOrigem} -> ${i.cstPis}`, `${i.cstCofinsOrigem} -> ${i.cstCofins}`,
      brl(i.valorProduto), i.revisado ? "Revisado" : "Pendente",
    ]));
  });

  pdf.autoTable({
    startY: 46,
    margin: { left: 30, right: 30, bottom: 30 },
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 42, 90] },
    columnStyles: { 1: { cellWidth: 190 } },
    head: [["Item", "Descrição", "NCM", "CFOP orig.", "Classificação", "CFOP entrada", "CST PIS (orig. -> entrada)", "CST COFINS (orig. -> entrada)", "Valor", "Situação"]],
    body: corpo,
  });

  pdf.save(nomeArquivo);
}
