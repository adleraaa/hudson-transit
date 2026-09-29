import { buildBoard, BoardUnavailableError } from "@/lib/board";
import { getMtaFeed, getPathFeed } from "@/lib/feeds";
import { BoardSchema } from "@/lib/schema";

// protobuf decoding needs the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = { getPathFeed, getMtaFeed, now: Date.now };

export async function GET(_request: Request, context: { params: Promise<{ stationId: string }> }) {
  const { stationId } = await context.params;
  try {
    const board = await buildBoard(stationId, deps);
    if (!board) {
      return Response.json({ error: `Unknown station: ${stationId}` }, { status: 404 });
    }
    // Validating our own output keeps the zod schema the real contract with the client.
    return Response.json(BoardSchema.parse(board), {
      headers: {
        // Let a CDN absorb bursts; upstream data only changes every ~15-30 s anyway.
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15",
      },
    });
  } catch (err) {
    if (err instanceof BoardUnavailableError) {
      return Response.json(
        { error: err.message },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw err;
  }
}
