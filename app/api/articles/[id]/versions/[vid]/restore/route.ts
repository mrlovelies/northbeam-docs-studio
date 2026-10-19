import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { restore } from "@/src/domain/articles";
import { errorResponse, readJson } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  try {
    const { id, vid } = await params;
    const body = await readJson(req);
    const updated = restore(getDb(), id, vid, body.expectedVersion);
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
