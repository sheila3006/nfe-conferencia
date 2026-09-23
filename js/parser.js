// parser.js
// Extrai os campos relevantes de um XML de NF-e (modelo 55, versão 4.00).

function texto(el, tag) {
  if (!el) return "";
  const node = el.getElementsByTagName(tag)[0];
  return node ? node.textContent.trim() : "";
}

function parseNFeXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");

  if (doc.getElementsByTagName("parsererror")[0]) {
    throw new Error("XML inválido ou corrompido.");
  }

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) {
    throw new Error("Não encontrei a tag <infNFe> — confira se é um XML de NF-e válido.");
  }

  const ide = infNFe.getElementsByTagName("ide")[0];
  const emit = infNFe.getElementsByTagName("emit")[0];

  const nota = {
    chaveAcesso: (infNFe.getAttribute("Id") || "").replace("NFe", ""),
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    dataEmissao: texto(ide, "dhEmi") || texto(ide, "dEmi"),
    valorTotal: parseFloat(texto(infNFe, "vNF") || "0"),
    emitente: {
      cnpj: texto(emit, "CNPJ") || texto(emit, "CPF"),
      nome: texto(emit, "xNome"),
      crt: texto(emit, "CRT"), // 1=Simples, 2=Simples excesso, 3=Normal, 4=MEI
    },
    itens: [],
  };

  const dets = infNFe.getElementsByTagName("det");
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const prod = det.getElementsByTagName("prod")[0];
    const imposto = det.getElementsByTagName("imposto")[0];
    const pisEl = imposto ? imposto.getElementsByTagName("PIS")[0] : null;
    const cofinsEl = imposto ? imposto.getElementsByTagName("COFINS")[0] : null;

    nota.itens.push({
      numeroItem: det.getAttribute("nItem") || String(i + 1),
      codigoProduto: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      ncm: texto(prod, "NCM"),
      cfop: texto(prod, "CFOP"),
      valorProduto: parseFloat(texto(prod, "vProd") || "0"),
      cstPis: texto(pisEl, "CST"),
      cstCofins: texto(cofinsEl, "CST"),
    });
  }

  return nota;
}

export { parseNFeXml };
