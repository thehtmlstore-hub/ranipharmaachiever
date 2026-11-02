import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim()); value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function accountEmail(identifier) {
  const safe = identifier.toLowerCase().replace(/[^a-z0-9]/g, character => `-${character.charCodeAt(0).toString(16)}`);
  return `r-${safe}@students.ranipharmaachievers.com`;
}

const [source, authOutput, profilesOutput] = process.argv.slice(2);
if (!source || !authOutput || !profilesOutput) {
  throw new Error('Usage: node scripts/prepare-firebase-auth-import.mjs <students.csv> <auth-output.json> <profiles-output.json>');
}

const text = await fs.readFile(source, 'utf8');
const lines = text.split(/\r?\n/).filter(line => line.trim());
const header = parseCsvLine(lines.shift() || '').map(value => value.toLowerCase().replace(/[ _-]/g, ''));
const column = (...aliases) => aliases.map(alias => header.indexOf(alias)).find(index => index >= 0) ?? -1;
const positions = {
  regNo: column('userid', 'regno', 'registernumber', 'studentid', 'id'),
  password: column('password', 'pass', 'initialpassword'),
  name: column('fullname', 'name', 'studentname')
};
if (Object.values(positions).some(index => index < 0)) throw new Error('CSV needs user_id/register number, password, and full_name/name columns.');

const seen = new Set();
const users = [];
const profiles = [];
for (let index = 0; index < lines.length; index += 1) {
  const values = parseCsvLine(lines[index]);
  const regNo = String(values[positions.regNo] || '').trim().toUpperCase();
  const password = String(values[positions.password] || '');
  const name = String(values[positions.name] || '').trim();
  if (!/^[A-Z0-9][A-Z0-9\-_/]{2,31}$/.test(regNo)) throw new Error(`Invalid login ID at CSV row ${index + 2}.`);
  if (!name) throw new Error(`Missing name at CSV row ${index + 2}.`);
  if (password.length < 6) throw new Error(`Password is too short at CSV row ${index + 2}.`);
  if (seen.has(regNo)) throw new Error(`Duplicate login ID at CSV row ${index + 2}.`);
  seen.add(regNo);

  const uid = `stu_${crypto.createHash('sha256').update(regNo).digest('hex').slice(0, 28)}`;
  const salt = crypto.randomBytes(16);
  const passwordHash = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(password, 'utf8'), salt])).digest();
  const email = accountEmail(regNo);
  users.push({
    localId: uid,
    email,
    emailVerified: false,
    passwordHash: passwordHash.toString('base64'),
    salt: salt.toString('base64'),
    displayName: name
  });
  profiles.push({ uid, regNo, name, authEmail: email });
}

await fs.writeFile(authOutput, JSON.stringify({ users }));
await fs.writeFile(profilesOutput, JSON.stringify(profiles));
console.log(JSON.stringify({ source: path.basename(source), prepared: users.length }));
