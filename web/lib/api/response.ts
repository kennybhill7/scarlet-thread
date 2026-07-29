import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function privateEmpty(status = 204) {
  return new Response(null, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function unauthorized() {
  return privateJson(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 },
  );
}

export function notFound() {
  return privateJson(
    { error: { code: "NOT_FOUND", message: "Entry not found" } },
    { status: 404 },
  );
}

export function invalidRequest(error: ZodError) {
  return privateJson(
    {
      error: {
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        issues: error.issues,
      },
    },
    { status: 400 },
  );
}

export function serverError(error: unknown) {
  console.error("API request failed", error);
  return privateJson(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
      },
    },
    { status: 500 },
  );
}
