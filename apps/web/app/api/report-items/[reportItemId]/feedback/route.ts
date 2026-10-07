import { auth } from "../../../../../auth";
import { callInternalApi } from "../../../../../lib/internal-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportItemId: string }> },
) {
  const { reportItemId } = await params;
  return callInternalApi(
    request,
    await auth(),
    `/report-items/${reportItemId}/feedback`,
  );
}
