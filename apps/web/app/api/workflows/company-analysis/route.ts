import { auth } from "../../../../auth";
import { callInternalApi } from "../../../../lib/internal-api";

export async function POST(request: Request) {
  return callInternalApi(request, await auth(), "/workflows/company-analysis");
}
