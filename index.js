cat > ~/SillyTavern/data/default-user/extensions/mnemosyne/index.js << 'FIM'
import { eventSource, event_types } from '../../../../public/scripts/script.js';

console.log('[Mnemosyne] v0.6.0 — Carregado. Aguardando UI...');

// ===== INJEÇÃO POR POLLING =====
let tentativas = 0;
const MAX_TENTATIVAS = 30;

function tentarInjetarUI() {
    tentativas++;
    const $t = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    
    if ($t.length > 0) {
        console.log('[Mnemosyne] UI encontrada na tentativa', tentativas);
        $t.append('<div style="background:#8b7355;color:#fff;padding:12px;margin:8px 0;border-radius:6px;font-weight:bold;text-align:center">🧠 Mnemosyne v0.6.0 — Carregada!</div>');
        console.log('[Mnemosyne] UI injetada com sucesso!');
        return;
    }
    
    if (tentativas >= MAX_TENTATIVAS) {
        console.log('[Mnemosyne] UI NÃO encontrada após', MAX_TENTATIVAS, 'tentativas. Desistindo.');
        return;
    }
    
    setTimeout(tentarInjetarUI, 1000);
}

// ===== INÍCIO =====
setTimeout(tentarInjetarUI, 5000);

console.log('[Mnemosyne] Polling iniciado...');
FIM
