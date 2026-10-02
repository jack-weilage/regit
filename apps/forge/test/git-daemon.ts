import { serveGit } from './git-server.ts';

const git = await serveGit(process.argv[2]!);
console.log(git.port);
