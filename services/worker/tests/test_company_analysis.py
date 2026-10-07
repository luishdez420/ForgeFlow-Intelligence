from forgeflow_worker.company_analysis import CompanyAnalysisHandlers
from forgeflow_worker.runtime import ClaimedTask


class Repository:
    def __init__(self) -> None: self.unavailable = []; self.persisted = []; self.validated = []; self.assembled = []; self.published = []
    def workflow_company(self, _: str): return "company", "MSFT"
    def record_market_data_unavailable(self, company_id: str) -> None: self.unavailable.append(company_id)
    def persist_sec_evidence(self, *values) -> None: self.persisted.append(values)
    def validate_workflow_sources(self, workflow_id: str) -> None: self.validated.append(workflow_id)
    def assemble_report(self, workflow_id: str) -> str: self.assembled.append(workflow_id); return "report"
    def publish_report(self, workflow_id: str) -> None: self.published.append(workflow_id)


class Sec:
    def resolve_ticker(self, _: str): return "company"
    def retrieve_filings(self, _: str): return ["filing"]
    def retrieve_selected_documents(self, _: list[str]): return ["document"]
    def retrieve_company_facts(self, _: str): return "facts"


def test_registers_full_company_analysis_graph_and_marks_market_data_unavailable() -> None:
    repository = Repository()
    handlers = CompanyAnalysisHandlers(repository, Sec()).handlers()
    assert set(handlers) == {"FETCH_COMPANY_PROFILE", "FETCH_SEC_FILINGS", "FETCH_MARKET_HISTORY", "NORMALIZE_COMPANY_DATA", "NORMALIZE_FINANCIAL_DATA", "CALCULATE_FINANCIAL_METRICS", "CALCULATE_MARKET_METRICS", "VALIDATE_SOURCES", "GENERATE_ANALYSIS", "ASSEMBLE_REPORT", "PUBLISH_REPORT"}
    handlers["FETCH_MARKET_HISTORY"](ClaimedTask("task", "workflow", "FETCH_MARKET_HISTORY", "attempt", 1, "lease", "future"))
    assert repository.unavailable == ["company"]


def test_runs_source_validation_through_the_durable_repository() -> None:
    repository = Repository()
    handlers = CompanyAnalysisHandlers(repository, Sec()).handlers()
    handlers["VALIDATE_SOURCES"](ClaimedTask("task", "workflow", "VALIDATE_SOURCES", "attempt", 1, "lease", "future"))
    assert repository.validated == ["workflow"]


def test_assembles_and_publishes_reports_through_the_durable_repository() -> None:
    repository = Repository()
    handlers = CompanyAnalysisHandlers(repository, Sec()).handlers()
    task = ClaimedTask("task", "workflow", "ASSEMBLE_REPORT", "attempt", 1, "lease", "future")
    handlers["ASSEMBLE_REPORT"](task)
    handlers["PUBLISH_REPORT"](task)
    assert repository.assembled == ["workflow"]
    assert repository.published == ["workflow"]


def test_fetches_sec_evidence_through_durable_repository(monkeypatch) -> None:
    repository = Repository()
    monkeypatch.setattr("forgeflow_worker.company_analysis.extract_initial_facts", lambda _: ["fact"])
    handlers = CompanyAnalysisHandlers(repository, Sec()).handlers()
    handlers["FETCH_SEC_FILINGS"](ClaimedTask("task", "workflow", "FETCH_SEC_FILINGS", "attempt", 1, "lease", "future"))
    assert repository.persisted == [("company", ["document"], "facts", ["fact"])]
