import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { getPublished } from "@/src/domain/articles";
import { errorResponse } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getPublished(getDb(), slug));
  } catch (e) {
    return errorResponse(e);
  }
}
