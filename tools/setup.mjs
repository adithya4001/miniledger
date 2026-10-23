import { readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";

for (const folder of ["apps/api", "apps/mobile"]) {
  const destination = new URL(`../${folder}/.env`, import.meta.url);
  try {
    await access(destination);
    console.log(`${folder}/.env already exists; kept it.`);
  } catch {
    let text = await readFile(
      new URL(`../${folder}/.env.example`, import.meta.url),
      "utf8",
    );
    text = text.replace(
      "replace-with-at-least-32-random-characters",
      randomBytes(32).toString("hex"),
    );
    await writeFile(destination, text, { flag: "wx" });
    console.log(`Created ${folder}/.env. Keep it private.`);
  }
}
