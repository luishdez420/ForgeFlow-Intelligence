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
type FeedbackClassification =
  "USEFUL" | "UNCLEAR" | "UNSUPPORTED" | "INCORRECT";
type Feedback = {
  id: string;
  reportItemId: string;
  classification: FeedbackClassification;
  comment: string | null;
  state: "OPEN" | "RESOLVED";
  createdAt: string;
  submittedByEmail?: string;
  ticker?: string;
  reportItemTitle?: string;
};
type FeedbackDraft = {
  classification: FeedbackClassification;
  comment: string;
};

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

function formatReportTitle(title: string): string {
  const labels: Record<string, string> = {
    revenue: "Revenue",
    operating_income: "Operating income",
    net_income: "Net income",
    assets: "Total assets",
    operating_cash_flow: "Operating cash flow",
    share_count: "Shares outstanding",
    market_history: "Market data",
  };
  return labels[title] ?? title.replaceAll("_", " ");
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
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState<
    Record<string, FeedbackDraft>
  >({});
  const [submittingFeedback, setSubmittingFeedback] = useState<string | null>(
    null,
  );
  const [reviewFeedback, setReviewFeedback] = useState<Feedback[] | null>(null);

  const loadReport = useCallback(async (workflowId: string) => {
    const response = await fetch(`/api/reports/${workflowId}`, {
      cache: "no-store",
    });
    if (response.ok) setReport((await response.json()) as Report);
    else if (response.status === 404) setReport(null);
  }, []);

  const loadFeedback = useCallback(async (workflowId: string) => {
    const response = await fetch(`/api/reports/${workflowId}/feedback`, {
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as { feedback: Feedback[] };
      setFeedback(data.feedback);
    } else if (response.status === 404) {
      setFeedback([]);
    }
  }, []);

  const loadReviewFeedback = useCallback(async () => {
    const response = await fetch("/api/feedback/review", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { feedback: Feedback[] };
      setReviewFeedback(data.feedback);
    } else if (response.status === 403) {
      setReviewFeedback(null);
    }
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
      await loadFeedback(workflowId);
      return next;
    },
    [loadFeedback, loadReport],
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
    void loadReviewFeedback();
  }, [loadReviewFeedback]);

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

  function updateFeedbackDraft(
    reportItemId: string,
    update: Partial<FeedbackDraft>,
  ) {
    setFeedbackDrafts((current) => {
      const draft = current[reportItemId] ?? {
        classification: "USEFUL" as const,
        comment: "",
      };
      return { ...current, [reportItemId]: { ...draft, ...update } };
    });
  }

  async function submitFeedback(event: FormEvent, reportItemId: string) {
    event.preventDefault();
    const draft = feedbackDrafts[reportItemId] ?? {
      classification: "USEFUL" as const,
      comment: "",
    };
    setSubmittingFeedback(reportItemId);
    try {
      const response = await fetch(
        `/api/report-items/${reportItemId}/feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            classification: draft.classification,
            ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error("Feedback could not be saved. Please try again.");
      }
      const saved = (await response.json()) as Feedback;
      setFeedback((current) => [saved, ...current]);
      setFeedbackDrafts((current) => ({
        ...current,
        [reportItemId]: { classification: "USEFUL", comment: "" },
      }));
      setMessage("Feedback saved for this exact report item and version.");
      await loadReviewFeedback();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Feedback could not be saved.",
      );
    } finally {
      setSubmittingFeedback(null);
    }
  }

  async function resolveFeedback(feedbackId: string) {
    const response = await fetch(`/api/feedback/${feedbackId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "RESOLVED" }),
    });
    if (!response.ok) {
      setMessage("Feedback could not be resolved. Please try again.");
      return;
    }
    setReviewFeedback(
      (current) => current?.filter((item) => item.id !== feedbackId) ?? null,
    );
    setMessage(
      "Feedback marked resolved. Source facts and metrics were unchanged.",
    );
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
                {workflow.validationFindings.map((finding, index) => (
                  <li key={`${finding.code}-${finding.message}-${index}`}>
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
              <h3>{formatReportTitle(item.title)}</h3>
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
              <form
                className="feedback-form"
                onSubmit={(event) => void submitFeedback(event, item.id)}
              >
                <div>
                  <h4>Quality review</h4>
                  <p>
                    Record feedback on this report item. It never edits source
                    facts, metrics, or the report itself.
                  </p>
                </div>
                <label>
                  Assessment
                  <select
                    value={feedbackDrafts[item.id]?.classification ?? "USEFUL"}
                    onChange={(event) =>
                      updateFeedbackDraft(item.id, {
                        classification: event.target
                          .value as FeedbackClassification,
                      })
                    }
                  >
                    <option value="USEFUL">Useful</option>
                    <option value="UNCLEAR">Unclear</option>
                    <option value="UNSUPPORTED">Unsupported</option>
                    <option value="INCORRECT">Incorrect</option>
                  </select>
                </label>
                <label>
                  Comment <small>(optional)</small>
                  <textarea
                    value={feedbackDrafts[item.id]?.comment ?? ""}
                    maxLength={2000}
                    onChange={(event) =>
                      updateFeedbackDraft(item.id, {
                        comment: event.target.value,
                      })
                    }
                  />
                </label>
                <button disabled={submittingFeedback === item.id}>
                  {submittingFeedback === item.id ? "Saving…" : "Save feedback"}
                </button>
                {feedback.some((entry) => entry.reportItemId === item.id) && (
                  <small className="feedback-saved">
                    Your feedback for this item is saved.
                  </small>
                )}
              </form>
            </article>
          ))}
          {filteredItems.length === 0 && (
            <p className="empty">No report items match this filter.</p>
          )}
        </section>
      )}

      {reviewFeedback && (
        <section className="review-queue" aria-labelledby="review-title">
          <div className="section-heading">
            <div>
              <h2 id="review-title">Open quality review</h2>
              <p className="muted">
                Administrator-only queue. Resolving feedback never changes
                authoritative facts or metrics.
              </p>
            </div>
            <span className="state">{reviewFeedback.length} open</span>
          </div>
          {reviewFeedback.length === 0 ? (
            <p className="empty">No feedback needs review.</p>
          ) : (
            <ol>
              {reviewFeedback.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.ticker ?? "Report"}</strong>
                    <span
                      className={`kind feedback-${entry.classification.toLowerCase()}`}
                    >
                      {entry.classification.toLowerCase()}
                    </span>
                    <p>{entry.reportItemTitle ?? "Historical report item"}</p>
                    {entry.comment && (
                      <p className="feedback-comment">{entry.comment}</p>
                    )}
                    <small>
                      {entry.submittedByEmail ?? "Analyst"} ·{" "}
                      {formatDate(entry.createdAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void resolveFeedback(entry.id)}
                  >
                    Mark resolved
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
