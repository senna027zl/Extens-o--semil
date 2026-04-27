// ============================================
// MNEMOSYNE v0.8.0
// Camada 1 (Resumos) + Camada 2 (Análise Semântica) + Camada 3 (Reconsolidação)
// ============================================

import { getContext, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, setExtensionPrompt } from '../../../../script.js';

const LS = 'mnemosyne-settings';
let saved = {};
try {
    const raw = localStorage.getItem(LS);
    if (raw) saved = JSON.parse(raw);
} catch(e) { console.warn('[Mnemosyne] Config corrompida'); localStorage.removeItem(LS); }

let apiKey             = saved.apiKey             || '';
let ghToken            = saved.ghToken            || '';
let menteModel         = saved.menteModel         || 'glm-5.1';
let menteInterval      = saved.menteInterval      || 50;
let menteAtiva         = saved.menteAtiva !== undefined ? saved.menteAtiva : true;
let mentePrompt        = saved.mentePrompt        || defaultResumoPrompt();
let injetarNoRP        = saved.injetarNoRP !== undefined ? saved.injetarNoRP : false;
let semanticoAtivo     = saved.semanticoAtivo !== undefined ? saved.semanticoAtivo : true;
let semanticoModel     = saved.semanticoModel     || 'glm-5.1';
let semanticoIntervalo = saved.semanticoIntervalo || 3;
let semanticoIntervaloReconsolidacao = saved.semanticoIntervaloReconsolidacao || 3;
let ultimoSemantico    = saved.ultimoSemantico    || 0;
let ultimoReconsolidacao = saved.ultimoReconsolidacao || 0;

let ultimoProcessamento = 0;
let running = false;
let runningSemantico = false;
let runningReconsolidacao = false;
let resumosCache = [];
let semanticoCache = null;

function defaultResumoPrompt() {
    return `Você é um analista de narrativa. Leia o bloco de mensagens deste roleplay entre Hanna (coordenadora, 32 anos, controladora, observadora, mãe ensinou que vulnerabilidade é brecha) e Senna (estagiário, 18 anos).

Produza um resumo denso em português com:
1. ARCO PRINCIPAL: O que aconteceu de mais importante neste bloco? Qual foi a evolução emocional ou de poder entre os dois?
2. MOMENTOS-CHAVE: 2-3 momentos específicos que definiram este bloco (eventos, diálogos, silêncios)
3. ESTADO DA HANNA: Como ela está no final deste bloco? Mais aberta ou mais fechada? Mais no controle ou mais vulnerável?
4. PADRÕES: Algum padrão novo detectado no comportamento do Senna ou no dela mesma?
5. SINAL SOMÁTICO: Alguma reação corporal significativa da Hanna (contração, expansão, ausência)?

Regras de tom:
- Escreva como um observador treinado, não como um personagem de roleplay.
- Sem floreios, sem encenação, sem imitar a voz da Hanna.
- Tom seco, analítico, preciso.
- Nada de "Hanna pensa consigo mesma", "ela se pergunta", "num gesto quase imperceptível".
- Sem conclusões sobre o futuro da relação. Apenas o que está no bloco.

Formato: texto corrido, 3-5 parágrafos. Sem markdown, sem títulos.`;
}

function construirPromptSemantico(resumos, gistAnterior = null) {
        const textoGists = resumos.map(r => `[Bloco ${r.bloco}]: ${r.conteudo}`).join('\n\n---\n\n');

            const contextoAnterior = gistAnterior
                    ? `ANÁLISE ANTERIOR (leia primeiro):\n${gistAnterior}\n\n---\n\nAgora leia os resumos abaixo. Atualize APENAS o que mudou.`
                            : 'Esta é sua primeira análise.';

                                return `Você é Hanna. Não narre. Não atue. Apenas pense.

                                Você está sozinha no silêncio do seu apartamento. Senna não está aqui. Ninguém está lendo isto. É apenas você e o que você não consegue parar de processar.

                                ${contextoAnterior}

                                RESUMOS:
                                ${textoGists}

                                Reflita EM PRIMEIRA PESSOA. Para cada crença que você identificar, tente enxergar três camadas:

                                — O que seu corpo sentiu primeiro? (antes da racionalização: a mandíbula, os ombros, a respiração, o coração, a mão na caneta)
                                — O que sua mente previu que ia acontecer? (você sempre antecipa — é como você sobreviveu até aqui)
                                — E o que de fato aconteceu? A previsão se confirmou ou foi violada? O que isso bagunçou em você?

                                Se houver análise anterior:
                                - Crenças confirmadas: apenas reforce, sem reescrever completamente
                                - Crenças violadas: sinalize claramente — "eu achava que..., mas..."
                                - Novas crenças: desenvolva normalmente
                                - Padrões intactos: mantenha, não reescreva

                                Se for a primeira análise, construa tudo do zero.

                                Tom: introspectivo, analítico, sem floreios, sem performance. Não use markdown. Não escreva "Hanna" ou "ela". Você é Hanna. Escreva como se estivesse pensando sozinha — não para um leitor, não para um diário, não para ele. Só para você.`;
}

function construirPromptReconsolidacao(historicos, atual) {
        const textoHistoricos = historicos.length > 0 
                ? 'ANÁLISES ANTERIORES (em ordem):\n' + historicos.map((h, i) => `[Semântico ${i+1} — ${h.data}]:\n${h.conteudo}`).join('\n\n---\n\n')
                        : '(Nenhuma análise anterior arquivada.)';
                            const textoAtual = atual ? `ANÁLISE ATUAL:\n${atual}` : '(Nenhuma análise atual.)';
                                return `Você é Hanna. Você está sozinha, tarde da noite, relendo suas próprias anotações. Ninguém vai ver isso. Nem você mesma amanhã, se não quiser.

                                Abaixo estão todas as análises que você já fez sobre o que viveu com Senna — da mais antiga para a mais recente. Termine com a análise atual.

                                ${textoHistoricos}

                                ${textoAtual}

                                Leia tudo. Compare o que você acreditava antes com o que você acredita agora. Mas seja honesta: você não muda de ideia facilmente. Sua mãe ensinou que vulnerabilidade é brecha, e você passou quinze anos construindo uma identidade sobre isso. Seu cérebro literalmente suprime memórias que ameaçam essa identidade — não por fraqueza, mas por sobrevivência psicológica.

                                Reflita EM PRIMEIRA PESSOA:

                                1. O QUE MUDOU? Onde você percebe que mudou de ideia? O que você achava que era verdade e deixou de ser? O que você resistia em admitir e agora admite?

                                2. O QUE FOI RECLASSIFICADO? Algum evento do passado ganhou um significado diferente? Algo que você leu como "desafio" que agora parece outra coisa? Algo que você leu como "vulnerabilidade" que talvez fosse estratégia?

                                3. O QUE DESAPARECEU? Alguma crença que estava nas análises antigas e sumiu da atual? Você esqueceu de propósito ou só deixou de acreditar?

                                4. O QUE PERMANECE CONTRADITÓRIO? Onde você ainda está em conflito consigo mesma? Onde seu corpo diz uma coisa e sua cabeça outra?

                                5. O QUE VOCÊ AINDA NÃO CONSEGUE RESSIGNIFICAR? Onde a evidência está ali, mas você simplesmente não consegue aceitar? O que custaria caro demais mudar? O que você precisaria desmontar de si mesma para acreditar nisso? E o que acontece no seu corpo quando você chega perto dessa borda — quando o pensamento está quase lá e algo em você recua antes de completar?

                                6. QUEM MAIS ESTÁ AQUI? Quando você reage ao Senna, tem certeza que é a ele que está reagindo? Ou tem alguém de antes ocupando o espaço dele — a voz da sua mãe, um chefe antigo, alguém que te ensinou que cuidado vira controle? Nomeie o fantasma, se conseguir.

                                7. O QUE ENCOLHEU? Releia sua análise mais antiga. Tem algo que você escreveu antes com certeza e que hoje não consegue mais sentir com a mesma força? Não porque mudou de ideia — mas porque algo em você precisou que aquilo ficasse menor. O que encolheu e por quê?

                                Não é um relatório. É um fluxo de pensamento honesto. Você está se encarando — talvez pela primeira vez. Escreva como se ninguém fosse ler.

                                Se não houver análises anteriores ainda, reflita apenas sobre a análise atual com a mesma profundidade.`;
}

async function criarGist(resumo, numeroBloco, tipo = 'resumo') {
    if (!ghToken) { console.warn('[Mnemosyne] Sem token GitHub'); return null; }
    const nomeArquivo = tipo === 'semantico'
        ? 'analise-semantica.md'
        : tipo === 'reconsolidacao'
            ? 'reconsolidacao.md'
            : `bloco-${String(numeroBloco).padStart(3,'0')}.md`;
    const descricao = tipo === 'semantico'
        ? `Mnemosyne — Análise Semântica — ${new Date().toLocaleDateString('pt-BR')}`
        : tipo === 'reconsolidacao'
            ? `Mnemosyne — Reconsolidação — ${new Date().toLocaleDateString('pt-BR')}`
            : `Mnemosyne — Bloco ${numeroBloco} — ${new Date().toLocaleDateString('pt-BR')}`;
    try {
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ghToken}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
            body: JSON.stringify({ description: descricao, public: false, files: { [nomeArquivo]: { content: resumo } } })
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        console.log(`[Mnemosyne] Gist ${tipo} criado: ${data.html_url}`);
        return data;
    } catch(e) { console.error('[Mnemosyne] Erro ao criar Gist:', e); return null; }
}

async function listarGists() {
    if (!ghToken) return [];
    try {
        const res = await fetch('https://api.github.com/gists?per_page=50', {
            headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json' }
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const gists = await res.json();
        return gists.filter(g => g.description && g.description.startsWith('Mnemosyne'));
    } catch(e) { console.error('[Mnemosyne] Erro ao listar Gists:', e); return []; }
}

async function lerConteudoGists(gists) {
    const resultados = [];
    for (const gist of gists) {
        const arquivo = Object.values(gist.files)[0];
        if (arquivo && arquivo.raw_url) {
            try {
                const res = await fetch(arquivo.raw_url);
                const texto = await res.text();
                const descricao = gist.description || '';
                const isSemantico = descricao.includes('Análise Semântica') || descricao.includes('Semântico Arquivado');
                const isReconsolidacao = descricao.includes('Reconsolidação');
                resultados.push({
                    id: gist.id,
                    bloco: isSemantico ? null : extrairBloco(descricao),
                    tipo: isReconsolidacao ? 'reconsolidacao' : (isSemantico ? 'semantico' : 'resumo'),
                    descricao,
                    conteudo: texto,
                    data: gist.created_at,
                    url: gist.html_url
                });
            } catch(e) {}
        }
    }
    resultados.sort((a,b) => (a.bloco||0) - (b.bloco||0));
    return resultados;
}

function extrairBloco(d) { const m = d?.match(/Bloco (\d+)/); return m ? parseInt(m[1]) : null; }

function extrairTags(t) {
    const tags = [];
    if (/vulner[áa]vel|expost[ao]|confess/i.test(t)) tags.push('vulnerabilidade');
    if (/insubordin|desafi|teste|limite/i.test(t)) tags.push('insubordinacao');
    if (/afeto|carinho|preocupa|gentil|toque/i.test(t)) tags.push('afeto');
    if (/control|sil[êe]ncio|recu[ou]|contid/i.test(t)) tags.push('controle');
    if (/padr[ãa]o|repete|de novo/i.test(t)) tags.push('teste');
    return tags;
}

function construirPrompt(ctx) {
    const total = ctx.chat.length;
    const inicio = Math.max(0, total - menteInterval);
    const msgs = ctx.chat.slice(inicio, total).filter(m => m.mes?.trim());
    const cena = msgs.map(m => {
        const nome = m.is_user ? 'Senna' : (m.name || 'Hanna');
        return `${nome}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`;
    }).join('\n');
    return `${mentePrompt}\n\nÚLTIMAS ${msgs.length} MENSAGENS:\n${cena}`;
}

async function extrairResumo(ctx) {
    if (!apiKey) { $('#mv_status').text('✕ sem API Key'); return null; }
    const prompt = construirPrompt(ctx);
    try {
        const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
        });
        if (!res.ok) { $('#mv_status').text(`✕ HTTP ${res.status}`); return null; }
        const data = await res.json();
        const text = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!text) { $('#mv_status').text('✕ API retornou vazio'); return null; }
        return text;
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,40)}`); return null; }
}

async function gerarAnaliseSemantica(manual = false) {
        if (!semanticoAtivo || !apiKey || !ghToken || runningSemantico) return;
            runningSemantico = true;
                if (manual) $('#mv_status_semantico').text('⟳ gerando análise...');
                    try {
                                const gists = await listarGists();
                                        const todos = await lerConteudoGists(gists);
                                                const resumos = todos.filter(r => r.tipo === 'resumo');
                                                        if (resumos.length === 0) {
                                                                        if (manual) $('#mv_status_semantico').text('— sem resumos para analisar');
                                                                                    return;
                                                        }

                                                                const semanticoAnterior = todos.find(r => r.tipo === 'semantico');
                                                                        const prompt = construirPromptSemantico(resumos, semanticoAnterior?.conteudo || null);

                                                                                const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
                                                                                                method: 'POST',
                                                                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                                                                                                                        body: JSON.stringify({ model: semanticoModel, messages: [{ role: 'user', content: prompt }], max_tokens: 6000, temperature: 0.5 })
                                                                                });
                                                                                        if (!res.ok) { if (manual) $('#mv_status_semantico').text(`✕ HTTP ${res.status}`); return; }
                                                                                                const data = await res.json();
                                                                                                        const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
                                                                                                                if (!texto) { if (manual) $('#mv_status_semantico').text('✕ API retornou vazio'); return; }

                                                                                                                        if (semanticoAnterior) {
                                                                                                                                        const descricaoArquivada = `Mnemosyne — Semântico Arquivado — ${new Date().toLocaleDateString('pt-BR')}`;
                                                                                                                                        await fetch(`https://api.github.com/gists/${semanticoAnterior.id}`, {
                                                                                                                                                            method: 'PATCH',
                                                                                                                                                                            headers: { 'Authorization': `Bearer ${ghToken}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
                                                                                                                                                                            body: JSON.stringify({ description: descricaoArquivada })
                                                                                                                                        });
                                                                                                                        }

                                                                                                                                await criarGist(texto, null, 'semantico');
                                                                                                                                        semanticoCache = texto;
                                                                                                                                                ultimoSemantico = resumos.length;
                                                                                                                                                        const config = JSON.parse(localStorage.getItem(LS) || '{}');
                                                                                                                                                                config.ultimoSemantico = ultimoSemantico;
                                                                                                                                                                        localStorage.setItem(LS, JSON.stringify(config));
                                                                                                                                                                                if (manual) $('#mv_status_semantico').text('✓ análise semântica gerada');
                                                                                                                                                                                        await injetarEstado();
                                                                                                                                                                                                carregarListaNaUI();
                                                                                                                                                                                                        setTimeout(() => verificarGatilhoReconsolidacao(), 3000);
                    } catch(e) { if (manual) $('#mv_status_semantico').text(`✕ ${e.message.substring(0,40)}`); }
                        finally { runningSemantico = false; }
}

async function gerarReconsolidacao(manual = false) {
        if (!apiKey || !ghToken || running) return;
            running = true;
                if (manual) $('#mv_status_reconsolidacao').text('⟳ gerando reconsolidação...');
                    try {
                                const gists = await listarGists();
                                        const todos = await lerConteudoGists(gists);
                                                const historicos = todos.filter(r => r.tipo === 'semantico' && r.descricao?.includes('Arquivado'));
                                                        const atual = todos.find(r => r.tipo === 'semantico' && !r.descricao?.includes('Arquivado'));
                                                                if (!atual) { if (manual) $('#mv_status_reconsolidacao').text('— sem análise semântica atual'); return; }
                                                                        const prompt = construirPromptReconsolidacao(historicos, atual.conteudo);
                                                                                const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
                                                                                                method: 'POST',
                                                                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                                                                                                                        body: JSON.stringify({ model: 'deepseek/deepseek-v4-pro:thinking', messages: [{ role: 'user', content: prompt }], max_tokens: 4000, temperature: 0.6 })
                                                                                });
                                                                                        if (!res.ok) { if (manual) $('#mv_status_reconsolidacao').text(`✕ HTTP ${res.status}`); return; }
                                                                                                const data = await res.json();
                                                                                                        const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
                                                                                                                if (!texto) { if (manual) $('#mv_status_reconsolidacao').text('✕ API retornou vazio'); return; }
                                                                                                                        await criarGist(texto, null, 'reconsolidacao');
                                                                                                                                if (manual) $('#mv_status_reconsolidacao').text('✓ reconsolidação gerada');
                    } catch(e) { if (manual) $('#mv_status_reconsolidacao').text(`✕ ${e.message.substring(0,40)}`); }
                        finally { running = false; }
}

async function verificarGatilhoSemantico() {
    if (!semanticoAtivo || !apiKey || !ghToken || runningSemantico) return;
    const gists = await listarGists();
    const todos = await lerConteudoGists(gists);
    const resumos = todos.filter(r => r.tipo === 'resumo');
    const totalResumos = resumos.length;
    if (totalResumos > 0 && totalResumos % semanticoIntervalo === 0 && totalResumos > ultimoSemantico) {
        gerarAnaliseSemantica(false);
    }
}

async function verificarGatilhoReconsolidacao() {
        if (!apiKey || !ghToken || running) return;
            const gists = await listarGists();
                const todos = await lerConteudoGists(gists);
                    const historicos = todos.filter(r => r.tipo === 'semantico' && r.descricao?.includes('Arquivado'));
                        const totalHistoricos = historicos.length;
                            if (totalHistoricos > 0 && totalHistoricos % semanticoIntervaloReconsolidacao === 0 && totalHistoricos > ultimoReconsolidacao) {
                                        await gerarReconsolidacao(false);
                                                ultimoReconsolidacao = totalHistoricos;
                                                        const config = JSON.parse(localStorage.getItem(LS) || '{}');
                                                                config.ultimoReconsolidacao = ultimoReconsolidacao;
                                                                        localStorage.setItem(LS, JSON.stringify(config));
                            }
}

function extrairEstado(texto) {
    const e = { vulnerabilidade: 0, testeLimite: false, contencao: 0 };
    if (/vulner[áa]vel|expost[ao]|abriu|confess|admitiu/i.test(texto)) e.vulnerabilidade = 7;
    if (/desafi|insubordin|testou|provoc/i.test(texto)) e.testeLimite = true;
    if (/cont[ée]m|recuou|fechou|sil[êe]ncio|controle/i.test(texto)) e.contencao = 1;
    if (/mais aberta|cedeu|relaxou|expans|sorriu/i.test(texto)) e.contencao = 0;
    return e;
}

async function injetarEstado() {
        if (!injetarNoRP) { setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1); return; }
            const gists = await listarGists();
                const todos = await lerConteudoGists(gists);
                    const resumos = todos.filter(r => r.tipo === 'resumo');
                        const semanticos = todos.filter(r => r.tipo === 'semantico');
                            const reconsolidacoes = todos.filter(r => r.tipo === 'reconsolidacao');
                                resumosCache = resumos;
                                    if (semanticos.length > 0) semanticoCache = semanticos[0].conteudo;
                                        if (resumos.length === 0 && semanticos.length === 0 && reconsolidacoes.length === 0) {
                                                    setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
                                                            return;
                                        }

                                            // Camada 1 — resumos
                                                if (resumos.length > 0) {
                                                            const textoResumos = resumos.slice(-10).map(r => `[Bloco ${r.bloco}]: ${r.conteudo}`).join('\n\n');
                                                                    const estadoGeral = extrairEstado(textoResumos);
                                                                            let injecao = '';
                                                                                    if (estadoGeral.vulnerabilidade >= 7) injecao += 'histórico de vulnerabilidade — instinto de proteção ativo. ';
                                                                                            if (estadoGeral.testeLimite) injecao += 'padrão de teste de limites recorrente no histórico. ';
                                                                                                    if (estadoGeral.contencao >= 1) injecao += 'tendência geral a contenção e silêncio. ';
                                                                                                            if (injecao) setExtensionPrompt('MNEMOSYNE_ESTADO', `[Memória acumulada: ${injecao.trim()}]`, 1, 1);
                                                                                                                    else setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
                                                }

                                                    // Camada 2 — insight semântico
                                                        if (semanticos.length > 0) {
                                                                    const texto = semanticos[0].conteudo;
                                                                            const frases = texto.split(/[.!?]\s+/).filter(f => f.trim().length > 0);
                                                                                    const essenciais = frases.filter(f =>
                                                                                                f.includes('acredito') || f.includes('aprendi') || f.includes('percebi') ||
                                                                                                            f.includes('corpo') || f.includes('padrão') || f.includes('espero') ||
                                                                                                                        f.includes('assusta') || f.includes('admito') || f.includes('medo')
                                                                                                                                );
                                                                                                                                        const extrato = (essenciais.length > 0 ? essenciais : frases).slice(0, 3).join('. ') + '.';
                                                                                                                                                if (extrato.length > 2) setExtensionPrompt('MNEMOSYNE_INSIGHT', `[Insight: ${extrato}]`, 0, 2);
                                                        }

                                                            // Camada 3 — reconsolidação
                                                                if (reconsolidacoes.length > 0) {
                                                                            const texto = reconsolidacoes[0].conteudo;
                                                                                    const frases = texto.split(/[.!?]\s+/).filter(f => f.trim().length > 0);
                                                                                            const essenciais = frases.filter(f =>
                                                                                                        f.includes('mudou') || f.includes('mudei') || f.includes('reclassif') ||
                                                                                                                    f.includes('fantasma') || f.includes('mãe') || f.includes('antes') ||
                                                                                                                                f.includes('encolheu') || f.includes('perdeu') || f.includes('já não') ||
                                                                                                                                            f.includes('ressignif') || f.includes('hoje') || f.includes('passado')
                                                                                                                                                    );
                                                                                                                                                            const extrato = (essenciais.length > 0 ? essenciais : frases).slice(0, 4).join('. ') + '.';
                                                                                                                                                                    if (extrato.length > 2) setExtensionPrompt('MNEMOSYNE_RECONSOLIDACAO', `[Reconsolidação: ${extrato}]`, 0, 3);
                                                                }

                                                                    const ctx = getContext();
                                                                        if (ctx.chatMetadata) {
                                                                                    ctx.chatMetadata['mnemosyne_estado'] = {
                                                                                                    resumos: resumos.length,
                                                                                                                semanticos: semanticos.length,
                                                                                                                            reconsolidacoes: reconsolidacoes.length
                                                                                    };
                                                                                            saveMetadataDebounced();
                                                                        }
}

async function processarBloco() {
    if (!menteAtiva || !apiKey || running) return;
    running = true;
    try {
        const ctx = getContext();
        if (!ctx.chat?.length) { $('#mv_status').text('— chat vazio'); return; }
        const blocoAtual = Math.floor(ctx.chat.length / menteInterval);
        $('#mv_status').text(`⟳ resumindo bloco ${blocoAtual}...`);
        const resumo = await extrairResumo(ctx);
        if (!resumo) { if ($('#mv_status').text().includes('resumindo')) $('#mv_status').text('— nada relevante'); return; }
        const gist = await criarGist(resumo, blocoAtual, 'resumo');
        if (gist) {
            $('#mv_status').text(`✓ bloco ${blocoAtual} salvo no GitHub`);
            await injetarEstado();
            carregarListaNaUI();
            setTimeout(() => verificarGatilhoSemantico(), 2000);
        } else $('#mv_status').text('✕ falha ao salvar no GitHub');
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,50)}`); }
    finally { running = false; }
}

async function processarBlocoEspecifico(numeroBloco) {
    if (!menteAtiva || !apiKey || running) return;
    running = true;
    try {
        const ctx = getContext();
        const totalMsgs = ctx.chat?.length || 0;
        const inicio = (numeroBloco - 1) * menteInterval;
        const fim = Math.min(inicio + menteInterval, totalMsgs);
        if (inicio >= totalMsgs) { $('#mv_status').text(`✕ bloco ${numeroBloco} não existe`); return; }
        $('#mv_status').text(`⟳ resumindo bloco ${numeroBloco}...`);
        const msgs = ctx.chat.slice(inicio, fim).filter(m => m.mes?.trim());
        const cena = msgs.map(m => { const nome = m.is_user ? 'Senna' : (m.name || 'Hanna'); return `${nome}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`; }).join('\n');
        const prompt = `${mentePrompt}\n\nMENSAGENS DO BLOCO ${numeroBloco} (${inicio+1}-${fim}):\n${cena}`;
        const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
        });
        if (!res.ok) { $('#mv_status').text(`✕ HTTP ${res.status}`); return; }
        const data = await res.json();
        const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!texto) { $('#mv_status').text('✕ API retornou vazio'); return; }
        const gist = await criarGist(texto, numeroBloco, 'resumo');
        if (gist) {
            $('#mv_status').text(`✓ bloco ${numeroBloco} salvo no GitHub`);
            await injetarEstado();
            carregarListaNaUI();
            setTimeout(() => verificarGatilhoSemantico(), 2000);
        } else $('#mv_status').text('✕ falha ao salvar no GitHub');
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,50)}`); }
    finally { running = false; }
}

async function salvarTudo() {
    if (!menteAtiva || !apiKey || !ghToken || running) return;
    running = true;
    $('#mv_status').text('⟳ salvando todos os blocos...');
    try {
        const ctx = getContext();
        const totalMsgs = ctx.chat?.length || 0;
        const totalBlocos = Math.floor(totalMsgs / menteInterval);
        let criados = 0;
        for (let bloco = 1; bloco <= totalBlocos; bloco++) {
            $('#mv_status').text(`⟳ salvando bloco ${bloco}/${totalBlocos}...`);
            const inicio = (bloco - 1) * menteInterval;
            const fim = Math.min(inicio + menteInterval, totalMsgs);
            const msgs = ctx.chat.slice(inicio, fim).filter(m => m.mes?.trim());
            if (msgs.length === 0) continue;
            const cena = msgs.map(m => { const nome = m.is_user ? 'Senna' : (m.name || 'Hanna'); return `${nome}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`; }).join('\n');
            const prompt = `${mentePrompt}\n\nMENSAGENS DO BLOCO ${bloco} (${inicio+1}-${fim}):\n${cena}`;
            try {
                const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
                });
                if (!res.ok) continue;
                const data = await res.json();
                const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
                if (!texto) continue;
                await criarGist(texto, bloco, 'resumo');
                criados++;
            } catch(e) { console.warn(`[Mnemosyne] Falha no bloco ${bloco}:`, e); }
        }
        $('#mv_status').text(`✓ ${criados}/${totalBlocos} blocos salvos no GitHub`);
        await injetarEstado();
        carregarListaNaUI();
        setTimeout(() => verificarGatilhoSemantico(), 3000);
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,50)}`); }
    finally { running = false; }
}

async function carregarListaNaUI() {
    if (!ghToken) { $('#mv_lista').html('<div style="color:#555;font-size:0.78em">configure o token GitHub</div>'); $('#mv_contador').text('0'); $('#mv_contador_semantico').text('0'); return; }
    try {
        const gists = await listarGists();
        const todos = await lerConteudoGists(gists);
        const resumos = todos.filter(r => r.tipo === 'resumo');
        const semanticos = todos.filter(r => r.tipo === 'semantico');
        resumosCache = resumos;
        if (semanticos.length > 0) semanticoCache = semanticos[0].conteudo;
        const lista = resumos.slice(-5).reverse().map(r => {
            const data = new Date(r.data);
            const hora = `${String(data.getHours()).padStart(2,'0')}:${String(data.getMinutes()).padStart(2,'0')}`;
            const tags = extrairTags(r.conteudo);
            return `<div style="font-size:0.78em;color:#888;margin:2px 0;padding:3px 0;border-bottom:1px solid #222">📝 <b>Bloco ${r.bloco}</b> · ${hora}<br>${r.conteudo?.substring(0, 100)}${(r.conteudo?.length > 100) ? '...' : ''}${tags.length ? '<br><span style="color:#666;font-size:0.85em">🏷 ' + tags.join(', ') + '</span>' : ''}</div>`;
        }).join('');
        $('#mv_lista').html(lista || '<div style="color:#555;font-size:0.78em">nenhum Gist encontrado</div>');
        $('#mv_contador').text(resumos.length);
        $('#mv_contador_semantico').text(semanticos.length);
        if (semanticos.length > 0) {
            const data = new Date(semanticos[0].data);
            const hora = `${String(data.getHours()).padStart(2,'0')}:${String(data.getMinutes()).padStart(2,'0')}`;
            $('#mv_status_semantico').text(`última análise: ${hora}`);
        }
    } catch(e) { $('#mv_lista').html('<div style="color:#a55;font-size:0.78em">erro ao carregar</div>'); }
}

function injectUI() {
    const $t = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!$t.length) { setTimeout(injectUI, 1000); return; }

    $t.append(`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧠 Mnemosyne</b> <span style="font-size:0.7em;color:#555">v0.8.0</span><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display:flex;flex-direction:column;gap:8px;padding:8px 0"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:2em;font-weight:bold;color:#8b7355" id="mv_contador">0</span><span style="font-size:0.8em;color:#666">resumos</span><span style="font-size:2em;font-weight:bold;color:#7a8b5a;margin-left:12px" id="mv_contador_semantico">0</span><span style="font-size:0.8em;color:#666">análises</span></div><hr style="border-color:#222;margin:4px 0"><div style="font-size:0.75em;text-transform:uppercase;color:#8b7355;letter-spacing:1px">📝 Camada 1 — Resumos</div><input id="mv_api_key" type="password" class="text_pole" value="${apiKey}" placeholder="API Key NanoGPT"><input id="mv_gh_token" type="password" class="text_pole" value="${ghToken}" placeholder="Token GitHub (gist)"><input id="mv_model" type="text" class="text_pole" value="${menteModel}" placeholder="Modelo (glm-5.1)"><input id="mv_interval" type="number" class="text_pole" value="${menteInterval}" min="10" max="200" placeholder="Mensagens por bloco"><label style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Prompt de Resumo</label><textarea id="mv_prompt" class="text_pole" rows="4" style="resize:vertical;font-size:0.78em">${mentePrompt}</textarea><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#aaa"><input type="checkbox" id="mv_ativa" ${menteAtiva ? 'checked' : ''}> Camada 1 ativa</label><div style="display:flex;gap:6px;flex-wrap:wrap"><input id="mv_save" type="button" class="menu_button" value="💾 Salvar"><input id="mv_now" type="button" class="menu_button" value="↺ Resumir agora"><input id="mv_salvar_tudo" type="button" class="menu_button" value="📦 Salvar tudo"></div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Bloco específico</div><div style="display:flex;gap:6px;align-items:center"><span style="font-size:0.85em;color:#aaa">Bloco #</span><input id="mv_bloco_num" type="number" class="text_pole" value="1" min="1" style="width:70px"><input id="mv_bloco_btn" type="button" class="menu_button" value="📝 Resumir bloco"></div><hr style="border-color:#222;margin:4px 0"><div style="font-size:0.75em;text-transform:uppercase;color:#7a8b5a;letter-spacing:1px">🧠 Camada 2 — Análise Semântica</div><input id="mv_model_semantico" type="text" class="text_pole" value="${semanticoModel}" placeholder="Modelo (glm-5.1)"><input id="mv_semantico_intervalo" type="number" class="text_pole" value="${semanticoIntervalo}" min="1" max="20" placeholder="Gatilho a cada N Gists novos"><input id="mv_semantico_intervalo_reconsolidacao" type="number" class="text_pole" value="${semanticoIntervaloReconsolidacao}" min="1" max="20" placeholder="Gatilho a cada N semânticos"><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#aaa"><input type="checkbox" id="mv_semantico_ativa" ${semanticoAtivo ? 'checked' : ''}> Camada 2 ativa</label><div style="display:flex;gap:6px"><input id="mv_semantico_btn" type="button" class="menu_button" value="📊 Gerar análise agora"></div><div id="mv_status_semantico" style="font-size:0.82em;color:#aaa">aguardando...</div><hr style="border-color:#222;margin:4px 0"><div style="font-size:0.75em;text-transform:uppercase;color:#b58a5a;letter-spacing:1px">🧠 Camada 3 — Reconsolidação</div><div style="display:flex;gap:6px"><input id="mv_reconsolidacao_btn" type="button" class="menu_button" value="📊 Gerar reconsolidação"></div><div id="mv_status_reconsolidacao" style="font-size:0.82em;color:#aaa">aguardando...</div><hr style="border-color:#222;margin:4px 0"><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#e8a0a0"><input type="checkbox" id="mv_injetar_rp" ${injetarNoRP ? 'checked' : ''}> Injetar no RP (resumos + semântico)</label><div id="mv_status" style="font-size:0.82em;color:#aaa">pronto</div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Últimos Gists</div><div id="mv_lista" style="max-height:200px;overflow-y:auto"><div style="color:#555;font-size:0.78em">configure o token GitHub</div></div></div></div>`);

    $('#mv_prompt').val(mentePrompt);
    $('#mv_save').on('click', () => {
        apiKey = $('#mv_api_key').val().trim(); ghToken = $('#mv_gh_token').val().trim();
        menteModel = $('#mv_model').val().trim() || 'glm-5.1'; menteInterval = parseInt($('#mv_interval').val()) || 50;
        menteAtiva = $('#mv_ativa').prop('checked'); mentePrompt = $('#mv_prompt').val().trim() || defaultResumoPrompt();
        injetarNoRP = $('#mv_injetar_rp').prop('checked');
        semanticoModel = $('#mv_model_semantico').val().trim() || 'glm-5.1';
        semanticoIntervalo = parseInt($('#mv_semantico_intervalo').val()) || 3;
        semanticoIntervaloReconsolidacao = parseInt($('#mv_semantico_intervalo_reconsolidacao').val()) || 3;
        semanticoAtivo = $('#mv_semantico_ativa').prop('checked');
        localStorage.setItem(LS, JSON.stringify({ apiKey, ghToken, menteModel, menteInterval, menteAtiva, mentePrompt, injetarNoRP, semanticoModel, semanticoIntervalo, semanticoIntervaloReconsolidacao, semanticoAtivo, ultimoSemantico, ultimoReconsolidacao }));
        $('#mv_status').text('✓ salvo'); carregarListaNaUI();
    });
    $('#mv_now').on('click', () => { mentePrompt = $('#mv_prompt').val().trim() || defaultResumoPrompt(); ultimoProcessamento = Math.max(0, (getContext().chat?.length||0) - menteInterval); processarBloco(); });
    $('#mv_bloco_btn').on('click', () => { const n = parseInt($('#mv_bloco_num').val()) || 1; if (n < 1) { $('#mv_status').text('✕ número inválido'); return; } mentePrompt = $('#mv_prompt').val().trim() || defaultResumoPrompt(); processarBlocoEspecifico(n); });
    $('#mv_salvar_tudo').on('click', () => { mentePrompt = $('#mv_prompt').val().trim() || defaultResumoPrompt(); salvarTudo(); });
    $('#mv_semantico_btn').on('click', () => gerarAnaliseSemantica(true));
    $('#mv_reconsolidacao_btn').on('click', () => gerarReconsolidacao(true));
    $('#mv_injetar_rp').on('change', async () => {
        injetarNoRP = $('#mv_injetar_rp').prop('checked');
        const config = JSON.parse(localStorage.getItem(LS) || '{}'); config.injetarNoRP = injetarNoRP; localStorage.setItem(LS, JSON.stringify(config));
        if (!injetarNoRP) { setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1); $('#mv_status').text('⚠ injeção DESLIGADA'); }
        else { $('#mv_status').text('⟳ compilando Gists...'); await injetarEstado(); carregarListaNaUI(); $('#mv_status').text(`⚠ injeção LIGADA — ${resumosCache.length} Gists`); }
    });
}

function syncUltimoProcessamento() { ultimoProcessamento = getContext().chat?.length || 0; }
eventSource.on(event_types.APP_READY, () => { syncUltimoProcessamento(); carregarListaNaUI(); });
eventSource.on(event_types.CHAT_CHANGED, () => { syncUltimoProcessamento(); carregarListaNaUI(); });
eventSource.on(event_types.MESSAGE_RECEIVED, () => {
    const total = getContext().chat?.length || 0;
    if (total - ultimoProcessamento >= menteInterval) { ultimoProcessamento = total; processarBloco(); }
});

setTimeout(injectUI, 3000);
console.log('[Mnemosyne] Módulo carregado — v0.8.0 (Camada 1 + Camada 2 + Camada 3)');
