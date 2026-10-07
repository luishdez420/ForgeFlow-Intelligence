"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ValidationFinding = {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  dataStatus: "VALID" | "AMBIGUOUS" | "UNAVAILABLE" | "INVALID";
  message: string;
};
type Task = {
  id: string;
  kind: string;
  state: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
};
type Workflow = {
  id: string;
  ticker: string;
  state: string;
  tasks: Task[];
  validationFindings: ValidationFinding[];
};
type WorkflowHistoryItem = {
  id: string;
  ticker: string;
  state: string;
  createdAt: string;
};
type ReportItem = {
  id: string;
  kind: "FACT" | "CALCULATION" | "AI_ANALYSIS" | "UNAVAILABLE";
  title: string;
  content: string;
  calculationProvenance?: {
    formulaVersion: string;
    inputSnapshot: Record<string, unknown>;
    status: string;
    calculatedAt: string;
  };
  sources: {
    sourceId: string;
    provider: string;
    url: string;
    retrievedAt: string;
    documentSection?: string;
  }[];
};
type Report = { items: ReportItem[]; validationFindings: ValidationFinding[] };

const terminalStates = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const reportKinds: Array<ReportItem["kind"] | "ALL"> = [
  "ALL",
  "FACT",
  "CALCULATION",
  "AI_ANALYSIS",
  "UNAVAILABLE",
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AnalystConsole({ analystEmail }: { analystEmail: string }) {
  const [ticker, setTicker] = useState("");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [history, setHistory] = useState<WorkflowHistoryItem[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState(
    "Submit a US ticker to create a durable research run.",
  );
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<(typeof reportKinds)[number]>("ALL");

  const loadReport = useCallback(async (workflowId: string) => {
    const response = await fetch(`/api/reports/${workflowId}`, {
      cache: "no-store",
    });
    if (response.ok) setReport((await response.json()) as Report);
    else if (response.status === 404) setReport(null);
  }, []);

  const loadWorkflow = useCallback(
    async (workflowId: string) => {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("This analysis could not be loaded.");
      const next = (await response.json()) as Workflow;
      setWorkflow(next);
      await loadReport(workflowId);
      return next;
    },
    [loadReport],
  );

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/workflows", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as {
        workflows: WorkflowHistoryItem[];
      };
      setHistory(data.workflows);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!workflow || terminalStates.has(workflow.state)) return;
    const refresh = async () => {
      try {
        const next = await loadWorkflow(workflow.id);
        setMessage(
          `Workflow ${next.id.slice(0, 8)} is ${next.state.toLowerCase()}. Updated just now.`,
        );
        await loadHistory();
      } catch {
        setMessage(
          "Live updates are temporarily unavailable. Retrying shortly.",
        );
      }
    };
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [loadHistory, loadWorkflow, workflow?.id, workflow?.state]);

  const filteredItems = useMemo(
    () =>
      report?.items.filter(
        (item) => filter === "ALL" || item.kind === filter,
      ) ?? [],
    [filter, report],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setReport(null);
    setMessage("Creating persisted workflow…");
    try {
      const created = await fetch("/api/workflows/company-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (!created.ok) throw new Error("Use a valid US ticker and try again.");
      const { workflowId } = (await created.json()) as { workflowId: string };
      const next = await loadWorkflow(workflowId);
      setMessage(
        `Workflow ${workflowId.slice(0, 8)} is ${next.state.toLowerCase()}. Live updates are on.`,
      );
      await loadHistory();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create workflow.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function selectWorkflow(workflowId: string) {
    setLoading(true);
    setReport(null);
    try {
      const next = await loadWorkflow(workflowId);
      setMessage(`Loaded ${next.ticker} workflow ${next.id.slice(0, 8)}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load this analysis.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <span className="mark" aria-hidden="true">
          FF
        </span>
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
              {loading ? "Loading…" : "Run analysis"}
            </button>
          </div>
        </form>
      </section>
      <p className="status" role="status" aria-live="polite">
        {message}
      </p>

      <section className="history" aria-labelledby="history-title">
        <h2 id="history-title">My analyses</h2>
        {history.length === 0 ? (
          <p className="muted">
            Your completed and active analyses will appear here.
          </p>
        ) : (
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="history-item"
                  aria-current={workflow?.id === item.id ? "page" : undefined}
                  onClick={() => void selectWorkflow(item.id)}
                >
                  <span>
                    <strong>{item.ticker}</strong>
                    <small>{formatDate(item.createdAt)}</small>
                  </span>
                  <span className="state">{item.state}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {workflow && (
        <section className="workflow" aria-labelledby="workflow-title">
          <div className="section-heading">
            <div>
              <h2 id="workflow-title">{workflow.ticker} workflow</h2>
              {!terminalStates.has(workflow.state) && (
                <p className="muted">Live refreshes every 2.5 seconds.</p>
              )}
            </div>
            <span className="state">{workflow.state}</span>
          </div>
          <ol>
            {workflow.tasks.map((task) => (
              <li key={task.id}>
                <span className="task-name">
                  {task.kind.replaceAll("_", " ").toLowerCase()}
                </span>
                <span>{task.state}</span>
                <small>
                  Attempt {task.attemptCount}/{task.maxAttempts}
                  {task.attemptCount > 1 ? " · recovered/retried" : ""}
                  {task.lastErrorCode ? ` · ${task.lastErrorCode}` : ""}
                  {task.nextAttemptAt
                    ? ` · next ${formatDate(task.nextAttemptAt)}`
                    : ""}
                </small>
              </li>
            ))}
          </ol>
          {workflow.validationFindings.length > 0 && (
            <section className="findings" aria-labelledby="findings-title">
              <h3 id="findings-title">Data-quality findings</h3>
              <ul>
                {workflow.validationFindings.map((finding) => (
                  <li key={`${finding.code}-${finding.message}`}>
                    <span
                      className={`severity ${finding.severity.toLowerCase()}`}
                    >
                      {finding.severity}
                    </span>
                    <span>
                      {finding.message} <small>({finding.dataStatus})</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      {report && (
        <section className="report" aria-labelledby="report-title">
          <div className="report-heading">
            <h2 id="report-title">Persisted report</h2>
            <div
              className="filters"
              role="group"
              aria-label="Filter report items"
            >
              {reportKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={filter === kind}
                  onClick={() => setFilter(kind)}
                >
                  {kind === "ALL" ? "All" : kind.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
          {filteredItems.map((item) => (
            <article key={item.id}>
              <span className={`kind ${item.kind.toLowerCase()}`}>
                {item.kind.replace("_", " ")}
              </span>
              <h3>{item.title}</h3>
              <p>{item.content}</p>
              {item.calculationProvenance && (
                <details>
                  <summary>Calculation inputs and formula</summary>
                  <p>
                    Formula {item.calculationProvenance.formulaVersion} ·{" "}
                    {item.calculationProvenance.status} · calculated{" "}
                    {formatDate(item.calculationProvenance.calculatedAt)}
                  </p>
                  <pre>
                    {JSON.stringify(
                      item.calculationProvenance.inputSnapshot,
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              <div
                className="sources"
                aria-label={`Evidence for ${item.title}`}
              >
                {item.sources.map((source) => (
                  <a
                    key={source.sourceId}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.provider}
                    {source.documentSection
                      ? ` · ${source.documentSection}`
                      : " source"}
                    {` · retrieved ${formatDate(source.retrievedAt)}`}
                  </a>
                ))}
              </div>
            </article>
          ))}
          {filteredItems.length === 0 && (
            <p className="empty">No report items match this filter.</p>
          )}
        </section>
      )}
    </main>
  );
}
