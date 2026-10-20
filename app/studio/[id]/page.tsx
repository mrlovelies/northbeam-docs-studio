"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Article = {
  id: string;
  slug: string;
  status: string;
  draftTitle: string;
  draftBody: string;
  draftTags: string[];
  draftVersion: number;
  currentPublishedVersionId: string | null;
  publishedAt: string | null;
};

type Version = {
  id: string;
  versionNumber: number;
  title: string;
  createdAt: string;
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

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [aRes, vRes] = await Promise.all([
      fetch(`/api/articles/${id}`),
      fetch(`/api/articles/${id}/versions`),
    ]);
    if (!aRes.ok) {
      setMsg("Article not found");
      return;
    }
    const a: Article = await aRes.json();
    setArticle(a);
    setTitle(a.draftTitle);
    setBody(a.draftBody);
    setTags(a.draftTags.join(", "));
    setVersions(vRes.ok ? await vRes.json() : []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Run a mutation, surface its outcome, then reload so the optimistic-lock
  // token (draftVersion) and history stay in sync with the server.
  async function act(label: string, fn: () => Promise<Response>) {
    setMsg(null);
    const res = await fn();
    if (res.ok) {
      setMsg(`${label}: ok`);
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(`${label} failed (${res.status}): ${j.message ?? j.error ?? "error"}`);
    }
    await load();
  }

  if (!article) return <p className="text-neutral-500">{msg ?? "Loading..."}</p>;

  const ev = article.draftVersion;
  const tagsArray = () =>
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/studio" className="text-sm text-neutral-600 hover:underline">
          ← All articles
        </Link>
        <StatusBadge status={article.status} />
      </div>

      <div className="space-y-3">
        <div
          className="text-xs text-neutral-500"
          title="Draft revision: the optimistic-lock token. It bumps on every save and rejects stale writes. Not a published version number."
        >
          /{article.slug} · draft rev {article.draftVersion}
        </div>
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tags, comma, separated"
        />
        <textarea
          className="h-64 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Markdown body"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white"
          onClick={() =>
            act("Save draft", () =>
              fetch(`/api/articles/${id}/draft`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title, body, tags: tagsArray(), expectedVersion: ev }),
              }),
            )
          }
        >
          Save draft
        </button>
        <button
          className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white"
          onClick={() =>
            act("Publish", () =>
              fetch(`/api/articles/${id}/publish`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedVersion: ev }),
              }),
            )
          }
        >
          Publish
        </button>
        {article.status === "published" && (
          <button
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            onClick={() =>
              act("Unpublish", () => fetch(`/api/articles/${id}/unpublish`, { method: "POST" }))
            }
          >
            Unpublish
          </button>
        )}
      </div>

      {msg && <p className="text-sm text-neutral-600">{msg}</p>}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">Version history</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-neutral-500">No versions yet. Publish to mint v1.</p>
        ) : (
          <ul className="space-y-1">
            {versions.map((v) => {
              const isPointer = v.id === article.currentPublishedVersionId;
              const isServed = isPointer && article.status === "published";
              return (
                <li
                  key={v.id}
                  className="flex items-center justify-between rounded border border-neutral-200 bg-white px-3 py-2 text-sm"
                >
                  <span>
                    v{v.versionNumber} · {v.title}
                    {isPointer && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                          isServed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                        }`}
                        title={
                          isServed
                            ? "Live: served to readers right now."
                            : "Active snapshot: the article still points here, but it is hidden from readers while unpublished."
                        }
                      >
                        {isServed ? "live" : "active"}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3">
                    <button
                      className="text-blue-700 hover:underline"
                      onClick={() =>
                        act(`Restore v${v.versionNumber}`, () =>
                          fetch(`/api/articles/${id}/versions/${v.id}/restore`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ expectedVersion: ev }),
                          }),
                        )
                      }
                    >
                      Restore
                    </button>
                    <button
                      className="text-red-700 hover:underline disabled:opacity-40"
                      disabled={isPointer}
                      title={
                        isPointer
                          ? "The version this article points at can't be deleted (INV-3)"
                          : ""
                      }
                      onClick={() =>
                        act(`Delete v${v.versionNumber}`, () =>
                          fetch(`/api/articles/${id}/versions/${v.id}`, { method: "DELETE" }),
                        )
                      }
                    >
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
