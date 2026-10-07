"""Durable handlers for the company-analysis task graph."""
from __future__ import annotations

from dataclasses import dataclass

from .runtime import ClaimedTask, TaskExecutionError
from .sec_edgar import SecEdgarError, SecEdgarProvider
from .sec_facts import extract_initial_facts
from .sec_taxonomy import map_sec_facts


class AnalysisRepository:
    def workflow_company(self, workflow_id: str) -> tuple[str, str]: ...
    def persist_sec_evidence(self, company_id: str, documents, company_facts, extracted_facts) -> dict[str, int]: ...
    def persist_canonical_sec_facts(self, company_id: str, source_id: str, document_id: str, facts) -> int: ...
    def record_market_data_unavailable(self, company_id: str) -> None: ...
    def validate_workflow_sources(self, workflow_id: str): ...
    def assemble_report(self, workflow_id: str) -> str: ...
    def publish_report(self, workflow_id: str) -> None: ...


@dataclass
class CompanyAnalysisHandlers:
    repository: AnalysisRepository
    sec: SecEdgarProvider

    def handlers(self) -> dict[str, object]:
        return {
            "FETCH_COMPANY_PROFILE": self.fetch_company_profile,
            "FETCH_SEC_FILINGS": self.fetch_sec_filings,
            "FETCH_MARKET_HISTORY": self.fetch_market_history,
            "NORMALIZE_COMPANY_DATA": self.noop,
            "NORMALIZE_FINANCIAL_DATA": self.noop,
            "CALCULATE_FINANCIAL_METRICS": self.noop,
            "CALCULATE_MARKET_METRICS": self.noop,
            "VALIDATE_SOURCES": self.validate_sources,
            "GENERATE_ANALYSIS": self.noop,
            "ASSEMBLE_REPORT": self.assemble_report,
            "PUBLISH_REPORT": self.publish_report,
        }

    def fetch_company_profile(self, task: ClaimedTask) -> None:
        _, ticker = self.repository.workflow_company(task.workflow_id)
        try: self.sec.resolve_ticker(ticker)
        except SecEdgarError as error: raise TaskExecutionError(error.classification, "SEC_PROFILE", str(error)) from error

    def fetch_sec_filings(self, task: ClaimedTask) -> None:
        company_id, ticker = self.repository.workflow_company(task.workflow_id)
        try:
            company = self.sec.resolve_ticker(ticker)
            documents = self.sec.retrieve_selected_documents(self.sec.retrieve_filings(company))
            company_facts = self.sec.retrieve_company_facts(company)
            extracted = extract_initial_facts(company_facts)
            self.repository.persist_sec_evidence(company_id, documents, company_facts, extracted)
        except SecEdgarError as error: raise TaskExecutionError(error.classification, "SEC_EVIDENCE", str(error)) from error

    def fetch_market_history(self, task: ClaimedTask) -> None:
        company_id, _ = self.repository.workflow_company(task.workflow_id)
        self.repository.record_market_data_unavailable(company_id)

    def validate_sources(self, task: ClaimedTask) -> None:
        self.repository.validate_workflow_sources(task.workflow_id)

    def assemble_report(self, task: ClaimedTask) -> None:
        try:
            self.repository.assemble_report(task.workflow_id)
        except ValueError as error:
            raise TaskExecutionError("VALIDATION", "REPORT_ASSEMBLY", str(error)) from error

    def publish_report(self, task: ClaimedTask) -> None:
        try:
            self.repository.publish_report(task.workflow_id)
        except ValueError as error:
            raise TaskExecutionError("VALIDATION", "REPORT_PUBLICATION", str(error)) from error

    def noop(self, _: ClaimedTask) -> None: pass
