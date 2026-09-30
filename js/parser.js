// parser.js
// Extrai os campos relevantes de um XML de NF-e (modelo 55, versão 4.00).

const num = (v) => parseFloat(v || "0") || 0;

function texto(el, tag) {
  if (!el) return "";
  const node = el.getElementsByTagName(tag)[0];
  return node ? node.textContent.trim() : "";
}

// O grupo <ICMS> sempre tem um único filho, cujo nome varia conforme o CST/CSOSN
// (ICMS00, ICMS10, ICMS60, ICMSSN102, etc.) — pegamos o primeiro filho e lemos
// CST ou CSOSN de dentro dele, o que existir.
function lerIcms(imposto) {
  const icms = imposto ? imposto.getElementsByTagName("ICMS")[0] : null;
  const grupo = icms ? icms.firstElementChild : null;
  return {
    orig: texto(grupo, "orig"), // origem da mercadoria (0-8): 1º dígito do CST de ICMS de 3 posições
    cst: texto(grupo, "CST"),
    csosn: texto(grupo, "CSOSN"),
    vBC: num(texto(grupo, "vBC")),       // base do ICMS próprio (difere do vProd no CST 20)
    vICMS: num(texto(grupo, "vICMS")),   // ICMS destacado
    vICMSST: num(texto(grupo, "vICMSST")), // ICMS-ST cobrado na nota (soma no total da NF)
    vFCPST: num(texto(grupo, "vFCPST")),
  };
}

// O grupo <IPI> tem um filho <IPITrib> (quando há tributação/situação definida)
// ou <IPINT> (não tributado) — o CST fica dentro desse filho. Muitos
// fornecedores não são contribuintes de IPI e nem incluem esse grupo.
function lerIpi(imposto) {
  const ipi = imposto ? imposto.getElementsByTagName("IPI")[0] : null;
  if (!ipi) return { cst: "", vIPI: 0 };
  const trib = ipi.getElementsByTagName("IPITrib")[0] || ipi.getElementsByTagName("IPINT")[0];
  return { cst: texto(trib, "CST"), vIPI: num(texto(trib, "vIPI")) };
}

// Imposto de importação do item (entra no total da NF)
function lerIi(imposto) {
  const ii = imposto ? imposto.getElementsByTagName("II")[0] : null;
  return ii ? num(texto(ii, "vII")) : 0;
}

function lerTotais(tot) {
  return {
    vProd: num(texto(tot, "vProd")), vDesc: num(texto(tot, "vDesc")), vICMSDeson: num(texto(tot, "vICMSDeson")),
    vST: num(texto(tot, "vST")), vFCPST: num(texto(tot, "vFCPST")), vFrete: num(texto(tot, "vFrete")),
    vSeg: num(texto(tot, "vSeg")), vOutro: num(texto(tot, "vOutro")), vII: num(texto(tot, "vII")),
    vIPI: num(texto(tot, "vIPI")), vIPIDevol: num(texto(tot, "vIPIDevol")),
    vICMS: num(texto(tot, "vICMS")), vBC: num(texto(tot, "vBC")), vNF: num(texto(tot, "vNF")),
  };
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
  const dest = infNFe.getElementsByTagName("dest")[0];

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
    // Destinatário = a própria empresa que recebeu a nota (matriz ou filial).
    // Serve para separar as notas por unidade/CNPJ dentro da mesma empresa do app.
    destinatario: {
      cnpj: texto(dest, "CNPJ") || texto(dest, "CPF"),
      nome: texto(dest, "xNome"),
    },
    // Totais declarados no grupo <ICMSTot> — usados na conferência do valor da NF
    totais: lerTotais(infNFe.getElementsByTagName("ICMSTot")[0]),
    itens: [],
  };

  const dets = infNFe.getElementsByTagName("det");
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const prod = det.getElementsByTagName("prod")[0];
    const imposto = det.getElementsByTagName("imposto")[0];
    const pisEl = imposto ? imposto.getElementsByTagName("PIS")[0] : null;
    const cofinsEl = imposto ? imposto.getElementsByTagName("COFINS")[0] : null;
    const icms = lerIcms(imposto);
    const ipi = lerIpi(imposto);
    const vII = lerIi(imposto);

    nota.itens.push({
      numeroItem: det.getAttribute("nItem") || String(i + 1),
      codigoProduto: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      ncm: texto(prod, "NCM"),
      cfop: texto(prod, "CFOP"),
      valorProduto: parseFloat(texto(prod, "vProd") || "0"),
      cstPis: texto(pisEl, "CST"),
      cstCofins: texto(cofinsEl, "CST"),
      cstIcms: icms.cst,     // preenchido quando o fornecedor é regime normal
      csosnIcms: icms.csosn, // preenchido quando o fornecedor é Simples Nacional
      cstIpi: ipi.cst,       // vazio quando o fornecedor não é contribuinte de IPI
      origIcms: icms.orig,
      vBC: icms.vBC, vICMS: icms.vICMS, vICMSST: icms.vICMSST, vFCPST: icms.vFCPST,
      vIPI: ipi.vIPI, vII,
      vFrete: num(texto(prod, "vFrete")), vSeg: num(texto(prod, "vSeg")),
      vDesc: num(texto(prod, "vDesc")), vOutro: num(texto(prod, "vOutro")),
    });
  }

  return nota;
}

export { parseNFeXml };
