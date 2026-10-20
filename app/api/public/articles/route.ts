import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { listPublished } from "@/src/domain/articles";
import { errorResponse } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(listPublished(getDb()));
  } catch (e) {
    return errorResponse(e);
  }
}
