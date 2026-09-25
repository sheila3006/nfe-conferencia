// exportacao.js — XML ajustado, PDF de análise e download em lote (.zip).
import { getDoc } from "./firebase-init.js";
import { docEmpresa } from "./estado.js";

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

// Baixa, num único .zip, o XML ajustado (com CFOP/CST revisados) de todas as notas
// informadas — evita ter que clicar "Gerar XML" nota por nota.
export async function gerarZipXmls(notas, nomeArquivo, onProgresso) {
  if (typeof JSZip === "undefined") throw new Error("A biblioteca de compactação não carregou. Verifique a internet e recarregue a página.");
  const zip = new JSZip();
  const usados = new Set();
  const falhas = [];

  for (let i = 0; i < notas.length; i++) {
    const n = notas[i];
    onProgresso?.(i + 1, notas.length);
    try {
      const snap = await getDoc(docEmpresa("xmls", n.id));
      if (!snap.exists()) { falhas.push(`NF ${n.numero}: XML original não encontrado.`); continue; }
      const xml = gerarXmlAjustado(snap.data().xml, n.itens);
      let nome = `${n.chaveAcesso || n.numero}-ajustado.xml`;
      if (usados.has(nome)) nome = `${n.chaveAcesso || n.numero}-${n.id}-ajustado.xml`;
      usados.add(nome);
      zip.file(nome, xml);
    } catch (err) {
      falhas.push(`NF ${n.numero}: ${err.message}`);
    }
  }

  if (!usados.size) throw new Error("Nenhum XML pôde ser preparado" + (falhas.length ? ": " + falhas[0] : "."));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nomeArquivo });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (falhas.length) alert(`${usados.size} XML(s) baixado(s). Alguns ficaram de fora:\n` + falhas.join("\n"));
}
