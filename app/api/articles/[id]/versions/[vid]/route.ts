import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { deleteVersion, getVersion } from "@/src/domain/articles";
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  try {
    const { id, vid } = await params;
    deleteVersion(getDb(), id, vid);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
