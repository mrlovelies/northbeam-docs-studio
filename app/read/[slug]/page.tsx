import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { getPublished } from "@/src/domain/articles";
import { NotFoundError } from "@/src/domain/errors";

export const dynamic = "force-dynamic";

// Public article view: rendered from the live version. Draft-only, unpublished,
// and unknown slugs all 404 alike (no existence leak).
export default async function ReadArticle({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let article;
  try {
    article = getPublished(getDb(), slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <article className="space-y-4">
      <Link href="/" className="text-sm text-neutral-600 hover:underline">
        ← All docs
      </Link>
      <h1 className="text-2xl font-semibold">{article.title}</h1>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {article.publishedAt && <span>{new Date(article.publishedAt).toLocaleDateString()}</span>}
        {article.tags.map((t) => (
          <span key={t} className="rounded bg-neutral-100 px-2 py-0.5">
            {t}
          </span>
        ))}
      </div>
      <div className="markdown">
        <ReactMarkdown>{article.body}</ReactMarkdown>
      </div>
    </article>
  );
}
