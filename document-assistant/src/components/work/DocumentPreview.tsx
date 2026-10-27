"use client";
import type { Block } from "@/lib/blocks";

function withMissing(text: string) {
  const parts = text.split(/(\[MISSING:[^\]]*\])/g);
  return parts.map((p, i) =>
    p.startsWith("[MISSING:") ? (
      <mark key={i} className="missing">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** On-screen rendering of the same content blocks used for the Word and PDF files. */
export function DocumentPreview({ blocks, banner, firmName, onRef }: { blocks: Block[]; banner?: string; firmName: string; onRef?: (factId: string) => void }) {
  return (
    <article className="doc-preview" aria-label="Document preview">
      {banner ? <div className="dp-banner">{banner}</div> : null}
      <div className="dp-firm">{firmName}</div>
      <hr className="dp-rule" />
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 1 ? (
              <h3 key={i} className="dp-title">
                {b.text}
              </h3>
            ) : (
              <h4 key={i}>{b.text}</h4>
            );
          case "paragraph":
            return (
              <p key={i} className={b.align === "center" ? "center" : b.align === "left" ? "left" : undefined} style={{ fontWeight: b.bold ? 700 : undefined, paddingLeft: b.indent ? b.indent : undefined }}>
                {withMissing(b.text)}
                {b.edited ? <span className="edited-mark">(edited by staff)</span> : null}
                {b.refs?.length && onRef ? (
                  <span className="refs" aria-label="Sources">
                    {b.refs.slice(0, 6).map((r) => (
                      <button key={r} type="button" onClick={() => onRef(r)} title={`Show source ${r}`}>
                        {r}
                      </button>
                    ))}
                  </span>
                ) : null}
              </p>
            );
          case "keyvalue":
            return (
              <dl key={i} className="dp-kv">
                {b.rows.map(([k, v], j) => (
                  <div key={j} style={{ display: "contents" }}>
                    <dt>{k}</dt>
                    <dd>{withMissing(v)}</dd>
                  </div>
                ))}
              </dl>
            );
          case "table":
            return (
              <table key={i}>
                <thead>
                  <tr>
                    {b.columns.map((c, j) => (
                      <th key={j} className={c.align === "right" ? "r" : undefined} scope="col">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className={b.boldLastRow && j === b.rows.length - 1 ? "total" : undefined}>
                      {r.map((v, k) => (
                        <td key={k} className={b.columns[k]?.align === "right" ? "r" : undefined}>
                          {withMissing(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "spacer":
            return <div key={i} style={{ height: b.height * 2 }} aria-hidden="true" />;
          case "rule":
            return <hr key={i} />;
          case "pagebreak":
            return <hr key={i} style={{ borderStyle: "dashed", margin: "28px 0" }} aria-label="Page break" />;
        }
      })}
    </article>
  );
}
