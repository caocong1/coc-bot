import { CommandParser } from './src/commands/CommandParser.ts';

const parser = new CommandParser();

const tests = [
  '.rb2',
  '.rb',
  '.rh',
  '.rp',
  '.r3d6*5',
  '.r3d6',
  '.r 3d6*5',
  '.ra3d6',
  '.st3d6',
  '.rh3d6',
  '.rah3d6',
  '.r3#1d6',
  '.d3d6',
  '.b3d6',
  '.p3d6',
  '.h3d6',
];

for (const t of tests) {
  const result = parser.parse(t);
  console.log(`${t.padEnd(15)} -> name=${result?.name}, rawArgs=${result?.rawArgs}, args=${JSON.stringify(result?.args)}, bonus=${result?.bonus}, penalty=${result?.penalty}`);
}
