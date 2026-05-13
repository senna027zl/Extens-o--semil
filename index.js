// ============================================================
// Hannacore v2.0 — VERSÃO DE DIAGNÓSTICO
// ============================================================
const EXT_NAME = "Hannacore";

// Teste 1: jQuery disponível?
console.log("[Hannacore] Iniciando... jQuery disponível:", typeof jQuery !== "undefined");

// Teste 2: onDocumentReady?
if (typeof jQuery === "undefined") {
    console.error("[Hannacore] ERRO CRÍTICO: jQuery não encontrado!");
} else {
    jQuery(() => {
        console.log("[Hannacore] DOM pronto. SillyTavern:", typeof SillyTavern !== "undefined");

        // Teste 3: Registrar extensão mínima
        try {
            const context = SillyTavern.getContext();
            console.log("[Hannacore] Contexto obtido:", context ? "sim" : "não");

            context.registerExtension(EXT_NAME, {
                type: "extension",
                slashCommand: async (command) => {
                    console.log("[Hannacore] Comando recebido:", command);
                    const parts = command.trim().split(/\s+/);
                    const cmd = parts[0]?.toLowerCase();
                    const args = parts.slice(1).join(" ");

                    if (cmd === "/hc-test") {
                        return "✅ Hannacore está funcionando! Comando recebido.";
                    }
                    if (cmd === "/hc-config") {
                        if (!args) return "⚙️ Use: /hc-config githubtoken SEU_TOKEN ou gistid SEU_ID ou deepseekapikey SUA_KEY";
                        const [key, ...rest] = args.split(" ");
                        const val = rest.join(" ");
                        if (key === "githubtoken") {
                            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
                            extension_settings[EXT_NAME].githubToken = val;
                            saveSettingsDebounced();
                            return "✅ GitHub Token salvo (teste).";
                        }
                        if (key === "gistid") {
                            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
                            extension_settings[EXT_NAME].gistId = val;
                            saveSettingsDebounced();
                            return "✅ Gist ID salvo (teste).";
                        }
                        if (key === "deepseekapikey") {
                            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
                            extension_settings[EXT_NAME].deepseekApiKey = val;
                            saveSettingsDebounced();
                            return "✅ DeepSeek API Key salvo (teste).";
                        }
                    }
                    return null;
                }
            });

            // Teste 4: Criar botão flutuante de teste
            const btn = document.createElement("button");
            btn.textContent = "⚙️ TEST";
            btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:99999;background:red;color:white;border:none;padding:12px;border-radius:50%;width:56px;height:56px;font-size:14px;cursor:pointer;";
            btn.onclick = () => {
                alert("Hannacore: botão funcionando!\n\nUse /hc-test para testar comandos.\nUse /hc-config para configurar.");
            };
            document.body.appendChild(btn);

            console.log("[Hannacore] ✅ REGISTRADO COM SUCESSO! Botão vermelho deve aparecer.");
            console.log("[Hannacore] Comandos: /hc-test e /hc-config");
            toastr?.info?.("Hannacore instalado — veja o console (F12)");
        } catch (e) {
            console.error("[Hannacore] ERRO NO REGISTRO:", e);
        }
    });
}
