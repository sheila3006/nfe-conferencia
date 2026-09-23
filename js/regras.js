// regras.js
// Motor de classificação e conferência fiscal para notas de entrada.
// Ajuste as tabelas abaixo conforme o dia a dia real da empresa —
// isso é um ponto de partida baseado nas regras gerais da legislação,
// não substitui a validação do contador.

// ---------------------------------------------------------------
// 1) Classificação por CFOP (finalidade da compra)
// CFOPs de entrada (1.xxx / 2.xxx) e seus pares "espelho" quando a
// nota chega com o CFOP de saída do emitente (5.xxx / 6.xxx / 7.xxx).
// ---------------------------------------------------------------
const CFOP_CLASSIFICACAO = {
  // Industrialização (insumo, matéria-prima, embalagem)
  "1101": "industrialização", "2101": "industrialização", "3101": "industrialização",
  "5101": "industrialização", "6101": "industrialização", "7101": "industrialização",
  "1113": "industrialização", "2113": "industrialização",

  // Comércio (mercadoria para revenda)
  "1102": "comércio", "2102": "comércio", "3102": "comércio",
  "5102": "comércio", "6102": "comércio", "7102": "comércio",
  "1403": "comércio", "2403": "comércio",

  // Uso e consumo
  "1556": "uso e consumo", "2556": "uso e consumo",
  "5556": "uso e consumo", "6556": "uso e consumo",

  // Ativo imobilizado
  "1551": "ativo imobilizado", "2551": "ativo imobilizado",
  "5551": "ativo imobilizado", "6551": "ativo imobilizado",
};

// NCMs que, na prática da hamburgueria, quase sempre são insumo de
// produção (matéria-prima de alimento) — usado para sinalizar
// divergência quando o CFOP da nota não bate com isso.
// Preencha com os NCMs reais dos principais insumos (carnes, pães,
// queijos, embalagens, hortifruti etc.)
const NCM_INSUMO_PRODUCAO = [
  "0407", // ovos
  "0201", "0202", "0203", "0207", // carnes
  "0401", "0406", // leite e queijos
  "1905", // pães
  "0701", "0702", "0706", "0709", // hortifruti
];

function classificarPorCfop(cfop) {
  return CFOP_CLASSIFICACAO[cfop] || "não mapeado — revisar";
}

function ehProvavelInsumoProducao(ncm) {
  if (!ncm) return false;
  const prefixo4 = ncm.substring(0, 4);
  return NCM_INSUMO_PRODUCAO.includes(prefixo4);
}

// ---------------------------------------------------------------
// 2) CST válidos de PIS/COFINS (Tabela 4.3.3 / 4.3.4 do Manual da NF-e)
// ---------------------------------------------------------------
const CST_PIS_COFINS_VALIDOS = new Set([
  "01","02","03","04","05","06","07","08","09",
  "49","50","51","52","53","54","55","56",
  "60","61","62","63","64","65","66","67",
  "70","71","72","73","74","75","98","99",
]);

// CSTs que representam operações COM direito a crédito (regime não-cumulativo)
const CST_COM_CREDITO = new Set(["50","51","52","53","54","55","56"]);
// CSTs de "outras operações" que não destacam PIS/COFINS na nota
// (comuns quando o emitente é Simples Nacional, monofásico, etc.)
const CST_OUTRAS_SEM_DESTAQUE = new Set(["49","98","99"]);

/**
 * Confere o CST de PIS/COFINS de um item, cruzando com o CRT do emitente
 * e a classificação da compra, e devolve um veredito para revisão humana.
 *
 * @param {string} cst - código informado na nota (PIS e COFINS, ex: "49")
 * @param {string} crtEmitente - "1" Simples, "2" Simples excesso, "3" Normal, "4" MEI/outros
 * @param {string} classificacao - resultado de classificarPorCfop()
 * @param {boolean} provavelInsumo - resultado de ehProvavelInsumoProducao()
 */
function conferirCstPisCofins(cst, crtEmitente, classificacao, provavelInsumo) {
  if (!CST_PIS_COFINS_VALIDOS.has(cst)) {
    return { status: "erro", motivo: `CST ${cst} não consta na tabela oficial.` };
  }

  const emitenteSimples = crtEmitente === "1" || crtEmitente === "2";

  if (emitenteSimples && CST_OUTRAS_SEM_DESTAQUE.has(cst)) {
    if (classificacao === "industrialização" || provavelInsumo) {
      return {
        status: "revisar",
        motivo:
          "Fornecedor do Simples Nacional não destacou PIS/COFINS (CST " +
          cst +
          "), mas o item parece ser insumo de produção. Empresa em Lucro Real " +
          "pode ter direito a crédito calculado às alíquotas normais mesmo " +
          "assim (Lei 10.833/2003) — confirmar com a contabilidade se o " +
          "crédito está sendo escriturado internamente.",
      };
    }
    return { status: "ok", motivo: "CST compatível com fornecedor do Simples Nacional." };
  }

  if (!emitenteSimples && CST_OUTRAS_SEM_DESTAQUE.has(cst) &&
      (classificacao === "industrialização" || provavelInsumo)) {
    return {
      status: "revisar",
      motivo:
        "Fornecedor de regime normal usou CST " + cst + " (sem crédito) para um " +
        "item que parece insumo de produção. Verificar se o CST correto não " +
        "seria um dos códigos com direito a crédito (50-56).",
    };
  }

  if (CST_COM_CREDITO.has(cst) && classificacao === "uso e consumo") {
    return {
      status: "revisar",
      motivo:
        "CST " + cst + " indica direito a crédito, mas o item foi classificado " +
        "como uso e consumo — confirmar se esse bem realmente gera crédito de " +
        "PIS/COFINS no regime não-cumulativo.",
    };
  }

  return { status: "ok", motivo: "Sem inconsistências identificadas." };
}

export { classificarPorCfop, ehProvavelInsumoProducao, conferirCstPisCofins };
