// ============================================
// MNEMOSYNE
// Módulo de Memória — Camada 1 (Episódica + Somática)
// v0.3.0 — Toggle compila TODOS os resumos acumulados
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
let menteModel    = saved.menteModel    || 'deepseek-v3.2';
let menteInterval = saved.menteInterval || 50;
let menteAtiva    = saved.menteAtiva !== undefined ? saved.menteAtiva : true;
let mentePrompt   = saved.mentePrompt   || defaultPrompt();
let injetarNoRP   = false;

let ultimoProcessamento = 0;
let running = false;

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

const lfScript = document.createElement('script');
lfScript.src = 'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js';
document.head.appendChild(lfScript);

let db;
lfScript.onload = () => {
    try {
        db = localforage.createInstance({ name: 'mnemosyne-hanna', storeName: 'memorias' });
        console.log('[Mnemosyne] Banco IndexedDB inicializado');
        carregarMemoriasNaUI();
    } catch(e) { console.error('[Mnemosyne] Falha no banco:', e); }
};

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
    if (!apiKey) { $('#mente_status').text('✕ sem API Key'); return null; }
    const prompt = construirPrompt(ctx);
    try {
        const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: menteModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.4 })
        });
        if (!res.ok) { $('#mente_status').text(`✕ HTTP ${res.status}`); return null; }
        const data = await res.json();
        const text = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!text) { $('#mente_status').text('✕ API retornou vazio'); return null; }
        if (/nada|vazio|irrelevante/i.test(text) && text.length < 30) { $('#mente_status').text(`— ${text.substring(0,60)}`); return null; }
        return text;
    } catch(e) { $('#mente_status').text(`✕ ${e.message.substring(0,40)}`); return null; }
}

async function salvarMemoria(resumo, numeroBloco) {
    if (!db) return;
    await db.setItem(crypto.randomUUID(), {
        tipo: 'resumo', evento: resumo, bloco: numeroBloco, mensagens: ultimoProcessamento,
        timestamp: new Date().toISOString(), tags: extrairTags(resumo), intensidade: 5,
        externalizada: false, peso: 1.0, ultimoAcesso: null, suprimida: false,
        expectativaQuebrada: false, conexoes: [], interferencia: null
    });
    console.log(`[Mnemosyne] Resumo do bloco ${numeroBloco} salvo`);
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

async function carregarTodasMemorias() {
    if (!db) return [];
    const memorias = [];
    await db.iterate((value) => { memorias.push(value); });
    memorias.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return memorias;
}

function extrairEstado(texto) {
    const estado = { vulnerabilidade: 0, testeLimite: false, contencao: 0 };
    if (/vulner[áa]vel|expost[ao]|abriu|confess|admitiu/i.test(texto)) estado.vulnerabilidade = 7;
    if (/desafi|insubordin|testou|provoc/i.test(texto)) estado.testeLimite = true;
    if (/cont[ée]m|recuou|fechou|sil[êe]ncio|controle/i.test(texto)) estado.contencao = 1;
    if (/mais aberta|cedeu|relaxou|expans|sorriu/i.test(texto)) estado.contencao = 0;
    return estado;
}

async function atualizarMenteEstado(resumo) {
    const ctx = getContext();
    if (!ctx.chatMetadata) return;

    const estado = extrairEstado(resumo);
    ctx.chatMetadata['mnemosyne_estado'] = estado;
    saveMetadataDebounced();

    if (!injetarNoRP) {
        setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
        return;
    }

    const todasMemorias = await carregarTodasMemorias();
    const resumos = todasMemorias.filter(m => m.tipo === 'resumo');

    if (resumos.length === 0) {
        setExtensionPrompt('MNEMOSYNE_ESTADO', '', 1, 1);
        return;
    }

    const textoCompleto = resumos.slice(0, 10).map(r => `[Bloco ${r.bloco}]: ${r.evento}`).join('\n\n');
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
}

async function processarBloco() {
    if (!menteAtiva || !apiKey || running) return;
    running = true;
    try {
        const ctx = getContext();
        if (!ctx.chat?.length) { $('#mente_status').text('— chat vazio'); return; }
        const blocoAtual = Math.floor(ctx.chat.length / menteInterval);
        $('#mente_status').text(`⟳ resumindo bloco ${blocoAtual}...`);
        const resumo = await extrairResumo(ctx);
        if (!resumo) { if ($('#mente_status').text().includes('resumindo')) $('#mente_status').text('— nada relevante'); return; }
        await salvarMemoria(resumo, blocoAtual);
        await atualizarMenteEstado(resumo);
        carregarMemoriasNaUI();
        $('#mente_status').text(`✓ bloco ${blocoAtual} resumido`);
    } catch(e) { $('#mente_status').text(`✕ ${e.message.substring(0,50)}`); }
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
        if (inicio >= totalMsgs) { $('#mente_status').text(`✕ bloco ${numeroBloco} não existe`); return; }
        const memorias = await carregarTodasMemorias();
        const existente = memorias.find(m => m.bloco === numeroBloco && m.tipo === 'resumo');
        if (existente) { await db.removeItem(existente.id); }
        $('#mente_status').text(`⟳ resumindo bloco ${numeroBloco}...`);
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
        if (!res.ok) { $('#mente_status').text(`✕ HTTP ${res.status}`); return; }
        const data = await res.json();
        const texto = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
        if (!texto) { $('#mente_status').text('✕ API retornou vazio'); return; }
        await db.setItem(crypto.randomUUID(), {
            tipo: 'resumo', evento: texto, bloco: numeroBloco, mensagens: fim,
            timestamp: new Date().toISOString(), tags: extrairTags(texto), intensidade: 5,
            externalizada: false, peso: 1.0, ultimoAcesso: null, suprimida: false,
            expectativaQuebrada: false, conexoes: [], interferencia: null
        });
        await atualizarMenteEstado(texto);
        carregarMemoriasNaUI();
        $('#mente_status').text(`✓ bloco ${numeroBloco} resumido`);
    } catch(e) { $('#mente_status').text(`✕ ${e.message.substring(0,50)}`); }
    finally { running = false; }
}

function carregarMemoriasNaUI() {
    carregarTodasMemorias().then(memorias => {
        const lista = memorias.slice(0, 5).map(m => {
            const icone = m.tipo === 'resumo' ? '📝' : '📋';
            const data = new Date(m.timestamp);
            const hora = `${String(data.getHours()).padStart(2,'0')}:${String(data.getMinutes()).padStart(2,'0')}`;
            const blocoInfo = m.bloco !== undefined ? ` · Bloco ${m.bloco}` : '';
            return `<div style="font-size:0.78em;color:#888;margin:2px 0;padding:3px 0;border-bottom:1px solid #222">${icone} <b>${m.tipo}</b>${blocoInfo} · ${hora}<br>${m.evento?.substring(0, 100)}${(m.evento?.length > 100) ? '...' : ''}${m.tags?.length ? '<br><span style="color:#666;font-size:0.85em">🏷 ' + m.tags.join(', ') + '</span>' : ''}</div>`;
        }).join('');
        $('#mente_memorias').html(lista || '<div style="color:#555;font-size:0.78em">nenhum resumo ainda</div>');
        $('#mente_contador').text(memorias.length);
    });
}

function injectUI() {
    const $t = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!$t.length) { setTimeout(injectUI, 1000); return; }
    $t.append(`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧠 Mnemosyne</b> <span style="font-size:0.7em;color:#555">v0.3.0</span><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display:flex;flex-direction:column;gap:8px;padding:8px 0"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:2em;font-weight:bold;color:#8b7355" id="mente_contador">0</span><span style="font-size:0.8em;color:#666">resumos</span></div><input id="mente_api_key" type="password" class="text_pole" value="${apiKey}" placeholder="API Key NanoGPT"><input id="mente_model" type="text" class="text_pole" value="${menteModel}" placeholder="Modelo"><input id="mente_interval" type="number" class="text_pole" value="${menteInterval}" min="10" max="200" placeholder="Mensagens por bloco"><label style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Prompt de Resumo (editável)</label><textarea id="mente_prompt" class="text_pole" rows="6" style="resize:vertical;font-size:0.78em">${mentePrompt}</textarea><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#aaa"><input type="checkbox" id="mente_ativa" ${menteAtiva ? 'checked' : ''}> Módulo ativo</label><label style="display:flex;align-items:center;gap:8px;font-size:0.85em;color:#e8a0a0"><input type="checkbox" id="mente_injetar_rp"> Injetar estado no RP (vê tudo acumulado)</label><div style="display:flex;gap:6px"><input id="mente_save" type="button" class="menu_button" value="💾 Salvar"><input id="mente_now" type="button" class="menu_button" value="↺ Resumir agora"></div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Bloco específico</div><div style="display:flex;gap:6px;align-items:center"><span style="font-size:0.85em;color:#aaa">Bloco #</span><input id="mente_bloco_num" type="number" class="text_pole" value="1" min="1" style="width:70px"><input id="mente_bloco_btn" type="button" class="menu_button" value="📝 Resumir bloco"></div><div id="mente_status" style="font-size:0.82em;color:#aaa">pronto</div><div style="font-size:0.75em;text-transform:uppercase;color:#666;letter-spacing:1px;margin-top:4px">Últimos resumos</div><div id="mente_memorias" style="max-height:200px;overflow-y:auto"><div style="color:#555;font-size:0.78em">carregando...</div></div></div></div>`);
    $('#mente_prompt').val(mentePrompt);
    $('#mente_save').on('click', () => {
        apiKey=$('#mente_api_key').val().trim(); menteModel=$('#mente_model').val().trim()||'deepseek-v3.2';
        menteInterval=parseInt($('#mente_interval').val())||50; menteAtiva=$('#mente_ativa').prop('checked');
        mentePrompt=$('#mente_prompt').val().trim()||defaultPrompt();
        localStorage.setItem(LS, JSON.stringify({ apiKey, menteModel, menteInterval, menteAtiva, mentePrompt }));
        $('# mente_status').text('✓ salvo');
    });
    $('#mente_now').on('click', () => {
        mentePrompt=$('#mente_prompt').val().trim()||defaultPrompt();
        ultimoProcessamento=Math.max(0, (getContext().chat?.length||0)-menteInterval);
        processarBloco();
    });
    $('#mente_bloco_btn').on('click', () => {
        const n=parseInt($('#mente_bloco_num').val())||1;
        if(n<1){$('#mente_status').text('✕ número inválido');return;}
        mentePrompt=$('#mente_prompt').val().trim()||defaultPrompt();
        processarBlocoEspecifico(n);
    });
    $('#mente_injetar_rp').on('change', async () => {
        injetarNoRP=$('#mente_injetar_rp').prop('checked');
        if(!injetarNoRP){
            setExtensionPrompt('MNEMOSYNE_ESTADO','',1,1);
            $('#mente_status').text('⚠ injeção DESLIGADA');
        } else {
            $('#mente_status').text('⟳ compilando memórias...');
            const todasMemorias = await carregarTodasMemorias();
            const resumos = todasMemorias.filter(m => m.tipo === 'resumo');
            if (resumos.length > 0) {
                const textoCompleto = resumos.slice(0, 10).map(r => `[Bloco ${r.bloco}]: ${r.evento}`).join('\n\n');
                await atualizarMenteEstado(textoCompleto);
                $('#mente_status').text(`⚠ injeção LIGADA — ${resumos.length} resumos visíveis`);
            } else {
                $('#mente_status').text('⚠ injeção LIGADA — sem resumos ainda');
            }
        }
    });
}

function syncUltimoProcessamento() { ultimoProcessamento = getContext().chat?.length || 0; }
eventSource.on(event_types.APP_READY, syncUltimoProcessamento);
eventSource.on(event_types.CHAT_CHANGED, syncUltimoProcessamento);
eventSource.on(event_types.MESSAGE_RECEIVED, () => {
    const total = getContext().chat?.length || 0;
    if (total - ultimoProcessamento >= menteInterval) { ultimoProcessamento = total; processarBloco(); }
});
setTimeout(injectUI, 3000);
console.log('[Mnemosyne] Módulo carregado — v0.3.0');
