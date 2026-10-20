import Link from "next/link";
import { getDb } from "@/src/db/client";
import { listPublished } from "@/src/domain/articles";

export const dynamic = "force-dynamic";

// Public docs home: the published list, read through the live pointer.
export default function Home() {
  const articles = listPublished(getDb());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Published docs</h1>
      {articles.length === 0 ? (
        <p className="text-neutral-500">
          Nothing published yet. Head to the{" "}
          <Link href="/studio" className="underline">
            Studio
          </Link>{" "}
          to write something.
        </p>
      ) : (
        <ul className="space-y-4">
          {articles.map((a) => (
            <li key={a.slug} className="border-b border-neutral-200 pb-4">
              <Link
                href={`/read/${a.slug}`}
                className="text-lg font-medium text-blue-700 hover:underline"
              >
                {a.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                {a.publishedAt && <span>{new Date(a.publishedAt).toLocaleDateString()}</span>}
                {a.tags.map((t) => (
                  <span key={t} className="rounded bg-neutral-100 px-2 py-0.5">
                    {t}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
