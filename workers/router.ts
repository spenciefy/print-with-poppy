import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Express, RequestHandler } from "express";
import { HttpError } from "../server/errors.js";
import { errorResponse } from "../server/http-errors.js";
import { ZodError } from "zod";
// Thin transport adapter: shared route handlers still own validation and authorization.
export function router() {
  const app = new Hono();
  const wrap = (handler: any) => async (c: any, next: () => Promise<void>) => {
    let req = c.get("request");
    if (!req) {
      const raw = c.req.raw as Request;
      let body: any = {};
      if (
        !["GET", "HEAD"].includes(raw.method) &&
        !raw.headers.get("content-type")?.startsWith("multipart/")
      ) {
        const form = raw.headers
          .get("content-type")
          ?.startsWith("application/x-www-form-urlencoded");
        const limit = form ? 32768 : 131072;
        const reader = raw.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > limit) {
              await reader.cancel();
              throw new HttpError(
                413,
                "request_too_large",
                "Request body exceeds the size limit.",
              );
            }
            chunks.push(part.value);
          }
        const text = Buffer.concat(chunks).toString();
        if (text) {
          try {
            if (form) {
              body = {};
              for (const [k, v] of new URLSearchParams(text))
                body[k] = k in body ? [body[k]].flat().concat(v) : v;
            } else {
              body = JSON.parse(text);
              if (!body || typeof body !== "object") throw new Error();
            }
          } catch {
            throw new HttpError(
              400,
              "invalid_request",
              "Send a JSON object, not a quoted JSON string.",
            );
          }
        }
      }
      req = {
        body,
        method: raw.method,
        originalUrl: c.req.path + new URL(raw.url).search,
        path: c.req.path,
        query: c.req.query(),
        rawHeaders: [...raw.headers.entries()].flat(),
        get: (name: string) => raw.headers.get(name) ?? undefined,
      };
      c.set("request", req);
    }
    req.params = c.req.param();
    let response: Response | undefined;
    const res: any = {
      locals: c.get("locals") ?? {},
      status(code: number) {
        c.status(code);
        return res;
      },
      set(name: string, value: string) {
        c.header(name, value);
        return res;
      },
      type(type: string) {
        c.header(
          "Content-Type",
          type === "html" ? "text/html; charset=utf-8" : type,
        );
        return res;
      },
      json(value: any) {
        response = c.json(value);
        return res;
      },
      send(value: any) {
        response = c.body(value);
        return res;
      },
      sendStatus(code: number) {
        response = c.body(null, code);
        return res;
      },
      redirect(code: number, url: string) {
        response = c.redirect(url, code);
        return res;
      },
      cookie(name: string, value: string, options: any) {
        setCookie(c, name, value, {
          ...options,
          maxAge: options.maxAge / 1000,
        });
        return res;
      },
      clearCookie(name: string, options: any) {
        deleteCookie(c, name, options);
        return res;
      },
    };
    c.set("locals", res.locals);
    let continuation: Promise<void> | undefined;
    await handler(req, res, () => {
      continuation = next();
      return continuation;
    });
    if (continuation) await continuation;
    return response;
  };
  const facade: any = {
    get(path: string, ...handlers: any[]) {
      (app.get as any)(path, ...handlers.map(wrap));
    },
    post(path: string, ...handlers: any[]) {
      (app.post as any)(path, ...handlers.map(wrap));
    },
    delete(path: string, ...handlers: any[]) {
      (app.delete as any)(path, ...handlers.map(wrap));
    },
    use(paths: string | string[], handler: any) {
      for (const path of Array.isArray(paths) ? paths : [paths]) {
        app.use(`${path}/*`, wrap(handler));
      }
    },
  };
  app.onError((e, c) => {
    if (e instanceof ZodError)
      return c.json(
        {
          error: "invalid_request",
          message: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (e instanceof HttpError) {
      const { status, headers, body } = errorResponse(e);
      for (const [k, v] of Object.entries(headers)) c.header(k, v);
      return c.json(body, status as any);
    }
    console.error("Request failed", c.req.method, c.req.path, e.name);
    return c.json(
      {
        error: "internal_error",
        message:
          "Something went wrong. Retry the same request; do not create a duplicate order.",
      },
      500,
    );
  });
  app.notFound((c) =>
    c.json({ error: "not_found", message: "Endpoint not found." }, 404),
  );
  return { app, facade: facade as Express };
}
export const pass: RequestHandler = (_req, _res, next) => next();
