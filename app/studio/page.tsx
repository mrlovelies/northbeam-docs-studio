"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Article = {
  id: string;
  slug: string;
  status: string;
  draftTitle: string;
  draftVersion: number;
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "published"
      ? "bg-green-100 text-green-800"
      : status === "unpublished"
        ? "bg-amber-100 text-amber-800"
        : "bg-neutral-100 text-neutral-700";
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}

export default function Studio() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/articles");
    if (res.ok) setArticles(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, title, body: "", tags: [] }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(`${res.status}: ${j.message ?? j.error ?? "error"}`);
      return;
    }
    setSlug("");
    setTitle("");
    load();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Studio</h1>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-neutral-500">
            slug
            <input
              className="rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-first-doc"
            />
          </label>
          <label className="flex flex-1 flex-col text-xs text-neutral-500">
            title
            <input
              className="rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My First Doc"
            />
          </label>
          <button className="rounded bg-neutral-800 px-3 py-2 text-sm text-white">New draft</button>
        </form>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      <section className="space-y-2">
        {articles.length === 0 ? (
          <p className="text-sm text-neutral-500">No articles yet. Create one above.</p>
        ) : (
          <ul className="space-y-1">
            {articles.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded border border-neutral-200 bg-white px-3 py-2"
              >
                <Link href={`/studio/${a.id}`} className="font-medium text-blue-700 hover:underline">
                  {a.draftTitle || a.slug}
                </Link>
                <span className="flex items-center gap-3 text-xs text-neutral-500">
                  <span>/{a.slug}</span>
                  <StatusBadge status={a.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
