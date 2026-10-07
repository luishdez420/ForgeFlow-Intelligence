import { auth } from "../../../auth";
import { callInternalApi } from "../../../lib/internal-api";

export async function GET(request: Request) {
  return callInternalApi(request, await auth(), "/workflows");
}
