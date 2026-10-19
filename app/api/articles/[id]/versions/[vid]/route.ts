import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { getVersion } from "@/src/domain/articles";
import { errorResponse } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  try {
    const { id, vid } = await params;
    return NextResponse.json(getVersion(getDb(), id, vid));
  } catch (e) {
    return errorResponse(e);
  }
}
