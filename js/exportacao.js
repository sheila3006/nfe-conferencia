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

export function gerarPdf(notas, nomeArquivo) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  notas.forEach((n, idx) => {
    if (idx > 0) pdf.addPage();

    const totais = {};
    n.itens.forEach((i) => {
      const k = i.classificacao || "sem classificação";
      totais[k] = (totais[k] || 0) + (i.valorProduto || 0);
    });

    pdf.setFontSize(13);
    pdf.text(`NF ${n.numero} - ${n.emitenteNome}`, 40, 40);
    pdf.setFontSize(9);
    pdf.text(`CNPJ ${n.emitenteCnpj}  |  Emissão ${fmtData(n.dataEmissao)}  |  Chave ${n.chaveAcesso}`, 40, 56);
    pdf.text("Totais: " + Object.entries(totais).map(([k, v]) => `${k} ${brl(v)}`).join("  |  "), 40, 70);

    pdf.autoTable({
      startY: 82,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: { 1: { cellWidth: 230 } },
      head: [["Item", "Descrição", "NCM", "CFOP orig.", "Classificação", "CFOP entrada", "CST PIS (orig. -> entrada)", "CST COFINS (orig. -> entrada)", "Valor", "Situação"]],
      body: n.itens.map((i) => [
        i.numeroItem, i.descricao, i.ncm, i.cfopOrigem, i.classificacao || "-", i.cfopEntrada || "-",
        `${i.cstPisOrigem} -> ${i.cstPis}`, `${i.cstCofinsOrigem} -> ${i.cstCofins}`,
        brl(i.valorProduto), i.revisado ? "Revisado" : "Pendente",
      ]),
    });
  });

  pdf.save(nomeArquivo);
}
