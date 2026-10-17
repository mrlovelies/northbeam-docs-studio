import { NextResponse } from "next/server";
import { DomainError, ValidationError } from "@/src/domain/errors";

// Parse a JSON request body, mapping malformed JSON to a 400 rather than a 500.
// Returns `any`: route handlers are thin adapters and the service validates.
export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}

// Map a thrown error to a JSON response: a typed DomainError becomes its status
// and typed body ({ error: code, message, ...details }); anything else is a 500.
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DomainError) {
    return NextResponse.json(
      { error: e.code, message: e.message, ...e.details },
      { status: e.status },
    );
  }
  console.error("Unhandled error:", e);
  return NextResponse.json(
    { error: "internal_error", message: "Unexpected error" },
    { status: 500 },
  );
}
