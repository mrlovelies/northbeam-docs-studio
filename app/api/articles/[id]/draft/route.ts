import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { updateDraft } from "@/src/domain/articles";
import { errorResponse, readJson } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await readJson(req);
    const updated = updateDraft(getDb(), id, {
      title: body.title,
      body: body.body,
      tags: body.tags,
      expectedVersion: body.expectedVersion,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
