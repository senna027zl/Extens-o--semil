cat > ~/SillyTavern/data/default-user/extensions/mnemosyne/index.js << 'FIM'
import { eventSource, event_types } from '../../../../public/scripts/script.js';

function injectUI() {
    const $t = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    console.log('[Mnemosyne] injectUI chamado. $t.length =', $t.length);
    if (!$t.length) {
        console.log('[Mnemosyne] Elemento não encontrado! Tentando novamente em 2s...');
        setTimeout(injectUI, 2000);
        return;
    }
    $t.append('<div style="background:#8b7355;color:#fff;padding:10px;margin:5px 0;border-radius:4px;font-weight:bold">🧠 Mnemosyne — Teste de UI injetado!</div>');
    console.log('[Mnemosyne] UI injetada com sucesso!');
}

eventSource.on(event_types.APP_READY, () => {
    console.log('[Mnemosyne] APP_READY — chamando injectUI');
    setTimeout(injectUI, 3000);
});

console.log('[Mnemosyne] Extensão carregada, aguardando APP_READY...');
FIM
