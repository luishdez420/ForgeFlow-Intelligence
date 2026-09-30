"use client";

import { FormEvent, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type Task = {
  id: string;
  kind: string;
  state: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
};
type Workflow = { id: string; ticker: string; state: string; tasks: Task[] };
type Report = {
  items: {
    id: string;
    kind: string;
    section: string;
    title: string;
    content: string;
    sources: { sourceId: string; provider: string; url: string }[];
  }[];
};

export function AnalystConsole({ analystEmail }: { analystEmail: string }) {
  const [ticker, setTicker] = useState("");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState(
    "Submit a US ticker to create a durable research run.",
  );
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setReport(null);
    setMessage("Creating persisted workflow…");
    try {
      const created = await fetch(`${apiBase}/workflows/company-analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (!created.ok) throw new Error("Use a valid US ticker and try again.");
      const { workflowId } = await created.json();
      const detail = await fetch(`${apiBase}/workflows/${workflowId}`);
      if (!detail.ok)
        throw new Error("Workflow was created but could not be loaded.");
      const next = (await detail.json()) as Workflow;
      setWorkflow(next);
      setMessage(
        `Workflow ${workflowId.slice(0, 8)} is ${next.state.toLowerCase()}.`,
      );
      const reportResponse = await fetch(`${apiBase}/reports/${workflowId}`);
      if (reportResponse.ok) setReport((await reportResponse.json()) as Report);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create workflow.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <main>
      <header>
        <span className="mark">FF</span>
        <div>
          <h1>ForgeFlow Intelligence</h1>
          <p>Evidence-backed company research for the analyst desk.</p>
          <small>Signed in as {analystEmail}</small>
        </div>
      </header>
      <section className="launch" aria-labelledby="launch-title">
        <div>
          <h2 id="launch-title">Start a company analysis</h2>
          <p>
            ForgeFlow records each retrieval, calculation, and report source so
            the final narrative stays auditable.
          </p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="ticker">US ticker</label>
          <div className="entry">
            <input
              id="ticker"
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder="MSFT"
              maxLength={10}
              required
            />
            <button disabled={loading}>
              {loading ? "Creating…" : "Run analysis"}
            </button>
          </div>
        </form>
      </section>
      <p className="status" role="status">
        {message}
      </p>
      {workflow && (
        <section className="workflow" aria-labelledby="workflow-title">
          <div className="section-heading">
            <h2 id="workflow-title">{workflow.ticker} workflow</h2>
            <span className="state">{workflow.state}</span>
          </div>
          <ol>
            {workflow.tasks.map((task) => (
              <li key={task.id}>
                <span className="task-name">
                  {task.kind.replaceAll("_", " ")}
                </span>
                <span>{task.state}</span>
                <small>
                  Attempt {task.attemptCount}/{task.maxAttempts}
                  {task.lastErrorCode ? ` · ${task.lastErrorCode}` : ""}
                </small>
              </li>
            ))}
          </ol>
        </section>
      )}
      {report && (
        <section className="report" aria-labelledby="report-title">
          <h2 id="report-title">Persisted report</h2>
          {report.items.map((item) => (
            <article key={item.id}>
              <span className={`kind ${item.kind.toLowerCase()}`}>
                {item.kind.replace("_", " ")}
              </span>
              <h3>{item.title}</h3>
              <p>{item.content}</p>
              <div className="sources">
                {item.sources.map((source) => (
                  <a
                    key={source.sourceId}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.provider} source
                  </a>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
