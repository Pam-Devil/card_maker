import fs from "node:fs/promises";
import path from "node:path";

export async function outputFiles(directory, extension) {
  return (await fs.readdir(directory, { recursive: true }))
    .filter(name => name.endsWith(extension)).map(name => name.split(path.sep).join("/")).sort();
}
