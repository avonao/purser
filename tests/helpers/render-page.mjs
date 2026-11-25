// Run in its own process (the naming options come from the environment, read once when the runtime loads):
// print the body of a page module as JSON.
import { pathToFileURL } from 'node:url';

const { renderBody } = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(JSON.stringify(renderBody()));
