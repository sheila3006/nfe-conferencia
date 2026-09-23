// parser.js
// Extrai os campos relevantes de um XML de NF-e (modelo 55, versão 4.00).

function texto(el, tag) {
  const node = el.getElementsByTagName(tag)[0];
  return node ? node.textContent.trim() : "";
}

/**
 * Recebe o texto bruto do XML e devolve um objeto estruturado
 * com os dados da nota e a lista de itens.
 */
function parseNFeXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const erro = doc.getElementsByTagName("parsererror")[0];
  if (erro) {
    throw new Error("XML inválido ou corrompido.");
  }

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) {
    throw new Error("Não encontrei a tag <infNFe> — confira se é um XML de NF-e válido.");
  }

  const ide = infNFe.getElementsByTagName("ide")[0];
  const emit = infNFe.getElementsByTagName("emit")[0];
  const dest = infNFe.getElementsByTagName("dest")[0];

  const chaveAcesso = (infNFe.getAttribute("Id") || "").replace("NFe", "");

  const nota = {
    chaveAcesso,
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    dataEmissao: texto(ide, "dhEmi"),
    naturezaOperacao: texto(ide, "natOp"),
    emitente: {
      cnpj: texto(emit, "CNPJ"),
      nome: texto(emit, "xNome"),
      crt: texto(emit, "CRT"), // 1=Simples, 3=Normal, 4=MEI/outros
    },
    destinatario: {
      cnpj: texto(dest, "CNPJ"),
      nome: texto(dest, "xNome"),
    },
    itens: [],
  };

  const dets = infNFe.getElementsByTagName("det");
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const prod = det.getElementsByTagName("prod")[0];
    const imposto = det.getElementsByTagName("imposto")[0];

    // CST de PIS: pode vir dentro de várias tags filhas (PISAliq, PISOutr, PISNT, PISST, PISQtde)
    const pisEl = imposto ? imposto.getElementsByTagName("PIS")[0] : null;
    const cofinsEl = imposto ? imposto.getElementsByTagName("COFINS")[0] : null;
    const cstPis = pisEl ? texto(pisEl, "CST") : "";
    const cstCofins = cofinsEl ? texto(cofinsEl, "CST") : "";

    nota.itens.push({
      numeroItem: det.getAttribute("nItem"),
      codigoProduto: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      ncm: texto(prod, "NCM"),
      cfop: texto(prod, "CFOP"),
      valorProduto: parseFloat(texto(prod, "vProd") || "0"),
      cstPis,
      cstCofins,
    });
  }

  return nota;
}

export { parseNFeXml };
