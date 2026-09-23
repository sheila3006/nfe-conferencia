// conferencia.js — importação de XMLs e lista das notas importadas nesta sessão.
import { getDoc, setDoc, serverTimestamp } from "./firebase-init.js";
import { parseNFeXml } from "./parser.js";
import { classificarItem, cfopEntradaSugerido, cstEntradaSugerido, chaveProduto } from "./regras.js";
import { gerarPdf } from "./exportacao.js";
import { criarLista } from "./notas-ui.js";
import { estado, docEmpresa, $, passaBusca } from "./estado.js";

let lista;

export function iniciarConferencia() {
  lista = criarLista({
    raiz: $("conf-lista"),
    paginacao: $("conf-paginacao"),
    vazio: "Nenhuma nota importada nesta sessão. Envie os XMLs acima para começar.",
    obter: () => estado.notas.filter((n) => estado.sessao.has(n.id) && passaBusca(n)),
  });
  $("input-xml").addEventListener("change", importar);
  $("btn-pdf-conf").addEventListener("click", () => {
    const v = lista.visiveis();
    if (!v.length) return alert("Não há notas na página para gerar o PDF.");
    gerarPdf(v, "analise-nfe-conferencia.pdf", `Análise de NF-e - ${estado.empresa.nome}`);
  });
}

export const renderConferencia = (zerar) => lista.render(zerar);

// Junta o cadastro de produtos da empresa (se já revisado antes) com as sugestões automáticas
async function montarItem(nota, item) {
  const cad = await getDoc(docEmpresa("produtos", chaveProduto(nota.emitente.cnpj, item.codigoProduto)));
  let classificacao, cfopEntrada, cstPis, cstCofins, origem, motivo;

  if (cad.exists()) {
    const c = cad.data();
    classificacao = c.classificacao;
    cfopEntrada = c.cfopOrigem === item.cfop ? c.cfopEntrada : cfopEntradaSugerido(item.cfop, classificacao);
    cstPis = c.cstPis;
    cstCofins = c.cstCofins;
    origem = "cadastro";
    motivo = "Item já revisado anteriormente (cadastro de produtos).";
  } else {
    const s = classificarItem(item);
    classificacao = s.classificacao;
    cfopEntrada = cfopEntradaSugerido(item.cfop, classificacao);
    const cst = cstEntradaSugerido(classificacao, item.ncm, item.cstPis);
    cstPis = cstCofins = cst.cst;
    origem = "sugestao";
    motivo = `${s.motivo} ${cst.motivo}`;
  }

  return {
    numeroItem: item.numeroItem, codigoProduto: item.codigoProduto, descricao: item.descricao,
    ncm: item.ncm, valorProduto: item.valorProduto,
    cfopOrigem: item.cfop, cstPisOrigem: item.cstPis, cstCofinsOrigem: item.cstCofins,
    classificacao, cfopEntrada, cstPis, cstCofins, origem, motivo, revisado: false,
  };
}

async function importar(e) {
  const status = $("status-import");
  const arquivos = Array.from(e.target.files || []);
  const avisos = [];

  for (let n = 0; n < arquivos.length; n++) {
    const arq = arquivos[n];
    status.textContent = `Processando ${n + 1} de ${arquivos.length}: ${arq.name}`;
    try {
      const xml = await arq.text();
      if (new Blob([xml]).size > 900000) throw new Error("XML maior que 900 KB (limite do Firestore).");
      const nota = parseNFeXml(xml);
      const id = nota.chaveAcesso || `${nota.emitente.cnpj}_${nota.numero}`;

      const existente = await getDoc(docEmpresa("notas", id));
      if (existente.exists() &&
          !confirm(`A nota ${nota.numero} já foi importada. Reimportar e perder a revisão feita?`)) {
        avisos.push(`${arq.name}: já importada, ignorada.`);
        continue;
      }

      const itens = await Promise.all(nota.itens.map((it) => montarItem(nota, it)));
      const registro = {
        chaveAcesso: nota.chaveAcesso, numero: nota.numero, serie: nota.serie,
        dataEmissao: nota.dataEmissao, valorTotal: nota.valorTotal,
        emitenteNome: nota.emitente.nome, emitenteCnpj: nota.emitente.cnpj, emitenteCrt: nota.emitente.crt,
        itens, status: "pendente",
      };
      await setDoc(docEmpresa("notas", id), { ...registro, criadoEm: serverTimestamp() });
      await setDoc(docEmpresa("xmls", id), { xml, criadoEm: serverTimestamp() });

      estado.notas = [{ id, ...registro }, ...estado.notas.filter((x) => x.id !== id)];
      estado.sessao.add(id);
    } catch (err) {
      avisos.push(`${arq.name}: ${err.message}`);
    }
  }

  e.target.value = "";
  status.textContent = arquivos.length ? "Importação concluída." : "";
  lista.render(true);
  if (avisos.length) alert(avisos.join("\n"));
}
