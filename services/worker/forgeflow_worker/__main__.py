from argparse import ArgumentParser
from socket import gethostname

from .repository import PostgresWorkerRepository
from .runtime import WorkerRuntime
from .company_analysis import CompanyAnalysisHandlers
from .sec_edgar import SecEdgarProvider


def main() -> None:
    parser = ArgumentParser(description="Run a ForgeFlow worker runtime.")
    parser.add_argument("--name", default=f"worker-{gethostname()}")
    parser.add_argument("--once", action="store_true", help="Register and perform one safe poll.")
    arguments = parser.parse_args()

    repository = PostgresWorkerRepository()
    runtime = WorkerRuntime(repository, arguments.name, CompanyAnalysisHandlers(repository, SecEdgarProvider.from_environment()).handlers())
    runtime.install_signal_handlers()
    if arguments.once:
        runtime.run_once()
        runtime.stop()
        return
    runtime.run_forever()


if __name__ == "__main__":
    main()
