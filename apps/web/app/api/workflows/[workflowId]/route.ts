import { auth } from "../../../../auth";
import { callInternalApi } from "../../../../lib/internal-api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;
  return callInternalApi(request, await auth(), `/workflows/${workflowId}`);
}
