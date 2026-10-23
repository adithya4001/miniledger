import { PGlite } from "@electric-sql/pglite";
import { inject } from "light-my-request";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Express } from "express";
import type pg from "pg";
import { schema } from "../src/db.js";

export async function embeddedPool() {
  const db = new PGlite();
  await db.exec(schema);
  let queue: Promise<void> = Promise.resolve();
  const lock = async () => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const query = async (text: string, values?: unknown[]) => {
    const result = await db.query(text, values);
    return {
      rows: result.rows,
      rowCount: result.rows.length || result.affectedRows || 0,
    };
  };
  const adapter = {
    query: async (text: string, values?: unknown[]) => {
      const release = await lock();
      try {
        return await query(text, values);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await lock();
      return { query, release };
    },
    end: async () => {
      await db.close();
    },
  };
  return adapter as unknown as pg.Pool;
}

export function injectedClient(app: Express) {
  class RequestBuilder implements PromiseLike<{ status: number; body: any }> {
    headers: Record<string, string> = {};
    body: unknown;
    fields: [string, string][] = [];
    file?: {
      name: string;
      data: Buffer;
      filename: string;
      contentType: string;
    };
    constructor(
      readonly method: string,
      readonly url: string,
    ) {}
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    }
    send(body: unknown) {
      this.body = body;
      return this;
    }
    field(name: string, value: string) {
      this.fields.push([name, value]);
      return this;
    }
    attach(
      name: string,
      data: Buffer,
      metadata: string | { filename: string; contentType: string },
    ) {
      this.file = {
        name,
        data,
        filename: typeof metadata === "string" ? metadata : metadata.filename,
        contentType:
          typeof metadata === "string"
            ? "application/octet-stream"
            : metadata.contentType,
      };
      return this;
    }
    async execute() {
      let payload: string | Buffer | undefined;
      if (this.fields.length || this.file) {
        const boundary = `test-${randomUUID()}`;
        this.headers["content-type"] =
          `multipart/form-data; boundary=${boundary}`;
        const chunks: Buffer[] = [];
        for (const [name, value] of this.fields)
          chunks.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
            ),
          );
        if (this.file) {
          chunks.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${this.file.name}"; filename="${this.file.filename}"\r\nContent-Type: ${this.file.contentType}\r\n\r\n`,
            ),
            this.file.data,
            Buffer.from("\r\n"),
          );
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`));
        payload = Buffer.concat(chunks);
      } else if (this.body !== undefined) {
        payload = JSON.stringify(this.body);
        this.headers["content-type"] = "application/json";
      }
      const response = await inject(app as Parameters<typeof inject>[0], {
        method: this.method as "GET",
        url: this.url,
        headers: this.headers,
        payload,
      });
      return {
        status: response.statusCode,
        body: response.payload ? JSON.parse(response.payload) : undefined,
      };
    }
    async expect(status: number) {
      const response = await this.execute();
      assert.equal(response.status, status, JSON.stringify(response.body));
      return response;
    }
    then<TResult1 = { status: number; body: any }, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            status: number;
            body: any;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected);
    }
  }
  return {
    get: (url: string) => new RequestBuilder("GET", url),
    post: (url: string) => new RequestBuilder("POST", url),
    patch: (url: string) => new RequestBuilder("PATCH", url),
  };
}
