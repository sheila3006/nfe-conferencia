// exportacao.js — XML ajustado, PDF de análise e download em lote (.zip).
import { getDoc } from "./firebase-init.js";
import { estado, docEmpresa } from "./estado.js";
import { empresaUsaIcms } from "./regras.js";
import { conferirTotalNota, resumoNota, basePisCofinsItem, livroIcmsItem } from "./valores.js";

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

// Troca o CST de PIS ou COFINS de um item.
// No leiaute da NF-e, cada grupo só aceita certos CST: <PISNT>/<COFINSNT> aceita 04 a 09,
// <PISAliq> aceita 01-02, <PISQtde> aceita 03 e <PISOutr>/<COFINSOutr> aceita 49 e 50 a 99.
// Os CST de entrada (50 a 99) só são válidos em <...Outr>. Se o fornecedor usou outro grupo
// (ex.: <PISNT>), o grupo é convertido para <...Outr> (base, alíquota e valor zerados, como
// nas operações sem destaque de PIS/COFINS), senão o sistema que importa o XML pode ignorar o CST.
function trocarCstPisCofins(det, tag, cst) {
  const el = det.getElementsByTagName(tag)[0];
  if (!el || !cst) return;
  const grupo = el.firstElementChild;
  if (!grupo) return;
  const nomeOutr = tag + "Outr";
  const ehEntradaOutr = Number(cst) >= 49;
  if (ehEntradaOutr && grupo.localName !== nomeOutr) {
    const doc = el.ownerDocument;
    const ns = el.namespaceURI;
    const campos = tag === "PIS" ? ["pPIS", "vPIS"] : ["pCOFINS", "vCOFINS"];
    const lerOuPadrao = (nome, padrao) => {
      const n = grupo.getElementsByTagName(nome)[0];
      return n && n.textContent.trim() ? n.textContent.trim() : padrao;
    };
    const novo = doc.createElementNS(ns, nomeOutr);
    const add = (nome, valor) => {
      const n = doc.createElementNS(ns, nome);
      n.textContent = valor;
      novo.appendChild(n);
    };
    add("CST", cst);
    add("vBC", lerOuPadrao("vBC", "0.00"));
    add(campos[0], lerOuPadrao(campos[0], "0.0000"));
    add(campos[1], lerOuPadrao(campos[1], "0.00"));
    el.replaceChild(novo, grupo);
    return;
  }
  definir(el, "CST", cst);
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
    trocarCstPisCofins(det, "PIS", item.cstPis);
    trocarCstPisCofins(det, "COFINS", item.cstCofins);
  }

  let saida = new XMLSerializer().serializeToString(xmlDoc);
  if (!saida.startsWith("<?xml")) saida = '<?xml version="1.0" encoding="UTF-8"?>' + saida;
  return saida;
}

const brl = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlOuTraco = (v) => (v == null ? "-" : brl(v));
const fmtData = (s) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");

// Um PDF com TODAS as notas recebidas, numa única tabela (cada nota abre com
// uma linha de destaque). Não depende de trocar de página manualmente.
// Inclui: conferência do total da NF, base de PIS/COFINS, CST de IPI e, na
// hamburgueria, CST de ICMS e colunas do livro (contábil/base/imposto/isentas/outras).
export function gerarPdf(notas, nomeArquivo, titulo = "Análise de NF-e") {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const icms = empresaUsaIcms(estado.empresa);
  const colunas = icms ? 18 : 12;

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

    const c = conferirTotalNota(n);
    const r = resumoNota(n, icms);
    let linhaValores;
    if (c.ok === null) linhaValores = "Valores: reimporte o XML para conferir.";
    else {
      linhaValores = `Valores: calculado ${brl(c.calculado)} | NF ${brl(c.informado)} | diferença ${brl(c.diferenca)} - ${c.ok ? "CONFEREM" : "DIVERGÊNCIA"}`;
      if (c.divergencias.length) linhaValores += `\n${c.divergencias.join(" | ")}`;
    }
    linhaValores += `\nBase PIS/COFINS: ${brl(r.basePisCofins)}`;
    if (r.livro) {
      const l = r.livro;
      linhaValores += `  |  Livro ICMS: contábil ${brl(l.contabil)} | base ${brl(l.base)} | imposto ${brl(l.imposto)} | isentas ${brl(l.isentas)} | outras ${brl(l.outras)}`;
    }

    corpo.push([{
      content: `NF ${n.numero} - ${n.emitenteNome}  |  CNPJ ${n.emitenteCnpj}  |  Emissão ${fmtData(n.dataEmissao)}\nChave ${n.chaveAcesso}\nTotais: ${resumo}\n${linhaValores}`,
      colSpan: colunas,
      styles: { fillColor: [219, 234, 254], textColor: [15, 42, 90], fontStyle: "bold" },
    }]);
    n.itens.forEach((i) => {
      const livro = icms ? livroIcmsItem(i) : null;
      corpo.push([
        i.numeroItem, i.descricao, i.ncm, i.cfopOrigem, i.classificacao || "-", i.cfopEntrada || "-",
        `${i.cstPisOrigem} -> ${i.cstPis}`, `${i.cstCofinsOrigem} -> ${i.cstCofins}`,
        ...(icms ? [`${i.cstIcmsOrigem || i.csosnIcmsOrigem || "-"} -> ${i.cstIcmsEntrada || "-"}`] : []),
        `${i.cstIpiOrigem || "-"} -> ${i.cstIpi || "-"}`,
        brl(i.valorProduto), brl(basePisCofinsItem(i)),
        ...(icms ? [brl(livro.contabil), brlOuTraco(livro.base), brlOuTraco(livro.imposto), brlOuTraco(livro.isentas), brlOuTraco(livro.outras)] : []),
        i.revisado ? "Revisado" : "Pendente",
      ]);
    });
  });

  pdf.autoTable({
    startY: 46,
    margin: { left: 20, right: 20, bottom: 30 },
    styles: { fontSize: icms ? 6 : 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 42, 90] },
    columnStyles: { 1: { cellWidth: icms ? 110 : 160 } },
    head: [[
      "Item", "Descrição", "NCM", "CFOP orig.", "Classificação", "CFOP entrada",
      "CST PIS (orig. -> entrada)", "CST COFINS (orig. -> entrada)",
      ...(icms ? ["CST ICMS (orig. -> entrada)"] : []),
      "CST IPI (orig. -> entrada)", "Valor", "Base PIS/COFINS",
      ...(icms ? ["Valor contábil", "Base ICMS", "ICMS", "Isentas/N. trib.", "Outras"] : []),
      "Situação",
    ]],
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
