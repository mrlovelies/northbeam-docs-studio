import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { publish } from "@/src/domain/articles";
import { errorResponse, readJson } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await readJson(req);
    const version = publish(getDb(), id, body.expectedVersion);
    return NextResponse.json(version);
  } catch (e) {
    return errorResponse(e);
  }
}
