import { NextResponse } from "next/server";
import { getDb } from "@/src/db/client";
import { createArticle, listArticles } from "@/src/domain/articles";
import { errorResponse, readJson } from "@/src/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(listArticles(getDb()));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const article = createArticle(getDb(), {
      slug: body.slug,
      title: body.title,
      body: body.body ?? "",
      tags: body.tags ?? [],
    });
    return NextResponse.json(article, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
