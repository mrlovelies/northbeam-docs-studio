import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { unpublish } from "@/src/domain/articles";
import { errorResponse } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(unpublish(getDb(), id));
  } catch (e) {
    return errorResponse(e);
  }
}
