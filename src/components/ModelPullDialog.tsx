import { useState } from "react";
import { motion } from "motion/react";
import { useEscClose } from "../lib/escStack";
import { fetchModels, type RemoteModel } from "../lib/modelSource";

/**
 * 从 API 拉取真实模型列表。
 *
 * 为什么不让人手打模型名：
 *   打错了 → 请求 400，用户以为软件坏了。
 *   而且手打拿不到上下文长度，只能猜。
 *
 * 拉到列表后，服务商给了 context_length 就显示出来 —— 那是最权威的数字，
 * 比任何本地字典都准。
 */

const PRESET_BASES = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Ollama", url: "http://localhost:11434" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
];

export default function ModelPullDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: RemoteModel) => void;
}) {
  const [base, setBase] = useState("http://localhost:11434");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);

  useEscClose(open, onClose);

  const pull = async () => {
    setLoading(true);
    setErr(null);
    setModels([]);
    setEndpoint(null);

    const r = await fetchModels(base, key);
    setLoading(false);

    if (!r.ok) {
      setErr(`${r.error.message}`);
      return;
    }
    setModels(r.models);
    setEndpoint(r.endpoint);
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-abyss/88 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[80vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-[14px]"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="text-[12px] text-biolum/70">⇣</span>
          <span className="text-[12px] text-ink">从 API 拉取模型列表</span>
          <button
            onClick={onClose}
            className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] text-mist/55 transition-colors hover:bg-white/[0.07] hover:text-ink/75"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2.5 border-b border-white/[0.05] px-4 py-3">
          <label className="block">
            <span className="text-[10.5px] text-mist/45">Base URL</span>
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              className="mt-1 w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] font-mono text-[10px] text-ink/85 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_BASES.map((p) => (
              <button
                key={p.label}
                onClick={() => setBase(p.url)}
                className="rounded-[4px] border border-white/[0.07] px-1.5 py-[2px] font-mono text-[9.5px] text-mist/58 transition-colors hover:border-biolum/30 hover:text-biolum/80"
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[10.5px] text-mist/45">
              API Key <span className="text-mist/46">（本地 Ollama 不用填）</span>
            </span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
              placeholder="sk-..."
              spellCheck={false}
              className="mt-1 w-full rounded-[6px] border border-white/[0.08] bg-black/30 px-2.5 py-[6px] font-mono text-[10px] text-ink/85 placeholder:text-mist/42 focus:border-biolum/35 focus:outline-none"
            />
          </label>

          <button
            onClick={pull}
            disabled={loading}
            className="w-full rounded-[6px] py-[6px] text-[10px] transition-colors disabled:opacity-45"
            style={{
              background: "rgba(53,240,206,0.14)",
              color: "#35f0ce",
              boxShadow: "inset 0 0 0 1px rgba(53,240,206,0.28)",
            }}
          >
            {loading ? "正在拉取…" : "拉取"}
          </button>
        </div>

        {/* 结果 */}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
          {err && (
            <div className="rounded-[6px] border border-coral/25 bg-coral/[0.06] px-2.5 py-2">
              <div className="font-mono text-[10px] leading-[1.6] text-coral/80">{err}</div>
              <div className="mt-1 text-[9.5px] leading-[1.5] text-mist/50">
                拉不到就手动填模型名 —— 上下文上限会按名字推断，或者你自己指定。
              </div>
            </div>
          )}

          {!err && models.length === 0 && !loading && (
            <div className="py-6 text-center text-[10.5px] leading-[1.7] text-mist/48">
              填好端点后点「拉取」
              <br />
              本地 Ollama 可以直接拉，远程 API 在浏览器里会被 CORS 拦
            </div>
          )}

          {models.length > 0 && (
            <>
              <div className="mb-1.5 font-mono text-[9.5px] text-mist/50">
                {models.length} 个模型 · {endpoint}
              </div>
              <div className="space-y-1">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onPick(m);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] border border-white/[0.06] px-2.5 py-[6px] text-left transition-colors hover:border-biolum/30 hover:bg-biolum/[0.05]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10px] text-ink/80">
                        {m.id}
                      </span>
                      {m.ownedBy && (
                        <span className="block truncate text-[9.5px] text-mist/46">{m.ownedBy}</span>
                      )}
                    </span>
                    {m.contextWindow ? (
                      <span className="shrink-0 rounded-[3px] border border-biolum/25 px-1 py-[1px] font-mono text-[9.5px] text-biolum/75">
                        {(m.contextWindow / 1000).toFixed(0)}k
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono text-[9.5px] text-mist/42">ctx ?</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
