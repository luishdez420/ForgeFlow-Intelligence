import { auth } from "../../../../auth";
import { callInternalApi } from "../../../../lib/internal-api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const { feedbackId } = await params;
  return callInternalApi(request, await auth(), `/feedback/${feedbackId}`);
}
