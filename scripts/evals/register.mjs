// Lets `node --experimental-transform-types` run the app's extensionless TypeScript imports.
import { register } from "node:module";
register("./resolve-ts.mjs", import.meta.url);
