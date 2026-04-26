// ============================================
// MNEMOSYNE v0.6.0
// Resumos como Gists privados no GitHub
// ============================================

import { getContext, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, setExtensionPrompt } from '../../../../script.js';

const LS = 'mnemosyne-settings';
let saved = {};
try {
    const raw = localStorage.getItem(LS);
    if (raw) saved = JSON.parse(raw);
} catch(e) { console.warn('[Mnemosyne] Config corrompida'); localStorage.removeItem(LS); }

let apiKey        = saved.apiKey        || '';
let ghToken       = saved.ghToken       || '';
let menteModel    = saved.menteModel    || 'deepseek-v3.2';
let menteInterval = saved.menteInterval || 50;
let menteAtiva    = saved.menteAtiva !== undefined ? saved.menteAtiva : true;
let mentePrompt   = saved.mentePrompt   || defaultPrompt();
let injetarNoRP   = saved.injetarNoRP !== undefined ? saved.injetarNoRP : false;

let ultimoProcessamento = 0;
let running = false;
let resumosCache = [];

function defaultPrompt() {
    return `Você é um analista de narrativa. Leia o bloco de mensagens deste roleplay entre Hanna (coordenadora, 32 anos, controladora, observadora, mãe ensinou que vulnerabilidade é brecha) e Senna (estagiário, 18 anos).

Produza um resumo denso em português com:
1. ARCO PRINCIPAL: O que aconteceu de mais importante neste bloco? Qual foi a evolução emocional ou de poder entre os dois?
2. MOMENTOS-CHAVE: 2-3 momentos específicos que definiram este bloco (eventos, diálogos, silêncios)
3. ESTADO DA HANNA: Como ela está no final deste bloco? Mais aberta ou mais fechada? Mais no controle ou mais vulnerável?
4. PADRÕES: Algum padrão novo detectado no comportamento do Senna ou no dela mesma?
5. SINAL SOMÁTICO: Alguma reação corporal significativa da Hanna (contração, expansão, ausência)?

Formato: texto corrido, 3-5 parágrafos. Sem markdown, sem títulos.`;
}

// ==================== GITHUB GISTS ====================

async function criarGist(resumo, numeroBloco) {
    if (!ghToken) { console.warn('[Mnemosyne] Sem token GitHub'); return null; }
    try {
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ghToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
                description: `Mnemosyne — Bloco ${numeroBloco} — ${new Date().toLocaleDateString('pt-BR')}`,
                public: false,
                files: {
                    [`bloco-${String(numeroBloco).padStart(3,'0')}.md`]: { content: resumo }
                }
            })
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        console.log(`[Mnemosyne] Gist criado: ${data.html_url}`);
        return data;
    } catch(e) { console.error('[Mnemosyne] Erro ao criar Gist:', e); return null; }
}

async function listarGists() {
    if (!ghToken) { console.warn('[Mnemosyne] Sem token GitHub'); return []; }
    try {
        const res = await fetch('https://api.github.com/gists?per_page=50', {
            headers: {
                'Authorization': `Bearer ${ghToken}`,
                'Accept': 'application/vnd.github+json'
            }
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
                resultados.push({
                    id: gist.id,
                    bloco: extrairBloco(gist.description),
                    descricao: gist.description,
                    conteudo: texto,
                    data: gist.created_at,
                    url: gist.html_url
                });
            } catch(e) { console.warn('[Mnemosyne] Erro ao ler Gist:', e); }
        }
    }
    resultados.sort((a,b) => (a.bloco||0) - (b.bloco||0));
    return resultados;
}

function extrairBloco(descricao) {
    const match = descricao?.match(/Bloco (\d+)/);
    return match ? parseInt(match[1]) : null;
}

function extrairTags(texto) {
    const tags = [];
    if (/vulner[áa]vel|expost[ao]|confess/i.test(texto)) tags.push('vulnerabilidade');
    if (/insubordin|desafi|teste|limite/i.test(texto)) tags.push('insubordinacao');
    if (/afeto|carinho|preocupa|gentil|toque/i.test(texto)) tags.push('afeto');
    if (/control|sil[êe]ncio|recu[ou]|contid/i.test(texto)) tags.push('controle');
    if (/padr[ãa]o|repete|de novo/i.test(texto)) tags.push('teste');
    return tags;
}

// ==================== EXTRATOR DE RESUMO ====================

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
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
        });
        if (!res.ok) { $('#mv_status').text(`✕ HTTP ${res.status}`); return null; }
        const data = await res.json();
        const text = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!text) { $('#mv_status').text('✕ API retornou vazio'); return null; }
        return text;
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,40)}`); return null; }
}

// ==================== INJEÇÃO NO RP ====================

function extrairEstado(texto) {
    const estado = { vulnerabilidade: 0, testeLimite: false, contencao: 0 };
    if (/vulner[áa]vel|expost[ao]|abriu|confess|admitiu/i.test(texto)) estado.vulnerabilidade = 7;
    if (/desafi|insubordin|testou|provoc/i.test(texto)) estado.testeLimite = true;
    if (/cont[ée]m|recuou|fechou|sil[êe]ncio|controle/i.test(texto)) estado.contencao = 1;
    if (/mais aberta|cedeu|relaxou|expans|sorriu/i.test(texto)) estado.contencao = 0;
    return estado;
}

async function injetarEstado() {
    if (!injetarNoRP) {
        setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
        return;
    }

    const gists = await listarGists();
    const resumos = await lerConteudoGists(gists);
    resumosCache = resumos;

    if (resumos.length === 0) {
        setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
        return;
    }

    const textoCompleto = resumos.slice(-10).map(r => `[Bloco ${r.bloco}]: ${r.conteudo}`).join('\n\n');
    const estadoGeral = extrairEstado(textoCompleto);

    let instrucao = '';
    if (estadoGeral.vulnerabilidade >= 7) instrucao += 'histórico de vulnerabilidade — instinto de proteção ativo. ';
    if (estadoGeral.testeLimite) instrucao += 'padrão de teste de limites recorrente no histórico. ';
    if (estadoGeral.contencao >= 1) instrucao += 'tendência geral a contenção e silêncio. ';

    if (instrucao) {
        setExtensionPrompt('MNEMOSYNE_ESTADO', `[Memória acumulada: ${instrucao.trim()}]`, 1, 1);
    } else {
        setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
    }

    const ctx = getContext();
    if (ctx.chatMetadata) {
        ctx.chatMetadata['mnemosyne_estado'] = { resumos: resumos.length, ...estadoGeral };
        saveMetadataDebounced();
    }
}

// ==================== PROCESSAMENTO ====================

async function processarBloco() {
    if (!menteAtiva || !apiKey || running) return;
    running = true;
    try {
        const ctx = getContext();
        if (!ctx.chat?.length) { $('#mv_status').text('— chat vazio'); return; }
        const blocoAtual = Math.floor(ctx.chat.length / menteInterval);
        $('#mv_status').text(`⟳ resumindo bloco ${blocoAtual}...`);
        const resumo = await extrairResumo(ctx);
        if (!resumo) {
            if ($('#mv_status').text().includes('resumindo')) $('#mv_status').text('— nada relevante');
            return;
        }
        const gist = await criarGist(resumo, blocoAtual);
        if (gist) {
            $('#mv_status').text(`✓ bloco ${blocoAtual} salvo no GitHub`);
            await injetarEstado();
            carregarListaNaUI();
        } else {
            $('#mv_status').text('✕ falha ao salvar no GitHub');
        }
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
        const cena = msgs.map(m => {
            const nome = m.is_user ? 'Senna' : (m.name || 'Hanna');
            return `${nome}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`;
        }).join('\n');
        const prompt = `${mentePrompt}\n\nMENSAGENS DO BLOCO ${numeroBloco} (${inicio+1}-${fim}):\n${cena}`;
        const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
        });
        if (!res.ok) { $('#mv_status').text(`✕ HTTP ${res.status}`); return; }
        const data = await res.json();
        const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!texto) { $('#mv_status').text('✕ API retornou vazio'); return; }
        const gist = await criarGist(texto, numeroBloco);
        if (gist) {
            $('#mv_status').text(`✓ bloco ${numeroBloco} salvo no GitHub`);
            await injetarEstado();
            carregarListaNaUI();
        } else {
            $('#mv_status').text('✕ falha ao salvar no GitHub');
        }
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
            const cena = msgs.map(m => {
                const nome = m.is_user ? 'Senna' : (m.name || 'Hanna');
                return `${nome}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`;
            }).join('\n');
            const prompt = `${mentePrompt}\n\nMENSAGENS DO BLOCO ${bloco} (${inicio+1}-${fim}):\n${cena}`;
            try {
                const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
                });
                if (!res.ok) continue;
                const data = await res.json();
                const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
                if (!texto) continue;
                await criarGist(texto, bloco);
                criados++;
            } catch(e) { console.warn(`[Mnemosyne] Falha no bloco ${bloco}:`, e); }
        }
        $('#mv_status').text(`✓ ${criados}/${totalBlocos} blocos salvos no GitHub`);
        await injetarEstado();
        carregarListaNaUI();
    } catch(e) { $('#mv_status').text(`✕ ${e.message.substring(0,50)}`); }
    finally { running = false; }
}

// ==================== UI ====================

async function carregarListaNaUI() {
    if (!ghToken) {
        $('#mv_lista').html('<div style="color:#555;font-size:0.78em">configure o token GitHub</div>');
        $('#mv_contador').text('0');
        return;
    }
    try {
        const gists = await listarGists();
        const resumos = await lerConteudoGists(gists);
        resumosCache = resumos;
        const lista = resumos.slice(-5).reverse().map(r => {
            const data = new Date(r.data);
            const hora = `${String(data.getHours()).padStart(2,'0')}:${String(data.getMinutes()).padStart(2,'0')}`;
            const tags = extrairTags(r.conteudo);
            return `<div style="font-size:0.78em;color:#888;margin:2px 0;padding:3px 0;border-bottom:1px solid #222">
                📝 <b>Bloco ${r.bloco}</b> · ${hora}<br>
                ${r.conteudo?.substring(0, 100)}${(r.conteudo?.length > 100) ? '...' : ''}
                ${tags.length ? '<br><span style="color:#666;font-size:0.85em">🏷 ' + tags.join(', ') + '</span>' : ''}
            </div>`;
        }).join('');
        $('#mv_lista').html(lista || '<div style="color:#555;font-size:0.78em">nenhum Gist encontrado</div>');
        $('#mv_contador').text(resumos.length);
    } catch(e) {
        $('#mv_lista').html('<div style="color:#a55;font-size:0.78em">erro ao carregar</div>');
    }
}

function injectUI() {
    const $t = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!$t.length) { setTimeout(injectUI, 1000); return; }

    $t.append(`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧠 Mnemosyne</b> <span style="font-size:0.7em;color:#555">v0.6.0</span><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display:flex;flex-direction:column;gap:8px;padding:8px 0"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:2em;font-weight:bold;color:#8b7355" id="mv_contador">0</span><span style="font-size:0.8em;color:#666">Gists</span></div><input id="mv_api_key" type="password" class="text_pole" value="${apiKey}" placeholder="API Key NanoGPT"><input id="mv_gh_token" type="password" class="text_pole" value="${ghToken}" placeholder="Token GitHub (gist)"><input id="mv_model" type="text" class="text_pole" value="${menteModel}" placeholder="Modelo"><input id="mv_interval" type="number" class="text_pole" value="${menteInterval}" min="10" max="200" placeholder="Mensagens por bloco"><label style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Prompt de Resumo (editável)</label><textarea id="mv_prompt" class="text_pole" rows="6" style="resize:vertical;font-size:0.78em">${mentePrompt}</textarea><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#aaa"><input type="checkbox" id="mv_ativa" ${menteAtiva ? 'checked' : ''}> Módulo ativo</label><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#e8a0a0"><input type="checkbox" id="mv_injetar_rp" ${injetarNoRP ? 'checked' : ''}> Injetar estado no RP (lê Gists)</label><div style="display:flex;gap:6px;flex-wrap:wrap"><input id="mv_save" type="button" class="menu_button" value="💾 Salvar"><input id="mv_now" type="button" class="menu_button" value="↺ Resumir agora"><input id="mv_salvar_tudo" type="button" class="menu_button" value="📦 Salvar tudo"></div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Bloco específico</div><div style="display:flex;gap:6px;align-items:center"><span style="font-size:0.85em;color:#aaa">Bloco #</span><input id="mv_bloco_num" type="number" class="text_pole" value="1" min="1" style="width:70px"><input id="mv_bloco_btn" type="button" class="menu_button" value="📝 Resumir bloco"></div><div id="mv_status" style="font-size:0.82em;color:#aaa">pronto</div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Últimos Gists</div><div id="mv_lista" style="max-height:200px;overflow-y:auto"><div style="color:#555;font-size:0.78em">configure o token GitHub</div></div></div></div>`);

    $('#mv_prompt').val(mentePrompt);

    $('#mv_save').on('click', () => {
        apiKey        = $('#mv_api_key').val().trim();
        ghToken       = $('#mv_gh_token').val().trim();
        menteModel    = $('#mv_model').val().trim() || 'deepseek-v3.2';
        menteInterval = parseInt($('#mv_interval').val()) || 50;
        menteAtiva    = $('#mv_ativa').prop('checked');
        mentePrompt   = $('#mv_prompt').val().trim() || defaultPrompt();
        injetarNoRP   = $('#mv_injetar_rp').prop('checked');
        localStorage.setItem(LS, JSON.stringify({ apiKey, ghToken, menteModel, menteInterval, menteAtiva, mentePrompt, injetarNoRP }));
        $('#mv_status').text('✓ salvo (tudo)');
        carregarListaNaUI();
    });

    $('#mv_now').on('click', () => {
        mentePrompt = $('#mv_prompt').val().trim() || defaultPrompt();
        ultimoProcessamento = Math.max(0, (getContext().chat?.length||0) - menteInterval);
        processarBloco();
    });

    $('#mv_bloco_btn').on('click', () => {
        const n = parseInt($('#mv_bloco_num').val()) || 1;
        if (n < 1) { $('#mv_status').text('✕ número inválido'); return; }
        mentePrompt = $('#mv_prompt').val().trim() || defaultPrompt();
        processarBlocoEspecifico(n);
    });

    $('#mv_salvar_tudo').on('click', () => {
        mentePrompt = $('#mv_prompt').val().trim() || defaultPrompt();
        salvarTudo();
    });

    $('#mv_injetar_rp').on('change', async () => {
        injetarNoRP = $('#mv_injetar_rp').prop('checked');
        const config = JSON.parse(localStorage.getItem(LS) || '{}');
        config.injetarNoRP = injetarNoRP;
        localStorage.setItem(LS, JSON.stringify(config));
        if (!injetarNoRP) {
            setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
            $('#mv_status').text('⚠ injeção DESLIGADA');
        } else {
            $('#mv_status').text('⟳ compilando Gists...');
            await injetarEstado();
            carregarListaNaUI();
            $('#mv_status').text(`⚠ injeção LIGADA — ${resumosCache.length} Gists`);
        }
    });
}

function syncUltimoProcessamento() { ultimoProc
