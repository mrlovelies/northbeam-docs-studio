import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { listVersions } from "@/src/domain/articles";
import { errorResponse } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(listVersions(getDb(), id));
  } catch (e) {
    return errorResponse(e);
  }
}
