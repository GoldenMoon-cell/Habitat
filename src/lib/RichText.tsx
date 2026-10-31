import type { ReactNode } from "react";

/**
 * 迷你 Markdown 渲染器。
 * 只支持原型需要的一小撮语法，输出 React 节点（不使用 innerHTML）。
 *   ```代码块```  `行内代码`  **粗体**  *斜体*  > 引用  - 列表
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // 顺序敏感：先切 code，再 bold，再 italic
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const k = `${keyBase}-i${i++}`;

    if (token.startsWith("`")) {
      out.push(
        <code
          key={k}
          className="mx-[1px] rounded-[4px] border border-biolum/20 bg-biolum/[0.08] px-[5px] py-[1px] font-mono text-[11.5px] text-biolum/95"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={k} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(
        <em key={k} className="italic text-ink/80">
          {token.slice(1, -1)}
        </em>
      );
    }
    last = m.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];

  let para: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={`p${blocks.length}`} className="whitespace-pre-wrap">
        {inline(para.join("\n"), `p${blocks.length}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const k = blocks.length;
    blocks.push(
      <ul key={`ul${k}`} className="my-1 space-y-[3px]">
        {list.map((li, idx) => (
          <li key={idx} className="flex gap-[7px] leading-[1.6]">
            <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-current opacity-45" />
            <span>{inline(li, `l${k}-${idx}`)}</span>
          </li>
        ))}
      </ul>
    );
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const k = blocks.length;
    blocks.push(
      <blockquote
        key={`q${k}`}
        className="my-1.5 border-l border-current/35 pl-3 text-[12.5px] italic opacity-80"
      >
        {inline(quote.join(" "), `q${k}`)}
      </blockquote>
    );
    quote = [];
  };

  for (const raw of lines) {
    if (code) {
      if (raw.trimStart().startsWith("```")) {
        const k = blocks.length;
        blocks.push(
          <pre
            key={`c${k}`}
            className="my-2 overflow-x-auto rounded-lg border border-biolum/15 bg-black/45 px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-[#9fe8d6]"
          >
            <code>{code.join("\n")}</code>
          </pre>
        );
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }

    if (raw.trimStart().startsWith("```")) {
      flushPara();
      flushList();
      flushQuote();
      code = [];
      continue;
    }

    if (!raw.trim()) {
      flushPara();
      flushList();
      flushQuote();
      continue;
    }

    if (raw.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(raw.slice(2));
      continue;
    }

    if (/^\s*[-*]\s+/.test(raw)) {
      flushPara();
      flushQuote();
      list.push(raw.replace(/^\s*[-*]\s+/, ""));
      continue;
    }

    flushList();
    flushQuote();
    para.push(raw);
  }

  flushPara();
  flushList();
  flushQuote();

  if (code) {
    blocks.push(
      <pre
        key="c-tail"
        className="my-2 overflow-x-auto rounded-lg border border-biolum/15 bg-black/45 px-3 py-2.5 font-mono text-[11.5px]"
      >
        <code>{code.join("\n")}</code>
      </pre>
    );
  }

  return <div className="space-y-1.5 text-[13px] leading-[1.72]">{blocks}</div>;
}
