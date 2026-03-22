import React, { useState, useEffect } from "react";
import { Send, Settings, Shield, Bell, CheckCircle2, AlertCircle, ExternalLink, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Config {
  telegramToken: string;
  chatId: string;
  enabled: boolean;
}

export default function App() {
  const [config, setConfig] = useState<Config>({
    telegramToken: "",
    chatId: "",
    enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [wsUrl, setWsUrl] = useState("");

  useEffect(() => {
    setWsUrl(`wss://${window.location.host}`);
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setStatus({ type: 'success', message: 'Configuration saved successfully!' });
      } else {
        setStatus({ type: 'error', message: 'Failed to save configuration.' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'An error occurred while saving.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white font-mono">
        <motion.div 
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          INITIALIZING BRIDGE...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/10 p-6 flex items-center justify-between bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Send className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">SillyTavern Bridge</h1>
            <p className="text-xs text-emerald-500/70 font-mono uppercase tracking-widest">Telegram Forwarder</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter border ${config.enabled ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10' : 'border-red-500/50 text-red-500 bg-red-500/10'}`}>
            {config.enabled ? 'Active' : 'Disabled'}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Instructions */}
        <div className="md:col-span-1 space-y-6">
          <section className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Shield className="w-4 h-4" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Setup Guide</h2>
            </div>
            <ol className="text-sm space-y-4 text-white/60 list-decimal list-inside">
              <li>Create a bot via <a href="https://t.me/BotFather" target="_blank" className="text-emerald-400 hover:underline inline-flex items-center gap-1">@BotFather <ExternalLink className="w-3 h-3" /></a></li>
              <li>Get your Chat ID (use <a href="https://t.me/userinfobot" target="_blank" className="text-emerald-400 hover:underline inline-flex items-center gap-1">@userinfobot <ExternalLink className="w-3 h-3" /></a>)</li>
              <li>Push this project to a <strong>GitHub repository</strong>.</li>
              <li>In SillyTavern, click the <strong>Extensions</strong> icon (the block icon at the top).</li>
              <li>Click <strong>Install Extension</strong> and paste your GitHub repository URL.</li>
              <li>In the SillyTavern extension settings, set the Bridge URL to:<br/><code className="bg-black/50 px-2 py-1 rounded text-emerald-400 text-xs mt-2 block break-all">{wsUrl}</code></li>
            </ol>
          </section>

          <section className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <Bell className="w-4 h-4" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Status</h2>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Server Status</span>
                <span className="text-emerald-400 font-mono">ONLINE</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Bot Connection</span>
                <span className={config.telegramToken ? "text-emerald-400 font-mono" : "text-red-400 font-mono"}>
                  {config.telegramToken ? "READY" : "MISSING TOKEN"}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Configuration Form */}
        <div className="md:col-span-2 space-y-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-8">
              <Settings className="w-6 h-6 text-emerald-500" />
              <h2 className="text-2xl font-bold text-white">Bridge Configuration</h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-white/40 ml-1">Telegram Bot Token</label>
                <input
                  type="password"
                  value={config.telegramToken}
                  onChange={(e) => setConfig({ ...config, telegramToken: e.target.value })}
                  placeholder="0000000000:AAH..."
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-white/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-white/40 ml-1">Default Telegram Chat ID</label>
                <input
                  type="text"
                  value={config.chatId}
                  onChange={(e) => setConfig({ ...config, chatId: e.target.value })}
                  placeholder="e.g. 123456789"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-white/10"
                />
                <p className="text-[10px] text-white/30 ml-1 italic">Messages initiated from SillyTavern will be sent here.</p>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setConfig({ ...config, enabled: !config.enabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${config.enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm font-medium text-white/80">Enable Forwarding</span>
              </div>

              <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                <AnimatePresence mode="wait">
                  {status && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className={`flex items-center gap-2 text-sm ${status.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {status.message}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  onClick={saveConfig}
                  disabled={saving}
                  className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 text-black font-bold px-8 py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  {saving ? "SAVING..." : "SAVE CHANGES"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <footer className="max-w-4xl mx-auto p-8 text-center text-white/20 text-[10px] uppercase tracking-[0.2em]">
        SillyTavern Node.js Bridge &copy; 2026 // Built for AI Studio
      </footer>
    </div>
  );
}
